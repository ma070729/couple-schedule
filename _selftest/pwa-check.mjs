/**
 * 检查站点是否满足"安装成 App"(PWA) 的条件：
 * 用 CDP 的 Page.getAppManifest / Page.getInstallabilityErrors 拿到 Chrome 的真实判断。
 * 用法：node pwa-check.mjs <url>
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2];
const PORT = 9344;
const profile = mkdtempSync(join(tmpdir(), 'pwa-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome 未就绪');
}
const ws = new WebSocket(await targetWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(3500);

const manifest = await send('Page.getAppManifest');
const errors = await send('Page.getInstallabilityErrors');

console.log('目标:', url);
const m = manifest.result || {};
console.log('\n【manifest】');
console.log('  URL      :', m.url || '(无)');
console.log('  解析错误 :', JSON.stringify(m.errors || []));
if (m.data) {
  try {
    const d = JSON.parse(m.data);
    console.log('  名称     :', d.name, '/', d.short_name);
    console.log('  start_url:', d.start_url, ' display:', d.display, ' 主题色:', d.theme_color);
    console.log('  图标     :', (d.icons || []).map(i => i.sizes + ' ' + (i.purpose || 'any')).join(' | '));
  } catch (e) { console.log('  数据解析失败'); }
}
console.log('\n【Chrome 安装性检查】');
const list = (errors.result && errors.result.installabilityErrors) || [];
if (!list.length) console.log('  ✅ 没有任何安装障碍 —— 手机上会直接出现「安装应用」入口');
else list.forEach(x => console.log('  ❌', x.errorId, x.errorArguments ? JSON.stringify(x.errorArguments) : ''));
await send('Browser.close');
chrome.kill();
process.exit(0);
