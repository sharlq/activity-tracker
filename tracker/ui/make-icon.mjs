// Draws رقيب's icon (the Raqib mark: a cream crescent cradling a dawn dot, on teal) as
// icon.png and a multi-size icon.ico. Run with node; no dependencies.
// Geometry matches icon.svg and the design system's logo files, on a 256 grid.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const TEAL = [15, 118, 110], CREAM = [246, 241, 228], DAWN = [224, 164, 67];
// Two drawings: `large` for 48px and up, `small` (heavier crescent, bigger dot) for 16–32px.
const DESIGNS = {
  large: { plate: { inset: 8, r: 56 }, scale: 0.8, shift: -13.36, outer: [128, 128, 92], inner: [96.26, 115.82, 84], dot: [132.76, 129.83, 19] },
  small32: { plate: { inset: 0, r: 56 }, scale: 0.84, shift: -7.92, outer: [128, 128, 100], inner: [86.93, 112.23, 82], dot: [119.78, 124.85, 24] },
  small16: { plate: { inset: 0, r: 48 }, scale: 0.9, shift: -7.92, outer: [128, 128, 100], inner: [86.93, 112.23, 82], dot: [119.78, 124.85, 24] },
};

const clamp = (v) => Math.max(0, Math.min(1, v));
const circle = (x, y, [cx, cy, r]) => Math.hypot(x - cx, y - cy) - r;
function roundedSquare(x, y, inset, r) {
  const half = 128 - inset;
  const qx = Math.abs(x - 128) - (half - r), qy = Math.abs(y - 128) - (half - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function draw(size, d) {
  const px = new Uint8Array(size * size * 4);
  const unit = 256 / size; // grid units per pixel
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) * unit, y = (j + 0.5) * unit;
      const plateA = clamp(0.5 - roundedSquare(x, y, d.plate.inset, d.plate.r) / unit);
      // Undo the mark's transform: scale about the centre, then its horizontal shift.
      const mx = (x - 128) / d.scale + 128 - d.shift, my = (y - 128) / d.scale + 128;
      const markUnit = unit / d.scale;
      const crescent = Math.max(circle(mx, my, d.outer), -circle(mx, my, d.inner));
      const cresA = clamp(0.5 - crescent / markUnit);
      const dotA = clamp(0.5 - circle(mx, my, d.dot) / markUnit);
      let rgb = TEAL;
      rgb = rgb.map((c, k) => c * (1 - cresA) + CREAM[k] * cresA);
      rgb = rgb.map((c, k) => c * (1 - dotA) + DAWN[k] * dotA);
      const at = (j * size + i) * 4;
      px[at] = Math.round(rgb[0]); px[at + 1] = Math.round(rgb[1]); px[at + 2] = Math.round(rgb[2]); px[at + 3] = Math.round(plateA * 255);
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
function png(size, px) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++) { raw[j * (size * 4 + 1)] = 0; Buffer.from(px.buffer, j * size * 4, size * 4).copy(raw, j * (size * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// A 32-bit bitmap frame (BGRA, bottom-up, with an all-clear AND mask): what Windows expects below 256px.
function bmp(size, px) {
  const info = Buffer.alloc(40);
  info.writeUInt32LE(40, 0); info.writeInt32LE(size, 4); info.writeInt32LE(size * 2, 8);
  info.writeUInt16LE(1, 12); info.writeUInt16LE(32, 14); info.writeUInt32LE(size * size * 4, 20);
  const pixels = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const from = (j * size + i) * 4, to = ((size - 1 - j) * size + i) * 4;
    pixels[to] = px[from + 2]; pixels[to + 1] = px[from + 1]; pixels[to + 2] = px[from]; pixels[to + 3] = px[from + 3];
  }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  return Buffer.concat([info, pixels, mask]);
}

const dir = new URL('./', import.meta.url);
// Notifications show the icon small, so icon.png uses the heavier small drawing at full resolution.
const notification = png(256, draw(256, DESIGNS.small32));
writeFileSync(new URL('icon.png', dir), notification);

// The .ico: bitmap frames for the taskbar and Start menu (16, 24, 32, 48), a PNG frame for 256.
const frames = [[16, DESIGNS.small16], [24, DESIGNS.small32], [32, DESIGNS.small32], [48, DESIGNS.large], [256, DESIGNS.large]].map(([size, d]) => ({ size, data: size === 256 ? png(size, draw(size, d)) : bmp(size, draw(size, d)) }));
const header = Buffer.alloc(6 + frames.length * 16);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach(({ size, data }, n) => {
  const e = 6 + n * 16;
  header[e] = size === 256 ? 0 : size; header[e + 1] = size === 256 ? 0 : size; header[e + 2] = 0; header[e + 3] = 0;
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(data.length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += data.length;
});
writeFileSync(new URL('icon.ico', dir), Buffer.concat([header, ...frames.map((f) => f.data)]));
console.log(`icon.png ${notification.length} bytes, icon.ico ${offset} bytes (${frames.map((f) => f.size).join(', ')})`);
