/**
 * QR 编码器对拍自测：把 index.html 内自实现的 QR 与 npm `qrcode` 逐位比较。
 * 用法：node qr-crosscheck.mjs <qrcode模块路径>
 * 前置：在临时目录 `npm install qrcode`，再执行本脚本。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
const start = html.indexOf('const QR = (function(){');
const tail = html.indexOf('return { encode: encode', start);
const end = html.indexOf('})();', tail) + 5;
if (start < 0 || tail < 0 || end < 5) throw new Error('没有找到内置 QR 编码器');
const QR = new Function(html.slice(start, end) + '\nreturn QR;')();

const require = createRequire(import.meta.url);
const QRCode = require(process.argv[2] || 'qrcode');

const samples = [
  'HELLO',
  'https://example.com/情侣课表?x=1',
  'LOVE-DEMO-2026-JH01'.repeat(1),
  'CSYNC1.' + 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/'.repeat(12),   // ≈ 650 字符
  'CSYNC1.' + 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/'.repeat(24)    // ≈ 1250 字符（真实同步包量级）
];

let pass = 0, fail = 0;
const failDetail = [];
for (const text of samples) {
  const bytes = Buffer.byteLength(text, 'utf8');
  for (let m = 0; m < 8; m++) {
    const mine = QR.encode(text, m);
    // 参考实现强制 byte 模式，才能与内置编码器逐位比较
    const ref = QRCode.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: 'L', maskPattern: m });
    const rs = ref.modules.size;
    if (mine.size !== rs) { fail++; failDetail.push(`len=${bytes} mask=${m} 尺寸不一致 ${mine.size} vs ${rs}`); continue; }
    let diff = 0, first = null;
    for (let y = 0; y < rs; y++) for (let x = 0; x < rs; x++) {
      const a = mine.get(x, y), b = ref.modules.get(y, x) === 1;
      if (a !== b) { diff++; if (!first) first = `${x},${y}`; }
    }
    if (diff === 0) pass++;
    else { fail++; failDetail.push(`len=${bytes} mask=${m} 差异 ${diff} 个模块，首个 (${first})`); }
  }
  // 自动选掩码是否与参考实现一致
  const auto = QR.encode(text);
  const autoRef = QRCode.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: 'L' });
  const autoDiff = (() => {
    if (auto.size !== autoRef.modules.size) return -1;
    let d = 0;
    for (let y = 0; y < auto.size; y++) for (let x = 0; x < auto.size; x++)
      if (auto.get(x, y) !== (autoRef.modules.get(y, x) === 1)) d++;
    return d;
  })();
  console.log(`长度 ${String(bytes).padStart(4)} 字节 → 版本 ${(auto.size - 17) / 4} 尺寸 ${auto.size}，自动掩码与参考实现差异 ${autoDiff} 模块`);
}
console.log('\n掩码逐位对拍：通过 ' + pass + '，失败 ' + fail);
if (failDetail.length) console.log(failDetail.slice(0, 12).join('\n'));

/* ---------- 用真实解码器 jsQR 做端到端回读验证 ---------- */
let jsQR = null;
try { jsQR = require('jsqr'); } catch { /* 没装就跳过 */ }
if (jsQR) {
  let ok = 0, bad = 0;
  for (const text of samples) {
    const qr = QR.encode(text);
    const n = qr.size, quiet = 4, scale = 4, dim = (n + quiet * 2) * scale;
    const rgba = new Uint8ClampedArray(dim * dim * 4).fill(255);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!qr.get(x, y)) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const px = ((y + quiet) * scale + dy) * dim + ((x + quiet) * scale + dx);
        rgba[px * 4] = rgba[px * 4 + 1] = rgba[px * 4 + 2] = 0;
      }
    }
    const res = jsQR(rgba, dim, dim);
    if (res && res.data === text) { ok++; console.log(`jsQR 回读成功：${Buffer.byteLength(text, 'utf8')} 字节（版本 ${(n - 17) / 4}）`); }
    else { bad++; console.log(`jsQR 回读失败：长度 ${Buffer.byteLength(text, 'utf8')}，结果 ${res ? JSON.stringify(res.data.slice(0, 40)) : 'null'}`); }
  }
  console.log('真实解码器回读：成功 ' + ok + '，失败 ' + bad);
  fail += bad;
}
process.exit(fail ? 1 : 0);
