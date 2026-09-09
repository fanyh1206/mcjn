/* =========================================================
   verify-assets-cdp.mjs —— 素材写实渲染验证驱动器
   内置静态服务器 + headless Chrome：逐幕（4/5/6/7）注入进度恢复仪式，
   收集 404/控制台错误并截图；另截纪念馆页（香炉/夜景背景）。
   运行：node tools/verify-assets-cdp.mjs
   产物：tools/preview/act*_desktop.png + memorial_desktop.png
   ========================================================= */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9355;           // Chrome DevTools
const HTTP = 8123;           // 静态服务
const ROOT = process.cwd();
const OUT = join(ROOT, 'tools', 'preview');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.wav': 'audio/wav', '.json': 'application/json' };

/* ---------------- 静态服务器 ---------------- */
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.statusCode = 404; res.end('nf'); return; }
  res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(HTTP, '127.0.0.1', r));

/* ---------------- 启动 headless Chrome ---------------- */
const userData = mkdtempSync(join(tmpdir(), 'cdp-verify-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  'about:blank',
], { stdio: 'ignore' });

async function getJson(path) {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch (_) {}
    await sleep(250);
  }
  throw new Error('Chrome DevTools 未就绪');
}

const badRequests = [];
const consoleErrors = [];

async function main() {
  const list = await getJson('/json/list');
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('WS 连接失败')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
    } else if (msg.method && handlers.has(msg.method)) handlers.get(msg.method).forEach((f) => f(msg.params));
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const on = (m, f) => { if (!handlers.has(m)) handlers.set(m, []); handlers.get(m).push(f); };
  const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) params.clip = { x: clip[0], y: clip[1], width: clip[2], height: clip[3], scale: 1 };
    const { data } = await send('Page.captureScreenshot', params);
    writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
    console.log('📸', name);
  };

  await send('Page.enable');
  await send('Network.enable');
  await send('Runtime.enable');
  on('Network.responseReceived', (p) => { if (p.response.status >= 400) badRequests.push(p.response.status + ' ' + p.response.url); });
  on('Network.loadingFailed', (p) => { if (p.errorText !== 'net::ERR_ABORTED') badRequests.push(p.errorText + ' ' + (p.requestId || '')); });
  on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') consoleErrors.push(p.args.map((a) => a.value || a.description).join(' ')); });
  on('Runtime.exceptionThrown', (p) => consoleErrors.push('EXC: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text)));

  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  const seed = (step) => evalJS(`(function(){
    var d={version:1,state:'CEREMONY',ceremonyStep:${step},
      pet:{ownerName:'验证主人',petName:'小白',birthday:'2015-06-01',deathDate:'2026-08-20',gender:'male',breed:'中华田园犬'},
      stele:{erectedAt:''},incense:{lastLightTime:0,totalLightDays:0,continuousLightDays:0},
      messages:[],mainPhotoId:'p1',photosMeta:[{id:'p1',createdAt:Date.now(),isMain:true}],settings:{bgmEnabled:false,reducedMotion:false}};
    localStorage.setItem('pet_memorial_data', JSON.stringify(d));
    return true;})()`);

  const nav = async () => { await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/index.html` }); await sleep(1200); };

  // 先进入应用一次确立 origin（localStorage 按源隔离）
  await nav();

  // 逐幕截图：4 罐 / 5 棺+盖 / 6 覆土 / 7 上香（直接 Director.start 注入，绕过 IndexedDB 照片）
  const startAct = (step) => evalJS(`new Promise(function(res){
    var c=document.createElement('canvas');c.width=300;c.height=400;
    var g=c.getContext('2d');var lg=g.createLinearGradient(0,0,300,400);
    lg.addColorStop(0,'#e8d9b8');lg.addColorStop(1,'#8a6f4d');g.fillStyle=lg;g.fillRect(0,0,300,400);
    g.fillStyle='#5b4632';g.beginPath();g.arc(150,140,70,0,Math.PI*2);g.fill();
    var img=new Image();
    img.onload=function(){
      var d={version:1,state:'CEREMONY',ceremonyStep:${step},
        pet:{ownerName:'验证主人',petName:'小白',birthday:'2015-06-01',deathDate:'2026-08-20',gender:'male',breed:'中华田园犬'},
        stele:{erectedAt:''},incense:{lastLightTime:0,totalLightDays:0,continuousLightDays:0},
        messages:[],mainPhotoId:'p1',photosMeta:[{id:'p1',createdAt:Date.now(),isMain:true}],
        settings:{bgmEnabled:false,reducedMotion:false}};
      if (window.PM && PM.Director && PM.Director.stop) { try { PM.Director.stop(); } catch(e){} }
      // 直接 start 不走路由：手动切换视图可见性
      document.getElementById('view-form').hidden = true;
      document.getElementById('view-memorial').hidden = true;
      PM.Director.start({data:d,photoImg:img,onFinish:function(){window.__cerDone=true;}});
      res(true);
    };
    img.src=c.toDataURL();
  })`);

  // 逐幕验收截图：按各幕时间轴等待到关键稳定态（按钮/合盖/落棺）
  const plan = [
    { step: 3, waits: [5200], names: ['act3_ashed_desktop.png'] },          // 灰堆显影+按钮，验证不重叠
    { step: 4, waits: [7000], names: ['act4_urn_lidclosed_desktop.png'] },  // 扫灰入罐+盖合缝
    { step: 5, waits: [2600, 3800], names: ['act5_urn_in_desktop.png', 'act5_lidclosed_desktop.png'] }, // 罐沉入棺口(口线遮罩) / 盖合罐全没入
    { step: 6, waits: [1200, 5200], names: ['act6_lower_desktop.png', 'act6_desktop.png'] },  // 下棺阶段无土堆 / 覆土后土堆永久保留
    { step: 7, waits: [1500, 4200], names: ['act7_rising_desktop.png', 'act7_desktop.png'] },  // 碑升起盖住土堆 / 碑立稳在土堆前+“焚香祭拜”按钮
  ];
  for (const { step, waits, names } of plan) {
    await startAct(step);
    for (let i = 0; i < waits.length; i++) {
      await sleep(waits[i]);
      await shot(names[i]);
    }
    const loaded = await evalJS(`(function(){var o={};for(var k in PM.Assets.registry)o[k]=!!PM.Assets.get(k);return JSON.stringify(o);})()`);
    console.log(`   act${step} 素材:`, loaded);
  }

  // 幕7 两段按钮：焚香祭拜（炉升起对齐碑底+依次点香头冒短烟）→ 进入纪念馆；再验“上一步”回幕6
  await startAct(7);
  await sleep(4200);
  await shot('act7_offer_desktop.png');
  await evalJS(`document.getElementById('ceremony-btn').click(); true`);
  await sleep(1400);
  await shot('act7_lit_desktop.png');
  await shot('act7_incense_closeup.png', [490, 380, 300, 280]);
  await sleep(3000);
  await shot('act7_lit_steady_desktop.png');
  await shot('act7_lit_steady_closeup.png', [490, 360, 300, 300]);
  const act7BtnLater = await evalJS(`new Promise(function(r){setTimeout(function(){r(document.getElementById('ceremony-btn').textContent)},6600)})`);
  console.log('   幕7 点香后按钮文案 =', act7BtnLater, '(期望 进入纪念馆)');
  await evalJS(`document.getElementById('ceremony-back').click(); true`);
  await sleep(1500);
  await shot('act7_back_act6_desktop.png');
  const stepNow = await evalJS(`(function(){var d=JSON.parse(localStorage.getItem('pet_memorial_data'));return d.ceremonyStep;})()`);
  console.log('   幕7 点上一步后 ceremonyStep =', stepNow, '(期望 6)');

  // 第一幕返回上一步 → 信息填写页（走 route 以携带 onBack 回调）
  await seed(1);
  await nav();
  await sleep(1800);
  await evalJS(`document.getElementById('ceremony-back').click(); true`);
  await sleep(800);
  const formVisible = await evalJS(`!document.getElementById('view-form').hidden`);
  console.log('   幕1 上一步回填写页:', formVisible);
  await shot('back_to_form_desktop.png');

  // 纪念馆页（香炉 + 夜景背景 + 墓碑）：BUILT 路由 + Memorial.show 容错无照片
  await evalJS(`(function(){
    var d={version:1,state:'BUILT',ceremonyStep:7,
      pet:{ownerName:'验证主人',petName:'小白',birthday:'2015-06-01',deathDate:'2026-08-20',gender:'male',breed:'中华田园犬'},
      stele:{erectedAt:'2026-09-04'},
      incense:{lastLightTime:Date.now(),totalLightDays:3,continuousLightDays:3},
      messages:[{id:'m1',text:'永远记得你，小白。',createdAt:Date.now()}],
      mainPhotoId:'',photosMeta:[],settings:{bgmEnabled:false,reducedMotion:false}};
    localStorage.setItem('pet_memorial_data', JSON.stringify(d));
    return true;})()`);
  await nav();
  await sleep(3000);
  await shot('memorial_desktop.png');
  await shot('memorial_incense_closeup.png', [490, 340, 300, 280]);

  // 进馆默认放大特写（碑+炉居中）→ 顶部“放回坟冢”按钮可见 → 点按钮缩回小碑+土堆 → 点碑再放大
  const zoomBtnVisible = await evalJS(`!document.getElementById('memorial-zoom-btn').hidden`);
  console.log('   纪念馆默认放大后按钮可见 =', zoomBtnVisible, '(期望 true)');
  await evalJS(`document.getElementById('memorial-zoom-btn').click(); true`);
  await sleep(1100);
  await shot('memorial_zoomback_desktop.png');
  await evalJS(`(function(){var c=document.getElementById('memorial-canvas');var ev=new MouseEvent('click',{clientX:Math.round(innerWidth/2),clientY:Math.round(innerHeight*0.55),bubbles:true});c.dispatchEvent(ev);return true;})()`);
  await sleep(1100);
  await shot('memorial_zoom_desktop.png');

  // 点蜡烛：墓碑左右对称各一支（火苗错相闪烁+烛火烟）
  await evalJS(`document.querySelector('[data-action="candle"]').click(); true`);
  await sleep(1200);
  await shot('memorial_candle_desktop.png');
  await shot('memorial_candle_closeup.png', [400, 420, 480, 240]);

  // 表单日期默认当天：清空存储（无草稿无数据）后回填写页读两个日期输入框
  await evalJS(`localStorage.clear(); true`);
  await nav();
  await sleep(900);
  const dateDefaults = await evalJS(`[document.getElementById('f-birthday').value, document.getElementById('f-death').value].join('|')`);
  console.log('   表单日期默认 =', dateDefaults, '(期望两处均为当天)');
  await shot('form_default_dates_desktop.png');

  // 边界用例：超长宠物名/主人名 → 主碑文缩字/拆行，任何长度都不遮左右竖列
  await evalJS(`(function(){
    var d={version:1,state:'BUILT',ceremonyStep:7,
      pet:{ownerName:'欧阳验证主人氏',petName:'亚历山大大帝毛球二世',birthday:'2015-06-01',deathDate:'2026-08-20',gender:'male',breed:'中华田园犬'},
      stele:{erectedAt:'2026-09-04'},
      incense:{lastLightTime:Date.now(),totalLightDays:3,continuousLightDays:3},
      messages:[],mainPhotoId:'',photosMeta:[],settings:{bgmEnabled:false,reducedMotion:false}};
    localStorage.setItem('pet_memorial_data', JSON.stringify(d));
    return true;})()`);
  await nav();
  await sleep(3000);
  await shot('memorial_longname_desktop.png');

  console.log('\n404/失败请求:', badRequests.length ? badRequests : '无');
  console.log('控制台错误:', consoleErrors.length ? consoleErrors : '无');
  ws.close();
}

main().then(() => { chrome.kill(); server.close(); try { rmSync(userData, { recursive: true, force: true }); } catch (_) {} process.exit(0); })
  .catch((e) => { console.error('❌', e); chrome.kill(); server.close(); try { rmSync(userData, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
