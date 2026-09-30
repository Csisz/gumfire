// Generates the M1 test map masks (PNG) + metadata (JSON) into apps/sandbox/public/maps.
// Mask convention (plan §8.3): transparent = air, neutral grey #808080 = indestructible rock,
// any other opaque colour = soil. Maps are original, hand-designed with simple shapes.
// Run: `pnpm gen:maps` (outputs are committed).
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const W = 1920;
const H = 696;
const AIR = 0, SOIL = 1, ROCK = 2;

// ---------- minimal PNG encoder (RGBA8, no dependencies) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- drawing helpers on a material grid ----------
function grid() {
  return new Uint8Array(W * H);
}
function set(g, x, y, m) {
  if (x >= 0 && y >= 0 && x < W && y < H) g[y * W + x] = m;
}
function fillRect(g, x0, y0, x1, y1, m) {
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) g[y * W + x] = m;
}
function fillEllipse(g, cx, cy, rx, ry, m) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) set(g, x, y, m);
    }
}
function fillPolygon(g, pts, m) {
  const ys = pts.map((p) => p[1]);
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]); x < xs[k + 1]; x++) set(g, x, y, m);
  }
}
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// ---------- map 1: slice-island (the vertical-slice battlefield) ----------
function sliceIsland() {
  const g = grid();
  const left = 130, right = 1790;
  for (let x = left; x <= right; x++) {
    let surf = 440 + 58 * Math.sin(x / 170) + 32 * Math.sin(x / 61 + 1.3) + 22 * Math.sin(x / 290 + 2.1);
    // rounded cliffs at both ends
    const edge = Math.min(x - left, right - x);
    surf += (1 - smooth(edge / 90)) * 260;
    for (let y = Math.max(0, Math.floor(surf)); y < H; y++) set(g, x, y, SOIL);
  }
  // overhang bulge on the right
  fillEllipse(g, 1560, 385, 110, 34, SOIL);
  // floating sponge ledge in the middle with a flat top
  fillEllipse(g, 960, 238, 165, 30, SOIL);
  fillRect(g, 780, 200, 1140, 226, AIR);
  // caves and a tunnel
  fillEllipse(g, 610, 540, 95, 46, AIR);
  fillEllipse(g, 1285, 505, 78, 32, AIR);
  fillEllipse(g, 1340, 530, 60, 26, AIR);
  // a hard-toffee (indestructible) boulder embedded in the ground
  fillEllipse(g, 1080, 585, 62, 48, ROCK);
  // two candle-stub pillars standing on the surface
  for (const cx of [330, 1680]) {
    let top = 0;
    while (top < H && g[top * W + cx] !== SOIL) top++;
    fillRect(g, cx - 10, top - 86, cx + 10, top + 4, SOIL);
  }
  return { mat: g, meta: { id: 'slice-island', name: 'Birthday Aftermath — Slice Island', waterY: 640, theme: 'birthday' } };
}

// ---------- map 2: test-shapes (movement & collision scenarios) ----------
function testShapes() {
  const g = grid();
  const floor = 600;
  fillRect(g, 40, floor, W - 40, H, SOIL);
  // ramps: 30°, 45°, 60° (rise over run = tan)
  const ramp = (x0, run, deg) => {
    const rise = Math.round(run * Math.tan((deg * Math.PI) / 180));
    fillPolygon(g, [[x0, floor], [x0 + run, floor - rise], [x0 + run + 40, floor - rise], [x0 + run + 40, floor]], SOIL);
  };
  ramp(80, 260, 30);
  ramp(460, 180, 45);
  ramp(760, 90, 60);
  // pillar
  fillRect(g, 960, 440, 1000, floor, SOIL);
  // 1-px wall (tunnelling test)
  fillRect(g, 1060, 500, 1061, floor, SOIL);
  // floating ledge
  fillRect(g, 1120, 420, 1320, 440, SOIL);
  // bowl
  fillEllipse(g, 1480, floor, 90, 70, AIR);
  // rock block
  fillRect(g, 1600, 540, 1650, floor, ROCK);
  // overhang ceiling attached to a wall
  fillRect(g, 1700, 470, 1860, 488, SOIL);
  fillRect(g, 1840, 470, 1860, floor, SOIL);
  return { mat: g, meta: { id: 'test-shapes', name: 'Test Shapes', waterY: 660, theme: 'birthday' } };
}

// ---------- write ----------
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'apps', 'sandbox', 'public', 'maps');
mkdirSync(outDir, { recursive: true });
const COLOURS = { [SOIL]: [233, 184, 114, 255], [ROCK]: [128, 128, 128, 255] };
const index = [];
for (const { mat, meta } of [sliceIsland(), testShapes()]) {
  const rgba = Buffer.alloc(W * H * 4);
  let solid = 0;
  for (let i = 0; i < mat.length; i++) {
    const c = COLOURS[mat[i]];
    if (c) {
      rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = c[3];
      solid++;
    }
  }
  writeFileSync(join(outDir, `${meta.id}.png`), encodePng(W, H, rgba));
  writeFileSync(join(outDir, `${meta.id}.json`), JSON.stringify({ ...meta, width: W, height: H }, null, 2) + '\n');
  index.push(meta.id);
  console.log(`${meta.id}: ${W}×${H}, ${((solid / mat.length) * 100).toFixed(1)}% solid`);
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
