/* =========================================================
   webp-cdp.mjs —— 零依赖 PNG→WebP 转换工具
   借 headless Chrome 的 OffscreenCanvas.convertToBlob('image/webp')
   把 assets/img/*.png 转为同尺寸 WebP（assets.js 注册表 WebP 优先）。
   运行：node tools/webp-cdp.mjs [quality=0.82]
   ========================================================= */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9344;
const IMG = join(process.cwd(), 'assets', 'img');
const Q = parseFloat(process.argv[2] || '0.82');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const userData = mkdtempSync(join(tmpdir(), 'cdp-webp-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userData}`,
  '--no-first-run', '--no-default-browser-check',
  '--no-sandbox', '--disable-gpu', '--mute-audio',
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

async function main() {
  const targets = readdirSync(IMG).filter((f) => f.endsWith('.png'));
  // 页面级 target 的 WS 才支持 Runtime.evaluate（/json/version 是浏览器级）
  const list = await getJson('/json/list');
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('未找到页面 target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('WS 连接失败')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  for (const f of targets) {
    const b64 = readFileSync(join(IMG, f)).toString('base64');
    const expr = `(async () => {
      const blob = await (await fetch('data:image/png;base64,${b64}')).blob();
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext('2d').drawImage(bmp, 0, 0);
      const out = await c.convertToBlob({ type: 'image/webp', quality: ${Q} });
      const u = new Uint8Array(await out.arrayBuffer());
      let s = '';
      for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
      return { w: bmp.width, h: bmp.height, b64: btoa(s) };
    })()`;
    const { result } = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const { w, h, b64: outB64 } = result.value;
    const out = join(IMG, f.replace(/\.png$/, '.webp'));
    writeFileSync(out, Buffer.from(outB64, 'base64'));
    const pk = (readFileSync(join(IMG, f)).length / 1024).toFixed(0);
    const wk = (readFileSync(out).length / 1024).toFixed(0);
    console.log(`✅ ${f} ${w}x${h}: PNG ${pk}KB → WebP ${wk}KB (${Math.round(wk / pk * 100)}%)`);
  }
  ws.close();
}

main().then(() => {
  chrome.kill();
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  process.exit(0);
}).catch((e) => {
  console.error('❌', e.message);
  chrome.kill();
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  process.exit(1);
});
