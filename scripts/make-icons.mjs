// Draws the app icons (a gold spade in a gold ring on green felt) and writes
// them to public/icons as PNGs. No dependencies: shapes are rendered with 4×4
// supersampling and encoded with Node's zlib.
//
// Run once after changing the design:  node scripts/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/* ---------- PNG encoding ---------- */
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- Drawing ---------- */
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const FELT_IN = hex('#17804f');
const FELT_OUT = hex('#063a24');
const GOLD = hex('#e9c46a');
const GOLD_HI = hex('#f6dd94');
const GOLD_LO = hex('#c4923a');

// Spade in its own units: a heart curve turned point-up, plus a flared stem.
// Spans u in [-1.14, 1.14] and v in [-1, 1.75] (v points down).
function inSpade(u, v) {
  const a = u * u + v * v - 1;
  if (a * a * a - u * u * v * v * v <= 0) return true;
  if (v >= 0.75 && v <= 1.75) {
    const t = (v - 0.75) / 1.0;
    return Math.abs(u) <= 0.07 + 0.43 * Math.pow(t, 1.7);
  }
  return false;
}

function drawIcon(size, { spade, ring, ringWidth }) {
  const px = Buffer.alloc(size * size * 4);
  const k = (spade * size) / 2.75;                 // spade units → pixels
  const cx = size / 2;
  const cy = size / 2 - 0.375 * k;                 // centre the spade's full height
  const R = ring * size;
  const half = (ringWidth * size) / 2;
  const S = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.42;
      let color = mix(FELT_IN, FELT_OUT, Math.min(1, Math.hypot(dx, dy) / 0.75));
      let ringCov = 0, spadeCov = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const fx = x + (sx + 0.5) / S;
          const fy = y + (sy + 0.5) / S;
          if (Math.abs(Math.hypot(fx - size / 2, fy - size / 2) - R) <= half) ringCov++;
          if (inSpade((fx - cx) / k, (fy - cy) / k)) spadeCov++;
        }
      }
      ringCov /= S * S;
      spadeCov /= S * S;
      if (ringCov) color = mix(color, GOLD, ringCov);
      if (spadeCov) {
        const t = Math.min(1, Math.max(0, (y - (cy - k)) / (2.75 * k)));
        color = mix(color, mix(GOLD_HI, GOLD_LO, t), spadeCov);
      }
      const i = (y * size + x) * 4;
      px[i] = Math.round(color[0]);
      px[i + 1] = Math.round(color[1]);
      px[i + 2] = Math.round(color[2]);
      px[i + 3] = 255;
    }
  }
  return encodePNG(size, px);
}

const STANDARD = { spade: 0.56, ring: 0.43, ringWidth: 0.026 };
// Maskable icons get cropped to a circle or squircle: keep everything inside the
// central 80% safe zone.
const MASKABLE = { spade: 0.42, ring: 0.345, ringWidth: 0.022 };

await mkdir(outDir, { recursive: true });
const files = [
  ['icon-192.png', 192, STANDARD],
  ['icon-512.png', 512, STANDARD],
  ['icon-maskable-512.png', 512, MASKABLE],
  ['apple-touch-icon.png', 180, STANDARD],
];
for (const [name, size, opts] of files) {
  await writeFile(join(outDir, name), drawIcon(size, opts));
  console.log(`wrote public/icons/${name}`);
}
