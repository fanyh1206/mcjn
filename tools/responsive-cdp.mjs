/* =========================================================
   responsive-cdp.mjs —— 零依赖响应式验证驱动器
   用 Node 内置 fetch + WebSocket 直接驱动 headless Chrome (CDP)，
   精确设置移动视口、注入数据、走查仪式、截图并测量横向溢出。
   运行：node tools/responsive-cdp.mjs
   产物：_responsive_report/*.png + report.json + 控制台表格
   ========================================================= */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const HTTP = 8123;
const APP = 'http://127.0.0.1:8123/index.html';
const OUT = join(process.cwd(), '_responsive_report');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

/* ---------------- 内置静态服务器（自包含，无需外部起服务） ---------------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.wav': 'audio/wav', '.json': 'application/json' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = join(process.cwd(), url === '/' ? 'index.html' : url);
  if (!file.startsWith(process.cwd()) || !existsSync(file) || statSync(file).isDirectory()) { res.statusCode = 404; res.end('nf'); return; }
  res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(HTTP, '127.0.0.1', r));

const consoleErrors = [];
const report = { viewports: {}, issues: [], consoleErrors };

/* ---------------- 启动 headless Chrome ---------------- */
const userData = mkdtempSync(join(tmpdir(), 'cdp-profile-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userData}`,
  '--no-first-run', '--no-default-browser-check',
  '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  'about:blank',
], { stdio: 'ignore' });

async function getJson(path) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.ok) return await r.json();
    } catch (_) {}
    await sleep(250);
  }
  throw new Error('Chrome DevTools 未就绪: ' + path);
}

/* ---------------- CDP over WebSocket ---------------- */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('WS 连接失败')), { once: true });
    });
    const c = new CDP(ws);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
      } else if (msg.method && c.handlers.has(msg.method)) {
        c.handlers.get(msg.method).forEach((fn) => fn(msg.params));
      }
    });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }
  once(event) {
    return new Promise((res) => {
      const fn = (p) => { this.off(event, fn); res(p); };
      this.on(event, fn);
    });
  }
  off(event, fn) {
    const a = this.handlers.get(event);
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  }
}

/* ---------------- 高层辅助 ---------------- */
let cdp;
async function setViewport(w, h) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await sleep(200);
}
async function nav(url) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
  await sleep(700);
}
async function evalJS(expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('页面 JS 异常: ' + (d.exception && d.exception.description || d.text));
  }
  return r.result.value;
}
async function shot(name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'));
  return name;
}

// 通用测量：文档溢出 + 指定元素的 rect / 内部溢出 / 是否在视口内
function measureExpr(selectors) {
  return `(function(){
    var iw=window.innerWidth, ih=window.innerHeight, de=document.documentElement;
    function rect(sel){var e=document.querySelector(sel);if(!e)return null;var r=e.getBoundingClientRect();
      return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),
        right:Math.round(r.right),bottom:Math.round(r.bottom),
        inView:(r.left>=-1&&r.right<=iw+1&&r.top>=-1&&r.bottom<=ih+1)};}
    function ovf(sel){var e=document.querySelector(sel);if(!e)return null;
      return {scrollW:e.scrollWidth,clientW:e.clientWidth,over:e.scrollWidth>e.clientWidth+1};}
    var out={inner:[iw,ih],docScrollW:de.scrollWidth,docClientW:de.clientWidth,
      pageOverflow:de.scrollWidth>iw+1,rects:{},overflows:{}};
    ${selectors.map((s) => `out.rects[${JSON.stringify(s)}]=rect(${JSON.stringify(s)});`).join('\n    ')}
    ${selectors.map((s) => `out.overflows[${JSON.stringify(s)}]=ovf(${JSON.stringify(s)});`).join('\n    ')}
    // 所有 bb-btn 是否都在视口内
    out.bbBtns=[].slice.call(document.querySelectorAll('.bb-btn')).map(function(b){var r=b.getBoundingClientRect();
      return {label:(b.querySelector('span')||{}).textContent||'',right:Math.round(r.right),left:Math.round(r.left),inView:(r.left>=-1&&r.right<=iw+1)};});
    return out;
  })()`;
}

function checkViewport(label, m, extraChecks) {
  const issues = [];
  if (m.pageOverflow) issues.push(`[${label}] 页面横向溢出 docScrollW=${m.docScrollW} > innerW=${m.inner[0]}`);
  for (const [sel, o] of Object.entries(m.overflows || {})) {
    if (o && o.over) issues.push(`[${label}] 元素内部横向溢出 ${sel}: scrollW=${o.scrollW} > clientW=${o.clientW}`);
  }
  for (const [sel, r] of Object.entries(m.rects || {})) {
    if (r && !r.inView) issues.push(`[${label}] 元素超出视口 ${sel}: right=${r.right} bottom=${r.bottom} (视口 ${m.inner[0]}x${m.inner[1]})`);
  }
  (m.bbBtns || []).forEach((b) => { if (!b.inView) issues.push(`[${label}] 底部按钮超出视口: "${b.label}" left=${b.left} right=${b.right}`); });
  if (extraChecks) extraChecks.forEach((c) => { if (c.fail) issues.push(`[${label}] ${c.msg}`); });
  report.viewports[label] = { measure: m, issues };
  return issues;
}

/* ---------------- 测试主流程 ---------------- */
async function run() {
  const wsUrl = (await getJson('/json/list')).find((t) => t.type === 'page').webSocketDebuggerUrl;
  cdp = await CDP.connect(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  cdp.on('Runtime.consoleAPICalled', (e) => {
    if (e.type === 'error' || e.type === 'warning') {
      consoleErrors.push(`${e.type}: ` + (e.args || []).map((a) => a.value || a.description || a.type).join(' '));
    }
  });
  cdp.on('Runtime.exceptionThrown', (e) => {
    consoleErrors.push('exception: ' + (e.exceptionDetails.exception && e.exceptionDetails.exception.description || e.exceptionDetails.text));
  });
  cdp.on('Log.entryAdded', (e) => {
    if (e.entry.level === 'error') consoleErrors.push(`log.${e.entry.source}: ${e.entry.text}`);
  });

  const FORM_SEL = ['.form-card', '.field-row', '#f-birthday', '#f-death', '#photo-picker', '#btn-start', '.form-title'];
  const MEM_SEL = ['.top-bar', '.tb-left', '.tb-center', '.tb-right', '#memorial-canvas', '.incense-area', '#btn-light', '.bottom-bar'];

  /* ---- 视口 A：375×667 信息填写页 ---- */
  await setViewport(375, 667);
  await nav(APP);
  await evalJS(`localStorage.clear(); true`);
  await nav(APP);
  let mForm375 = await evalJS(measureExpr(FORM_SEL));
  await shot('A_form_375x667.png');
  // 填写表单后测量（含日期真实值）
  await evalJS(`(function(){
    document.getElementById('f-owner').value='测试主人';
    document.getElementById('f-pet').value='小白';
    document.getElementById('f-birthday').value='2015-06-01';
    document.getElementById('f-death').value='2026-08-20';
    document.getElementById('f-breed').value='中华田园犬';
    document.getElementById('f-words').value='永远记得你';
    return true;})()`);
  await sleep(200);
  let mForm375b = await evalJS(measureExpr(FORM_SEL));
  await shot('A_form_filled_375x667.png');
  checkViewport('A_form_375x667', mForm375b);

  /* ---- 视口 A：纪念馆首页（注入 BUILT 数据）---- */
  await evalJS(`(function(){
    var d={version:1,state:'BUILT',ceremonyStep:7,
      pet:{ownerName:'测试主人',petName:'小白',birthday:'2015-06-01',deathDate:'2026-08-20',gender:'male',breed:'中华田园犬'},
      stele:{erectedAt:'2026-09-04'},
      incense:{lastLightTime:Date.now(),totalLightDays:3,continuousLightDays:3},
      messages:[{id:'m1',text:'永远记得你，小白。',createdAt:Date.now()}],
      mainPhotoId:'',photosMeta:[],settings:{bgmEnabled:false,reducedMotion:false}};
    localStorage.setItem('pet_memorial_data', JSON.stringify(d));
    return true;})()`);
  await nav(APP);
  await sleep(900);
  let mMem375 = await evalJS(measureExpr(MEM_SEL));
  await shot('B_memorial_375x667.png');
  checkViewport('B_memorial_375x667', mMem375);

  /* ---- 视口 A：抽屉（底部滑出）---- */
  for (const [action, name] of [['message', 'msg'], ['photos', 'photos']]) {
    await evalJS(`(function(){var b=document.querySelector('.bb-btn[data-action="${action}"]');if(b)b.click();return true;})()`);
    await sleep(500);
    const dm = await evalJS(`(function(){var d=document.getElementById('drawer-${name === 'msg' ? 'message' : 'photos'}');
      if(!d)return null;var r=d.getBoundingClientRect();
      return {left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom),
        h:Math.round(r.height),w:Math.round(r.width),iw:window.innerWidth,ih:window.innerHeight,
        bottomSheet:(Math.abs(r.bottom-window.innerHeight)<3&&Math.abs(r.left)<3&&Math.abs(r.right-window.innerWidth)<3),
        contentVisible:(r.top<window.innerHeight-40)};})()`);
    await shot(`C_drawer_${name}_375x667.png`);
    const issues = [];
    if (dm && !dm.bottomSheet) issues.push(`抽屉 drawer-${name} 非底部滑出或贴边异常: ${JSON.stringify(dm)}`);
    if (dm && !dm.contentVisible) issues.push(`抽屉 drawer-${name} 内容停在屏幕外(top=${dm.top})`);
    report.viewports[`C_drawer_${name}_375x667`] = { measure: dm, issues };
    // 关闭
    await evalJS(`(function(){var m=document.getElementById('drawer-mask');if(m)m.click();return true;})()`);
    await sleep(350);
  }
  // 设置抽屉
  await evalJS(`(function(){var b=document.getElementById('btn-settings');if(b)b.click();return true;})()`);
  await sleep(500);
  const dmSet = await evalJS(`(function(){var d=document.getElementById('drawer-settings');if(!d)return null;var r=d.getBoundingClientRect();
    return {left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom),h:Math.round(r.height),
      bottomSheet:(Math.abs(r.bottom-window.innerHeight)<3&&Math.abs(r.left)<3&&Math.abs(r.right-window.innerWidth)<3),
      contentVisible:(r.top<window.innerHeight-40)};})()`);
  await shot('C_drawer_settings_375x667.png');
  report.viewports['C_drawer_settings_375x667'] = { measure: dmSet, issues: (dmSet && !dmSet.bottomSheet) ? ['设置抽屉非底部滑出: ' + JSON.stringify(dmSet)] : [] };
  await evalJS(`(function(){var m=document.getElementById('drawer-mask');if(m)m.click();return true;})()`);
  await sleep(350);

  /* ---- 视口 A：仪式（直接启动，注入合成照片）---- */
  await evalJS(`(function(){
    ['view-memorial','view-form'].forEach(function(id){var e=document.getElementById(id);if(e)e.hidden=true;});
    var c=document.createElement('canvas');c.width=300;c.height=400;var x=c.getContext('2d');
    var g=x.createLinearGradient(0,0,300,400);g.addColorStop(0,'#c9d6df');g.addColorStop(1,'#52616b');x.fillStyle=g;x.fillRect(0,0,300,400);
    x.fillStyle='#e0e1dd';x.font='60px serif';x.fillText('\\u{1F43E}',110,220);
    var img=new Image();
    window.__cerDone=false;
    return new Promise(function(res){
      img.onload=function(){
        var d={version:1,state:'CEREMONY',ceremonyStep:1,
          pet:{ownerName:'测试主人',petName:'小白',birthday:'2015-06-01',deathDate:'2026-08-20',gender:'male',breed:''},
          stele:{erectedAt:''},incense:{lastLightTime:0,totalLightDays:0,continuousLightDays:0},
          messages:[],mainPhotoId:'',photosMeta:[],settings:{bgmEnabled:false,reducedMotion:false}};
        PM.Director.start({data:d,photoImg:img,onFinish:function(){window.__cerDone=true;}});
        res(true);
      };
      img.src=c.toDataURL();
    });})()`);

  const CER_SEL = ['#ceremony-caption', '#ceremony-btn', '#ceremony-skip', '#ceremony-canvas'];
  const actShots = [];
  for (let i = 0; i < 9; i++) {
    await sleep(2800);
    const cm = await evalJS(measureExpr(CER_SEL));
    const btnState = await evalJS(`(function(){var b=document.getElementById('ceremony-btn');
      return b?{hidden:b.hidden,opacity:getComputedStyle(b).opacity,text:b.textContent}:null;})()`);
    const capState = await evalJS(`(function(){var c=document.getElementById('ceremony-caption');
      return c?{hidden:c.hidden,opacity:getComputedStyle(c).opacity,w:Math.round(c.getBoundingClientRect().width),right:Math.round(c.getBoundingClientRect().right)}:null;})()`);
    const fname = `D_ceremony_step${i}_375x667.png`;
    await shot(fname);
    const issues = [];
    if (cm.pageOverflow) issues.push(`仪式 step${i} 页面横向溢出`);
    if (capState && !capState.hidden && capState.right > 375 + 1) issues.push(`仪式 step${i} 文案超右边界 right=${capState.right}`);
    if (btnState && !btnState.hidden) {
      const br = cm.rects['#ceremony-btn'];
      if (br && !br.inView) issues.push(`仪式 step${i} 推进按钮超出视口 ${JSON.stringify(br)}`);
    }
    report.viewports[`D_ceremony_step${i}_375x667`] = { btn: btnState, caption: capState, issues };
    actShots.push(fname);
    const done = await evalJS(`window.__cerDone`);
    // 推进：可见按钮则点击
    await evalJS(`(function(){var b=document.getElementById('ceremony-btn');if(b&&!b.hidden){b.click();return 'click';}return 'wait';})()`);
    if (done) break;
  }

  /* ---- 视口 B：390×844 关键页 ---- */
  await setViewport(390, 844);
  // 纪念馆（BUILT 数据仍在）
  await nav(APP);
  await sleep(900);
  let mMem390 = await evalJS(measureExpr(MEM_SEL));
  await shot('E_memorial_390x844.png');
  checkViewport('E_memorial_390x844', mMem390);
  // 抽屉
  await evalJS(`(function(){var b=document.querySelector('.bb-btn[data-action="message"]');if(b)b.click();return true;})()`);
  await sleep(500);
  await shot('E_drawer_message_390x844.png');
  await evalJS(`(function(){var m=document.getElementById('drawer-mask');if(m)m.click();return true;})()`);
  await sleep(300);
  // 填写页
  await evalJS(`localStorage.clear(); true`);
  await nav(APP);
  await evalJS(`(function(){document.getElementById('f-birthday').value='2015-06-01';document.getElementById('f-death').value='2026-08-20';return true;})()`);
  await sleep(200);
  let mForm390 = await evalJS(measureExpr(FORM_SEL));
  await shot('E_form_390x844.png');
  checkViewport('E_form_390x844', mForm390);

  report.consoleErrors = consoleErrors;
  return report;
}

/* ---------------- 输出 ---------------- */
function printReport() {
  console.log('\n================ 响应式验证报告 ================');
  let totalIssues = 0;
  for (const [label, v] of Object.entries(report.viewports)) {
    const m = v.measure;
    const inner = m && m.inner ? `${m.inner[0]}x${m.inner[1]}` : '';
    const n = (v.issues || []).length;
    totalIssues += n;
    console.log(`\n● ${label} ${inner} — ${n === 0 ? '✅ 无布局问题' : '⚠️ ' + n + ' 个问题'}`);
    if (m && m.docScrollW != null) console.log(`   docScrollW=${m.docScrollW} innerW=${m.inner ? m.inner[0] : '?'} pageOverflow=${m.pageOverflow}`);
    if (m && m.bbBtns && m.bbBtns.length) console.log(`   底部按钮: ` + m.bbBtns.map((b) => `${b.label}(right=${b.right}${b.inView ? '' : '❌'})`).join(' '));
    (v.issues || []).forEach((s) => console.log('   - ' + s));
  }
  console.log('\n---------------- 控制台报错 ----------------');
  if (consoleErrors.length === 0) console.log('✅ 全程零 console error / warning / exception');
  else consoleErrors.slice(0, 40).forEach((e) => console.log('   ! ' + e));
  console.log('\n---------------- 总结 ----------------');
  console.log(`布局问题合计: ${totalIssues}  |  截图目录: ${OUT}`);
  console.log('================================================\n');
}

try {
  await run();
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  printReport();
} catch (err) {
  console.error('测试驱动异常:', err.message);
  try { writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2)); } catch (_) {}
  printReport();
  process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (_) {}
  try { server.close(); } catch (_) {}
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }); } catch (_) {} process.exit(process.exitCode || 0); }, 400);
}
