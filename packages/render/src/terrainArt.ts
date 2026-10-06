import { PAINT_MARGIN, noise2, type RGB, type TerrainLike, type TerrainTheme } from './terrainPaint.js';

/**
 * HD terrain painting (M15 art pass). The collision bitmap stays 1 px = 1 world px; the picture is
 * painted at `scale`× (default 2) with anti-aliased edges and *textures*: a tileable soil image, a
 * crust strip that runs along every original top surface, rock, biscuit and back-wall images.
 * Textures are either painted images (art packs, loaded by the client) or generated here
 * procedurally from a theme's colours, so every theme looks finished even without an art pack.
 *
 * Shading on top of the textures: soil darkens with depth below the surface, a soft ambient
 * occlusion band runs inside every edge, the crust casts a short shadow, and a thick dark outline
 * frames every shape. Pure (no Pixi, no DOM): runs in Node tests.
 */

export interface TexImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, straight alpha. */
  readonly data: Uint8ClampedArray | Uint8Array;
}

export interface TerrainArt {
  /** Output pixels per world pixel. */
  scale: number;
  soil: TexImage;
  /** Tiles in x; row = depth below the surface in output px; transparent rows show soil. */
  crust: TexImage;
  rock: TexImage;
  girder: TexImage;
  backWall: TexImage;
  backWallAlpha: number;
  outline: RGB;
  /** Outline thickness, world px. */
  outlinePx: number;
  border: RGB;
  scorch: RGB;
  scorchDark: RGB;
  scorchPx: number;
  /** Soil darkens over this many world px below the surface. */
  shadeDepth: number;
  /**
   * Soil made of different snack chunks (sponge, brownie, ice…): Voronoi cells of `variantCell`
   * world px each pick one, with an outlined seam between chunks. Empty = plain `soil`/`crust`.
   */
  variants?: Array<{ soil: TexImage; crust: TexImage; merge?: boolean }>;
  /**
   * Object-built maps (M18.5): `top[y·W + x]` is the index of the object drawn at that world
   * pixel (−1 none); the object's own picture is painted there instead of a soil texture, with
   * no crust (each object has its own look).
   */
  pieces?: { top: Int16Array; W: number; list: Array<{ img: TexImage; x: number; y: number; w: number; h: number; flip: boolean }> };
  variantCell?: number;
  variantSeed?: number;
}

// ------------------------------------------------------------------ small raster helpers
type Px = Uint8ClampedArray;
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function makeTex(width: number, height: number): { width: number; height: number; data: Px } {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Tileable value noise with period `p` cells, smooth-stepped; returns 0..1. */
function vnoise(x: number, y: number, p: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => (noise2(((a % p) + p) % p, (((b % p) + p) % p) + seed * 977) & 0xffff) / 0xffff;
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal noise over a tile of `size` px (tileable), 0..1. */
function fbm(x: number, y: number, size: number, seed: number, octaves = 4, base = 8): number {
  let v = 0, amp = 0.5, tot = 0, cells = base;
  for (let o = 0; o < octaves; o++) {
    v += amp * vnoise((x / size) * cells, (y / size) * cells, cells, seed + o);
    tot += amp;
    amp *= 0.5;
    cells *= 2;
  }
  return v / tot;
}

const mix = (a: RGB, b: RGB, t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function blendPx(t: { width: number; height: number; data: Px }, x: number, y: number, c: readonly number[], a: number): void {
  const w = t.width, h = t.height;
  const xx = ((x % w) + w) % w, yy = ((y % h) + h) % h;
  const p = (yy * w + xx) * 4;
  const d = t.data;
  const ia = 1 - a;
  d[p] = clamp255(d[p]! * ia + c[0]! * a);
  d[p + 1] = clamp255(d[p + 1]! * ia + c[1]! * a);
  d[p + 2] = clamp255(d[p + 2]! * ia + c[2]! * a);
  d[p + 3] = clamp255(Math.max(d[p + 3]!, 255 * a));
}

/** Anti-aliased filled ellipse (wraps around the tile), optional outline. */
function ellipse(t: { width: number; height: number; data: Px }, cx: number, cy: number, rx: number, ry: number, c: readonly number[], alpha = 1, rot = 0): void {
  const r = Math.max(rx, ry) + 1.5;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const u = (dx * cs + dy * sn) / rx, v = (-dx * sn + dy * cs) / ry;
      const q = Math.sqrt(u * u + v * v);
      const edge = (1 - q) * Math.min(rx, ry);
      const a = Math.max(0, Math.min(1, edge + 0.5)) * alpha;
      if (a > 0) blendPx(t, x, y, c, a);
    }
  }
}

// ------------------------------------------------------------------ procedural textures
/** Painted-look textures from a theme's colours (the fallback when no art pack is loaded). */
export function proceduralArt(theme: TerrainTheme, scale = 2, seed = 1): TerrainArt {
  const S = scale;
  // ---- soil: soft mottled body, darker pores, pebbles and sprinkles with highlights
  const soil = makeTex(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const n = fbm(x, y, 256, seed, 4, 6);
      const m = fbm(x + 37, y + 91, 256, seed + 11, 3, 3);
      let c = n < 0.45 ? mix(theme.soilDark, theme.soil, n / 0.45) : mix(theme.soil, theme.soilLight, Math.min(1, (n - 0.45) / 0.4));
      c = mix(c, theme.soilDark, Math.max(0, m - 0.6) * 0.8);
      const p = (y * 256 + x) * 4;
      soil.data[p] = c[0];
      soil.data[p + 1] = c[1];
      soil.data[p + 2] = c[2];
      soil.data[p + 3] = 255;
    }
  }
  let k = 0;
  const rnd = () => (noise2(k++, seed * 31 + 7) & 0xffff) / 0xffff;
  for (let i = 0; i < 46; i++) {
    // pores: small dark dents with a light lower lip
    const x = rnd() * 256, y = rnd() * 256, r = (1.2 + rnd() * 2.4) * (S / 2);
    ellipse(soil, x, y + r * 0.35, r * 1.15, r * 0.8, mix(theme.soilLight, theme.soilLight, 0), 0.5);
    ellipse(soil, x, y, r, r * 0.75, theme.soilDark, 0.85);
  }
  for (let i = 0; i < 16; i++) {
    // pebbles / crumbs
    const x = rnd() * 256, y = rnd() * 256, r = (2 + rnd() * 3) * (S / 2);
    ellipse(soil, x + 0.8, y + 1.2, r, r * 0.8, theme.soilDark, 0.6);
    ellipse(soil, x, y, r, r * 0.8, mix(theme.soilLight, theme.soil, 0.4), 1);
    ellipse(soil, x - r * 0.35, y - r * 0.35, r * 0.35, r * 0.25, [255, 255, 255], 0.35);
  }
  for (let i = 0; i < 26; i++) {
    // sprinkles: little candy capsules with an outline and a shine
    const x = rnd() * 256, y = rnd() * 256, rot = rnd() * Math.PI, col = theme.sprinkles[Math.floor(rnd() * theme.sprinkles.length)]!;
    const L = 3.6 * (S / 2), R = 1.3 * (S / 2);
    ellipse(soil, x, y, L + 0.9, R + 0.9, theme.outline, 0.55, rot);
    ellipse(soil, x, y, L, R, col, 1, rot);
    ellipse(soil, x - Math.cos(rot) * L * 0.3, y - Math.sin(rot) * L * 0.3 - R * 0.3, L * 0.4, R * 0.35, [255, 255, 255], 0.5, rot);
  }

  // ---- crust: frosting / grass band along the top, wavy lower edge, drips, rim and gloss
  const crust = proceduralCrust({ top: theme.frosting, shade: theme.frostingShade, drip: theme.drip, outline: theme.outline }, theme.frostDepth, S, seed);

  // ---- rock: hard candy / toffee slabs with soft stripes and shine
  const rock = makeTex(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const band = (Math.sin(((x + y) / 128) * Math.PI * 2 * 4 + fbm(x, y, 128, seed + 21, 3, 4) * 3) + 1) / 2;
      const c = mix(theme.rock, theme.rockStripe, band * 0.85);
      const p = (y * 128 + x) * 4;
      rock.data[p] = c[0];
      rock.data[p + 1] = c[1];
      rock.data[p + 2] = c[2];
      rock.data[p + 3] = 255;
    }
  }
  // ---- girder: a biscuit with docking holes and a toasted edge
  const girder = makeTex(32, 24);
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 32; x++) {
      const n = fbm(x, y, 32, seed + 31, 2, 4);
      const c = mix(theme.girder, theme.girderDark, 0.15 + n * 0.3);
      const p = (y * 32 + x) * 4;
      girder.data[p] = c[0];
      girder.data[p + 1] = c[1];
      girder.data[p + 2] = c[2];
      girder.data[p + 3] = 255;
    }
  }
  ellipse(girder, 8, 12, 1.6 * (S / 2) + 0.4, 1.6 * (S / 2) + 0.4, theme.girderDark, 1);
  ellipse(girder, 24, 12, 1.6 * (S / 2) + 0.4, 1.6 * (S / 2) + 0.4, theme.girderDark, 1);
  // ---- back wall: the soil, darker and flatter
  const back = makeTex(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const n = fbm(x, y, 128, seed + 41, 3, 5);
      const c = mix(theme.backWallDark, theme.backWall, n);
      const p = (y * 128 + x) * 4;
      back.data[p] = c[0];
      back.data[p + 1] = c[1];
      back.data[p + 2] = c[2];
      back.data[p + 3] = 255;
    }
  }
  return {
    scale: S,
    soil,
    crust,
    rock,
    girder,
    backWall: back,
    backWallAlpha: theme.backWallAlpha,
    outline: theme.outline,
    outlinePx: theme.outlinePx,
    border: theme.border,
    scorch: theme.scorch,
    scorchDark: theme.scorchDark,
    scorchPx: theme.scorchPx,
    shadeDepth: 60,
  };
}

/** Colours of a crust: the top coat, its shade, the drips and the rim line. */
export interface CrustColours {
  top: RGB;
  shade: RGB;
  drip: RGB;
  outline: RGB;
}

/** A tileable crust strip (256 px wide): coat with a wavy lower edge, drips, rim and gloss. */
export function proceduralCrust(col: CrustColours, depthPx: number, scale = 2, seed = 1): TexImage {
  const S = scale;
  let k = 0;
  const rnd = () => (noise2(k++, seed * 53 + 3) & 0xffff) / 0xffff;
  const crustH = (depthPx + 14) * S;
  const crust = makeTex(256, crustH);
  const drips: Array<{ cx: number; w: number; len: number }> = [];
  for (let i = 0; i < 9; i++) drips.push({ cx: rnd() * 256, w: (2.2 + rnd() * 2.5) * S, len: (3 + rnd() * 8) * S });
  const rim = 1.6 * S;
  for (let x = 0; x < 256; x++) {
    const base = (depthPx - 1 + 2.4 * fbm(x, 0, 256, seed + 5, 3, 5)) * S;
    let bottom = base;
    for (const d of drips) {
      let dx = Math.abs(x + 0.5 - d.cx);
      dx = Math.min(dx, 256 - dx);
      if (dx < d.w) bottom = Math.max(bottom, base + d.len * Math.sqrt(1 - (dx / d.w) ** 2));
    }
    for (let y = 0; y < crustH; y++) {
      const p = (y * 256 + x) * 4;
      let c: [number, number, number] | null = null;
      let a = 0;
      if (y < bottom) {
        const t = y / Math.max(1, bottom);
        c = mix(col.top, col.shade, Math.pow(t, 2.2));
        if (y >= base) c = mix(col.drip, col.shade, 0.25);
        if (y > 1.2 * S && y < 2.4 * S && fbm(x, 3, 256, seed + 9, 2, 12) > 0.55) c = mix(c, [255, 255, 255], 0.55);
        a = 1;
      } else if (y < bottom + rim) {
        c = [col.outline[0], col.outline[1], col.outline[2]];
        a = Math.max(0, Math.min(1, bottom + rim - y));
      }
      if (c) {
        crust.data[p] = c[0];
        crust.data[p + 1] = c[1];
        crust.data[p + 2] = c[2];
        crust.data[p + 3] = Math.round(a * 255);
      }
    }
  }
  return crust;
}

/** First fully transparent crust row per column (where the soil shows again). */
const bottomsCache = new WeakMap<TexImage, Uint16Array>();
function crustBottoms(c: TexImage): Uint16Array {
  const hit = bottomsCache.get(c);
  if (hit) return hit;
  const out = new Uint16Array(c.width);
  for (let x = 0; x < c.width; x++) {
    let y = 0;
    while (y < c.height && c.data[(y * c.width + x) * 4 + 3]! > 0) y++;
    out[x] = y;
  }
  bottomsCache.set(c, out);
  return out;
}

/**
 * Which soil variant a world point belongs to: jittered Voronoi cells (`cell` px), each cell picks
 * a variant by hash. Also returns how far the point is from a cell border (px), for the seams.
 */
function variantAt(wx: number, wy: number, cell: number, n: number, seed: number): { v: number; v2: number; edge: number } {
  const cx = Math.floor(wx / cell), cy = Math.floor(wy / cell);
  let d1 = 1e9, d2 = 1e9, id1 = 0, id2 = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      const h = noise2(gx * 7 + seed, gy * 13 - seed);
      const px = (gx + 0.15 + ((h & 0xff) / 255) * 0.7) * cell;
      const py = (gy + 0.15 + (((h >>> 8) & 0xff) / 255) * 0.7) * cell;
      const d = (wx - px) * (wx - px) + (wy - py) * (wy - py);
      if (d < d1) {
        d2 = d1;
        id2 = id1;
        d1 = d;
        id1 = h;
      } else if (d < d2) {
        d2 = d;
        id2 = h;
      }
    }
  }
  return { v: (id1 >>> 16) % n, v2: (id2 >>> 16) % n, edge: (Math.sqrt(d2) - Math.sqrt(d1)) / 2 };
}

// ------------------------------------------------------------------ the HD painter
const AIR = 0, SOIL = 1, ROCK = 2, GIRDER = 3;
const TOP_MARGIN = 24;
const DIST_CAP = 255;

function chamfer(dist: Uint8Array, ew: number, eh: number): void {
  const relax = (i: number, j: number, w: number) => {
    const c = dist[j]! + w;
    if (c < dist[i]!) dist[i] = c;
  };
  for (let y = 0; y < eh; y++)
    for (let x = 0; x < ew; x++) {
      const i = y * ew + x;
      if (dist[i] === 0) continue;
      if (x > 0) relax(i, i - 1, 2);
      if (y > 0) {
        relax(i, i - ew, 2);
        if (x > 0) relax(i, i - ew - 1, 3);
        if (x < ew - 1) relax(i, i - ew + 1, 3);
      }
    }
  for (let y = eh - 1; y >= 0; y--)
    for (let x = ew - 1; x >= 0; x--) {
      const i = y * ew + x;
      if (dist[i] === 0) continue;
      if (x < ew - 1) relax(i, i + 1, 2);
      if (y < eh - 1) {
        relax(i, i + ew, 2);
        if (x < ew - 1) relax(i, i + ew + 1, 3);
        if (x > 0) relax(i, i + ew - 1, 3);
      }
    }
}

const sampleTex = (t: TexImage, x: number, y: number, out: number[]): void => {
  const xx = ((x % t.width) + t.width) % t.width, yy = ((y % t.height) + t.height) % t.height;
  const p = (yy * t.width + xx) * 4;
  out[0] = t.data[p]!;
  out[1] = t.data[p + 1]!;
  out[2] = t.data[p + 2]!;
  out[3] = t.data[p + 3]!;
};

/** Bilinear sample of a picture at (u, v) in 0..1 (clamped). */
function samplePic(t: TexImage, u: number, v: number, out: number[]): void {
  const fx = Math.max(0, Math.min(t.width - 1.001, u * t.width - 0.5)), fy = Math.max(0, Math.min(t.height - 1.001, v * t.height - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const d = t.data, w = t.width;
  const i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
  for (let k = 0; k < 4; k++) out[k] = (d[i00 + k]! * (1 - ax) + d[i10 + k]! * ax) * (1 - ay) + (d[i01 + k]! * (1 - ax) + d[i11 + k]! * ax) * ay;
}

/** Colour of object `i` at world (wx, wy); false where its picture is see-through. */
function pieceColour(pc: NonNullable<TerrainArt['pieces']>, i: number, wx: number, wy: number, out: number[]): boolean {
  const p = pc.list[i];
  if (!p) return false;
  let u = (wx - p.x) / p.w;
  if (p.flip) u = 1 - u;
  samplePic(p.img, u, (wy - p.y) / p.h, out);
  return out[3]! >= 100;
}

/**
 * Paint world rect [x0..x1] × [y0..y1] into `out`, an RGBA buffer of (width·S) × (height·S).
 * `original` (the map as loaded) enables craters: back wall, scorch, and crusts only on the
 * original surface.
 *
 * Everything is worked out at output resolution: the 1 px bitmap is smoothed with a tent filter
 * (radius 1.5 px) and thresholded, so slopes become clean lines instead of pixel stairs; the
 * outline, edge shading, crust depth and scorch are measured on that smooth mask.
 */
export function paintTerrainHD(t: TerrainLike, art: TerrainArt, out: Uint8ClampedArray | Uint8Array, x0: number, y0: number, x1: number, y1: number, original?: Uint8Array): void {
  const W = t.width, H = t.height, S = art.scale;
  const OW = W * S;
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(W - 1, x1);
  y1 = Math.min(H - 1, y1);
  if (x1 < x0 || y1 < y0) return;
  // extended working region, in output pixels
  const ex0 = Math.max(0, x0 - PAINT_MARGIN - 2) * S, ex1 = (Math.min(W - 1, x1 + PAINT_MARGIN + 2) + 1) * S - 1;
  const ey0 = Math.max(0, y0 - TOP_MARGIN) * S, ey1 = (Math.min(H - 1, y1 + PAINT_MARGIN + 2) + 1) * S - 1;
  const ew = ex1 - ex0 + 1, eh = ey1 - ey0 + 1;
  const inv = 1 / S;

  const coverage = (mat: Uint8Array, dst: Float32Array) => {
    const solid = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mat[y * W + x] === AIR ? 0 : 1);
    for (let y = 0; y < eh; y++) {
      const wy = (y + ey0 + 0.5) * inv - 0.5;
      const by = Math.floor(wy);
      for (let x = 0; x < ew; x++) {
        const wx = (x + ex0 + 0.5) * inv - 0.5;
        const bx = Math.floor(wx);
        let cw = 0, cs = 0;
        for (let j = -1; j <= 2; j++) {
          const wyj = 1.5 - Math.abs(by + j - wy);
          if (wyj <= 0) continue;
          for (let i = -1; i <= 2; i++) {
            const wxi = 1.5 - Math.abs(bx + i - wx);
            if (wxi <= 0) continue;
            const w = wxi * wyj;
            cw += w;
            cs += w * solid(bx + i, by + j);
          }
        }
        dst[y * ew + x] = cs / cw;
      }
    }
  };
  const cov = new Float32Array(ew * eh);
  coverage(t.mat, cov);
  const ocov = original ? new Float32Array(ew * eh) : cov;
  if (original) coverage(original, ocov);

  // distance (chamfer, 2 per output px, capped) from every solid output pixel to air
  const dist = new Uint8Array(ew * eh);
  for (let i = 0; i < ew * eh; i++) dist[i] = cov[i]! >= 0.5 ? DIST_CAP : 0;
  chamfer(dist, ew, eh);
  let carved: Uint8Array | null = null;
  if (original) {
    let any = false;
    const cd = new Uint8Array(ew * eh);
    for (let i = 0; i < ew * eh; i++) {
      const c = cov[i]! < 0.5 && ocov[i]! >= 0.5;
      cd[i] = c ? 0 : DIST_CAP;
      if (c) any = true;
    }
    if (any) {
      chamfer(cd, ew, eh);
      carved = cd;
    }
  }
  // depth below the ORIGINAL top surface, output px (crust follows the surface the map had)
  const src = original ?? t.mat;
  const depth = new Uint16Array(ew * eh);
  for (let x = 0; x < ew; x++) {
    let d = 0;
    if (ocov[x]! >= 0.5) {
      const gx = Math.min(W - 1, Math.floor((x + ex0) * inv));
      let wd = 0;
      for (let yy = Math.floor(ey0 * inv) - 1; yy >= 0 && wd < 400 && src[yy * W + gx] !== AIR; yy--) wd++;
      d = ey0 === 0 ? 4000 : 1 + wd * S;
    }
    depth[x] = d;
    for (let y = 1; y < eh; y++) {
      d = ocov[y * ew + x]! >= 0.5 ? Math.min(4000, d + 1) : 0;
      depth[y * ew + x] = d;
    }
  }

  const variants = art.variants && art.variants.length ? art.variants : null;
  const vCell = art.variantCell ?? 170, vSeed = art.variantSeed ?? 1;
  const seamPx = 1.1;
  const outlineD = art.outlinePx * S * 2; // chamfer units at output resolution
  const tex: number[] = [0, 0, 0, 0];
  const cr: number[] = [0, 0, 0, 0];

  for (let Y = y0 * S; Y < (y1 + 1) * S; Y++) {
    const ly = Y - ey0;
    const iy = Math.floor(Y * inv);
    for (let X = x0 * S; X < (x1 + 1) * S; X++) {
      const lx = X - ex0;
      const li = ly * ew + lx;
      const p = (Y * OW + X) * 4;
      const c = cov[li]!;
      const a = Math.max(0, Math.min(1, (c - 0.38) / 0.24));
      let r = 0, g = 0, b = 0, alpha = 0;
      if (a < 1 && ocov[li]! >= 0.45) {
        sampleTex(art.backWall, X, Y, tex);
        r = tex[0]!;
        g = tex[1]!;
        b = tex[2]!;
        alpha = (art.backWallAlpha / 255) * Math.min(1, (ocov[li]! - 0.45) / 0.2);
      }
      if (a > 0) {
        // material of the nearest solid world pixel
        const ix = Math.floor(X * inv);
        let m = t.mat[iy * W + ix]!;
        if (m === AIR) {
          for (const [dx, dy] of NEIGH) {
            const xx = ix + dx, yy = iy + dy;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H && t.mat[yy * W + xx] !== AIR) {
              m = t.mat[yy * W + xx]!;
              break;
            }
          }
          if (m === AIR) m = SOIL;
        }
        const dI = dist[li]!;
        let cr0: number, cg0: number, cb0: number;
        if (m === ROCK) {
          sampleTex(art.rock, X, Y, tex);
          [cr0, cg0, cb0] = [tex[0]!, tex[1]!, tex[2]!];
        } else if (m === GIRDER) {
          sampleTex(art.girder, X, Y, tex);
          [cr0, cg0, cb0] = [tex[0]!, tex[1]!, tex[2]!];
        } else if (m !== SOIL) {
          [cr0, cg0, cb0] = art.border;
        } else if (art.pieces && art.pieces.top[iy * W + ix]! >= 0 && pieceColour(art.pieces, art.pieces.top[iy * W + ix]!, (X + 0.5) * inv, (Y + 0.5) * inv, tex)) {
          // an object's own picture, lightly shaded towards its inside, scorched round craters
          [cr0, cg0, cb0] = [tex[0]!, tex[1]!, tex[2]!];
          const deep = 1 - 0.12 * Math.min(1, Math.max(0, dI - outlineD) / (art.shadeDepth * S * 2));
          cr0 *= deep;
          cg0 *= deep;
          cb0 *= deep;
          if (carved) {
            const cdv = carved[li]!;
            const reach = outlineD + art.scorchPx * S * 2;
            if (cdv <= reach) {
              const near = cdv <= outlineD + 3 * S;
              const k = near ? 0.8 : 0.5 * (1 - (cdv - outlineD) / (reach - outlineD + 1));
              const sc = near ? art.scorchDark : art.scorch;
              cr0 = cr0 * (1 - k) + sc[0] * k;
              cg0 = cg0 * (1 - k) + sc[1] * k;
              cb0 = cb0 * (1 - k) + sc[2] * k;
            }
          }
        } else {
          let soilTex = art.soil, crustTex = art.crust;
          let seam = 1;
          if (variants) {
            const vv = variantAt((X + 0.5) * inv, (Y + 0.5) * inv, vCell, variants.length, vSeed);
            soilTex = variants[vv.v]!.soil;
            crustTex = variants[vv.v]!.crust;
            // an outlined seam where two chunks meet, with a soft shade beside it
            const a = variants[vv.v]!, b = variants[vv.v2]!;
            if (!(a.merge && b.soil === a.soil)) seam = vv.edge < seamPx ? 0 : vv.edge < seamPx + 3 ? 0.78 + 0.22 * ((vv.edge - seamPx) / 3) : 1;
          }
          sampleTex(soilTex, X, Y, tex);
          [cr0, cg0, cb0] = [tex[0]!, tex[1]!, tex[2]!];
          if (seam === 0) [cr0, cg0, cb0] = art.outline;
          else if (seam < 1) {
            cr0 *= seam;
            cg0 *= seam;
            cb0 *= seam;
          }
          // soil further from any edge is darker
          const deep = 1 - 0.22 * Math.min(1, Math.max(0, dI - outlineD) / (art.shadeDepth * S * 2));
          cr0 *= deep;
          cg0 *= deep;
          cb0 *= deep;
          // the crust along the original top surface (+ its soft shadow)
          const dep = depth[li]!;
          if (dep > 0) {
            const dOut = dep - 1;
            const cx = ((X % crustTex.width) + crustTex.width) % crustTex.width;
            const bottom = crustBottoms(crustTex)[cx]!;
            if (dOut < crustTex.height) {
              sampleTex(crustTex, X, dOut, cr);
              const ca = cr[3]! / 255;
              if (ca > 0) {
                cr0 = cr0 * (1 - ca) + cr[0]! * ca;
                cg0 = cg0 * (1 - ca) + cr[1]! * ca;
                cb0 = cb0 * (1 - ca) + cr[2]! * ca;
              }
            }
            if (dOut >= bottom && dOut < bottom + 4 * S) {
              const sh = 1 - 0.2 * (1 - (dOut - bottom) / (4 * S));
              cr0 *= sh;
              cg0 *= sh;
              cb0 *= sh;
            }
          }
          // scorch round craters
          if (carved) {
            const cdv = carved[li]!;
            const reach = outlineD + art.scorchPx * S * 2;
            if (cdv <= reach) {
              const near = cdv <= outlineD + 3 * S;
              const k = near ? 0.8 : 0.5 * (1 - (cdv - outlineD) / (reach - outlineD + 1));
              const sc = near ? art.scorchDark : art.scorch;
              cr0 = cr0 * (1 - k) + sc[0] * k;
              cg0 = cg0 * (1 - k) + sc[1] * k;
              cb0 = cb0 * (1 - k) + sc[2] * k;
            }
          }
        }
        // ambient occlusion inside every edge
        const ao = 1 - 0.2 * Math.max(0, 1 - (dI - outlineD) / (16 * S));
        cr0 *= ao;
        cg0 *= ao;
        cb0 *= ao;
        // outline (blended over ~1 output px)
        const ot = Math.max(0, Math.min(1, (dI - outlineD) * 0.5));
        cr0 = art.outline[0] * (1 - ot) + cr0 * ot;
        cg0 = art.outline[1] * (1 - ot) + cg0 * ot;
        cb0 = art.outline[2] * (1 - ot) + cb0 * ot;
        // composite over the back wall
        const outA = a + alpha * (1 - a);
        r = (r * alpha * (1 - a) + cr0 * a) / outA;
        g = (g * alpha * (1 - a) + cg0 * a) / outA;
        b = (b * alpha * (1 - a) + cb0 * a) / outA;
        alpha = outA;
      }
      out[p] = clamp255(Math.round(r));
      out[p + 1] = clamp255(Math.round(g));
      out[p + 2] = clamp255(Math.round(b));
      out[p + 3] = Math.round(alpha * 255);
    }
  }
}

const NEIGH: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
