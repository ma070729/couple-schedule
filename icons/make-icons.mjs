/**
 * 生成 PWA 图标（马卡龙渐变 + 白色爱心），纯 Node 实现，无需任何依赖。
 * 用法：node make-icons.mjs
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;                                   // filter = none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 图形 ---------- */
const lerp = (a, b, t) => a + (b - a) * t;
const C1 = [255, 179, 209];   // #ffb3d1
const C2 = [168, 211, 255];   // #a8d3ff

function inRoundedRect(x, y, S, r) {
  const rx = Math.min(Math.max(x, r), S - r), ry = Math.min(Math.max(y, r), S - r);
  return (x - rx) ** 2 + (y - ry) ** 2 <= r * r;
}
// 心形隐函数：(x²+y²-1)³ - x²y³ ≤ 0（y 轴向上）
function inHeart(px, py, S, scale) {
  const k = S * 0.36 * scale;
  const nx = (px - S / 2) / k;
  const ny = (S / 2 - py) / k - 0.13;
  const a = nx * nx + ny * ny - 1;
  return a * a * a - nx * nx * ny * ny * ny <= 0;
}
function draw(S, heartScale, rounded) {
  const buf = Buffer.alloc(S * S * 4);
  const SS = 4;                          // 4x4 超采样抗锯齿
  const r = S * 0.22;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let covBg = 0, covHeart = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          if (!rounded || inRoundedRect(px, py, S, r)) covBg++;
          if (inHeart(px, py, S, heartScale)) covHeart++;
        }
      }
      const n = SS * SS;
      const bgA = covBg / n, hA = covHeart / n;
      const t = (x + y) / (2 * S);                          // 45° 渐变
      let cr = lerp(C1[0], C2[0], t), cg = lerp(C1[1], C2[1], t), cb = lerp(C1[2], C2[2], t);
      // 白色爱心叠加（alpha 0.95）
      const ha = hA * 0.95;
      cr = lerp(cr, 255, ha); cg = lerp(cg, 255, ha); cb = lerp(cb, 255, ha);
      const i = (y * S + x) * 4;
      buf[i] = Math.round(cr); buf[i + 1] = Math.round(cg); buf[i + 2] = Math.round(cb);
      buf[i + 3] = Math.round(bgA * 255);
    }
  }
  return encodePNG(S, S, buf);
}

const jobs = [
  ['icon-512.png', 512, 0.62, true],
  ['icon-192.png', 192, 0.62, true],
  ['icon-maskable-512.png', 512, 0.45, false]     // maskable 安全区（内容缩到中间 60%），不裁圆角
];
for (const [name, size, hs, rounded] of jobs) {
  writeFileSync(join(DIR, name), draw(size, hs, rounded));
  console.log('生成', name);
}
