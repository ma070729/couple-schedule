/**
 * 用 Chrome DevTools Protocol 做真实渲染验证（真机尺寸 + 真异步等待 + 收集控制台错误）。
 * 用法：node cdp-shot.mjs <url> <out.png> [width] [height] [evalJS] [waitMs]
 * 例：  node cdp-shot.mjs file:///.../index.html shot.png 390 1300 "loadDemo();render();" 1200
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const [url, out, w = '390', h = '1300', evalJS = '', waitMs = '1500', reloadEval = ''] = process.argv.slice(2);
const PORT = 9333;

const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
const extra = process.env.CDP_EXTRA_ARGS ? process.env.CDP_EXTRA_ARGS.split(';;') : [];
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--allow-file-access-from-files', ...extra, 'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('Chrome 调试端口未就绪');
}

const ws = new WebSocket(await targetWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const events = [];
const logs = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) {
    events.push(m.method);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
      logs.push('[console.' + m.params.type + '] ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown')
      logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error')
      logs.push('[log] ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  }
};
const send = (method, params = {}) => new Promise(res => {
  const id = ++msgId; pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: +w, height: +h, deviceScaleFactor: 2, mobile: true, screenWidth: +w, screenHeight: +h
});
await send('Page.navigate', { url });
for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
await sleep(1500);                                    // 等 CDN 脚本与首屏渲染

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const res = r.result || {};
  if (res.exceptionDetails) return { error: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return { value: res.result ? res.result.value : undefined };
};
{
  const info = await evaluate('location.href + " | title=" + document.title + " | scripts=" + document.scripts.length + " | bodyLen=" + document.body.innerHTML.length');
  console.log('页面状态:', JSON.stringify(info));
}

if (evalJS) {
  const r = await send('Runtime.evaluate', { expression: evalJS, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) logs.push('[eval] ' + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  else if (r.result?.result?.value !== undefined) logs.push('[eval-result] ' + JSON.stringify(r.result.result.value));
}
await sleep(+waitMs);
// 可选：刷新页面后再跑一段脚本（用于验证 localStorage 持久化）
if (reloadEval) {
  await send('Page.reload', { ignoreCache: false });
  for (let i = 0; i < 80; i++) { await sleep(100); if (events.filter(e => e === 'Page.loadEventFired').length > 1) break; }
  await sleep(1200);
  const r2 = await evaluate(reloadEval);
  console.log('刷新后结果:', JSON.stringify(r2));
}
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('截图已保存:', out, '(', w + 'x' + h, ')');
console.log(logs.length ? '控制台输出:\n  ' + logs.join('\n  ') : '控制台无错误/警告');
await send('Browser.close');
chrome.kill();
process.exit(0);
