/**
 * Pure terrain painter: turns the material bitmap into RGBA colours (plan §8.5).
 * No Pixi imports, so it runs and is tested in Node. Colours are presentation only
 * and never feed back into the simulation.
 *
 * Look (flat vector style, §5.9): a 2 px dark outline around every solid shape,
 * a frosting crust on upward-facing surfaces with occasional drips, sponge-cake soil
 * with pores and sprinkles, striped hard-toffee rock.
 */

export type RGB = readonly [number, number, number];

export interface TerrainTheme {
  soil: RGB;
  soilDark: RGB;
  soilLight: RGB;
  sprinkles: readonly RGB[];
  frosting: RGB;
  frostingShade: RGB;
  drip: RGB;
  outline: RGB;
  rock: RGB;
  rockStripe: RGB;
  girder: RGB;
  border: RGB;
  /** Frosting thickness in px on upward-facing surfaces. */
  frostDepth: number;
  /** Outline thickness in px. */
  outlinePx: number;
}

const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

export const BIRTHDAY_THEME: TerrainTheme = {
  soil: hex(0xe9b872),
  soilDark: hex(0xd49a55),
  soilLight: hex(0xf2c98c),
  sprinkles: [hex(0xff5d8f), hex(0x4cc9f0), hex(0xffd23f), hex(0x7bd389), hex(0xb388eb)],
  frosting: hex(0xfff6f8),
  frostingShade: hex(0xffd3e0),
  drip: hex(0xff9ebb),
  outline: hex(0x3b2418),
  rock: hex(0x7a4a2a),
  rockStripe: hex(0x9c6236),
  girder: hex(0xc9c9d6),
  border: hex(0x2e2433),
  frostDepth: 9,
  outlinePx: 2,
};

/** Minimal read-only view of the sim's TerrainState. Material ids match sim `Mat`. */
export interface TerrainLike {
  readonly width: number;
  readonly height: number;
  readonly mat: Uint8Array;
}

const AIR = 0;
const SOIL = 1;
const ROCK = 2;
const GIRDER = 3;

/** Pixels outside the painted rect that must be read to colour it correctly. */
export const PAINT_MARGIN = 8;
const TOP_MARGIN = 20;
const DIST_CAP = 255;

/** Cheap deterministic 2D integer hash → 0..2^32-1 (visual noise only). */
export function noise2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Paint the pixel rect [x0..x1] × [y0..y1] (inclusive) of `out` (RGBA, width*height*4).
 * Reads up to PAINT_MARGIN px around the rect (TOP_MARGIN above) so crusts are correct at
 * rect edges; callers repainting after an edit should pass the edit rect grown by PAINT_MARGIN.
 */
export function paintTerrainRect(
  t: TerrainLike,
  theme: TerrainTheme,
  out: Uint8ClampedArray | Uint8Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const W = t.width;
  const H = t.height;
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(W - 1, x1);
  y1 = Math.min(H - 1, y1);
  if (x1 < x0 || y1 < y0) return;

  // Extended working region.
  const ex0 = Math.max(0, x0 - PAINT_MARGIN);
  const ex1 = Math.min(W - 1, x1 + PAINT_MARGIN);
  const ey0 = Math.max(0, y0 - TOP_MARGIN);
  const ey1 = Math.min(H - 1, y1 + PAINT_MARGIN);
  const ew = ex1 - ex0 + 1;
  const eh = ey1 - ey0 + 1;

  // 1) Distance to nearest AIR (chamfer 2/3 ≈ 2 units per px), capped. Outside the map counts as solid.
  const dist = new Uint8Array(ew * eh);
  for (let y = 0; y < eh; y++) {
    const row = (y + ey0) * W;
    for (let x = 0; x < ew; x++) dist[y * ew + x] = t.mat[row + x + ex0] === AIR ? 0 : DIST_CAP;
  }
  const relax = (i: number, j: number, w: number) => {
    const c = dist[j]! + w;
    if (c < dist[i]!) dist[i] = c;
  };
  for (let y = 0; y < eh; y++) {
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
  }
  for (let y = eh - 1; y >= 0; y--) {
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

  // 2) Depth below the nearest air directly above (for the frosting crust).
  const depth = new Uint8Array(ew * eh);
  for (let x = 0; x < ew; x++) {
    const gx = x + ex0;
    // seed the first row by looking upward in the real terrain
    let d = 0;
    if (t.mat[ey0 * W + gx] !== AIR) {
      d = 1;
      for (let yy = ey0 - 1; yy >= 0 && d < 250 && t.mat[yy * W + gx] !== AIR; yy--) d++;
      if (ey0 === 0) d = 250; // map top edge is not a surface
    }
    depth[x] = d;
    for (let y = 1; y < eh; y++) {
      const solid = t.mat[(y + ey0) * W + gx] !== AIR;
      d = solid ? Math.min(250, d + 1) : 0;
      depth[y * ew + x] = d;
    }
  }

  // 3) Colour.
  const outlineDist = theme.outlinePx * 2;
  const put = (p: number, c: RGB, a = 255) => {
    out[p] = c[0];
    out[p + 1] = c[1];
    out[p + 2] = c[2];
    out[p + 3] = a;
  };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const m = t.mat[y * W + x]!;
      const p = (y * W + x) * 4;
      if (m === AIR) {
        out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
        continue;
      }
      const li = (y - ey0) * ew + (x - ex0);
      const d = dist[li]!;
      if (d <= outlineDist) {
        put(p, theme.outline);
        continue;
      }
      if (m === ROCK) {
        put(p, ((x + y) >> 3) & 1 ? theme.rock : theme.rockStripe);
        continue;
      }
      if (m === GIRDER) {
        put(p, theme.girder);
        continue;
      }
      if (m !== SOIL) {
        put(p, theme.border);
        continue;
      }
      // soil: frosting crust on top surfaces, with drips on some columns
      const dt = depth[li]!;
      const colH = noise2(x >> 2, 7);
      const frost = theme.frostDepth + (colH & 3);
      const dripCol = noise2(x >> 1, 91) % 17 === 0;
      const dripLen = dripCol ? 4 + (noise2(x >> 1, 3) % 7) : 0;
      if (dt > outlineDist / 2 && dt <= frost + dripLen) {
        if (dt > frost) put(p, theme.drip);
        else if (dt >= frost - 1) put(p, theme.frostingShade);
        else put(p, theme.frosting);
        continue;
      }
      if (dt > 0 && dt <= frost + dripLen + 1 && dt > frost) {
        put(p, theme.outline);
        continue;
      }
      // sponge body: pores, sprinkles, light banding, darker inner rim
      const n = noise2(x, y);
      if (noise2(x >> 1, y >> 1) % 173 === 0) {
        put(p, theme.sprinkles[noise2(x >> 1, (y >> 1) + 1) % theme.sprinkles.length]!);
        continue;
      }
      if (noise2(x >> 1, y >> 1) % 29 === 0) {
        put(p, theme.soilDark);
        continue;
      }
      if (d <= outlineDist + 4) {
        put(p, theme.soilDark);
        continue;
      }
      put(p, (n & 255) < 40 ? theme.soilLight : theme.soil);
    }
  }
}

export function paintTerrain(t: TerrainLike, theme: TerrainTheme, out: Uint8ClampedArray | Uint8Array): void {
  paintTerrainRect(t, theme, out, 0, 0, t.width - 1, t.height - 1);
}
