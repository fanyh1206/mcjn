/* =========================================================
   check-form-toast-cdp.mjs —— 问题1 复验：开始按钮点击校验 toast
   场景A：空表单点击 → toast 首条错误
   场景B：离世日期晚于今天点击 → toast 日期错误
   运行：node tools/check-form-toast-cdp.mjs
   产物：tools/preview/form_toast_*.png
   ========================================================= */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9357;
const HTTP = 8125;
const ROOT = process.cwd();
const OUT = join(ROOT, 'tools', 'preview');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.wav': 'audio/wav', '.json': 'application/json' };

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.statusCode = 404; res.end('nf'); return; }
  res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(HTTP, '127.0.0.1', r));

const userData = mkdtempSync(join(tmpdir(), 'cdp-formtoast-'));
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
  const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
    console.log('📸 ' + name);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/index.html` });
  await sleep(1500);

  // 场景A：空表单直接点击
  const disabledA = await evalJS(`document.getElementById('btn-start').disabled`);
  await evalJS(`document.getElementById('btn-start').click()`);
  await sleep(400);
  const toastA = await evalJS(`(() => { const t = document.getElementById('toast'); return { hidden: t.hidden, text: t.textContent }; })()`);
  console.log('场景A disabled=', disabledA, ' toast=', JSON.stringify(toastA));
  await shot('form_toast_empty.png');

  // 场景B：填好其余必填项，离世日期设为未来
  await sleep(2400); // 等上一条 toast 消失
  await evalJS(`
    document.getElementById('f-owner').value = '测试主人';
    document.getElementById('f-pet').value = '小白';
    document.getElementById('f-birthday').value = '2015-06-01';
    document.getElementById('f-death').value = '2027-01-01';
    document.getElementById('f-death').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('btn-start').click();
  `);
  await sleep(400);
  const toastB = await evalJS(`(() => { const t = document.getElementById('toast'); return { hidden: t.hidden, text: t.textContent }; })()`);
  console.log('场景B toast=', JSON.stringify(toastB));
  await shot('form_toast_future.png');
}

try {
  await main();
} catch (e) {
  console.error('❌', e.message);
  process.exitCode = 1;
} finally {
  try { chrome.kill('SIGKILL'); } catch (_) {}
  await sleep(300);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  server.close();
}
