/**
 * 生成 APK 里各分辨率桌面图标（复用网站图标的画法，纯 Node 无依赖）
 * 用法：node make-launcher-icons.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = buf => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const lerp = (a, b, t) => a + (b - a) * t;
const C1 = [255, 179, 209], C2 = [168, 211, 255];
const inHeart = (px, py, S) => {
  const k = S * 0.36 * 0.62;
  const nx = (px - S / 2) / k, ny = (S / 2 - py) / k - 0.13;
  const a = nx * nx + ny * ny - 1;
  return a * a * a - nx * nx * ny * ny * ny <= 0;
};
function icon(S) {
  const buf = Buffer.alloc(S * S * 4), SS = 4;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let heart = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++)
      if (inHeart(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, S)) heart++;
    const t = (x + y) / (2 * S), ha = (heart / (SS * SS)) * 0.95;
    const i = (y * S + x) * 4;
    buf[i] = Math.round(lerp(lerp(C1[0], C2[0], t), 255, ha));
    buf[i + 1] = Math.round(lerp(lerp(C1[1], C2[1], t), 255, ha));
    buf[i + 2] = Math.round(lerp(lerp(C1[2], C2[2], t), 255, ha));
    buf[i + 3] = 255;
  }
  return encodePNG(S, S, buf);
}
for (const [dir, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
  const out = join(HERE, 'res', 'mipmap-' + dir);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'ic_launcher.png'), icon(size));
  console.log('生成 mipmap-' + dir + '/ic_launcher.png (' + size + 'px)');
}
