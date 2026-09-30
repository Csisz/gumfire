/**
 * Pure terrain painter: turns the material bitmap into RGBA colours (plan §8.5).
 * No Pixi imports, so it runs and is tested in Node. Colours are presentation only
 * and never feed back into the simulation.
 *
 * Look (flat vector style, §5.9): a 2 px dark outline around every solid shape,
 * a frosting crust on upward-facing surfaces with occasional drips, sponge-cake soil
 * with pores and sprinkles, striped hard-toffee rock.
 *
 * With the map's ORIGINAL bitmap (as loaded, before any destruction) the painter also shows
 * damage: carved-out soil becomes a darker "back wall" so holes read as holes, soil next to a
 * crater is scorched, and frosting stays on the original surface only (a crater floor is
 * exposed sponge, not freshly frosted cake).
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
  /** Carved-out area behind the terrain. */
  backWall: RGB;
  backWallDark: RGB;
  /** Burnt soil around craters. */
  scorch: RGB;
  scorchDark: RGB;
  /** Scorch reach in px beyond the outline. */
  scorchPx: number;
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
  backWall: hex(0xa8703f),
  backWallDark: hex(0x8f5b31),
  scorch: hex(0x9a6a3c),
  scorchDark: hex(0x5e3a22),
  scorchPx: 5,
  frostDepth: 9,
  outlinePx: 2,
};

/**
 * Frozen Snack Factory (art board 1): golden sponge cake with white icing drips tinted ice-blue,
 * cookie-dark back wall, sugar sprinkles.
 */
export const FROZEN_SNACK_THEME: TerrainTheme = {
  soil: hex(0xeec48a),
  soilDark: hex(0xd9a766),
  soilLight: hex(0xf7d9a8),
  sprinkles: [hex(0xff5d8f), hex(0x3fa9f5), hex(0xffd23f), hex(0x6fdc4a), hex(0xffffff)],
  frosting: hex(0xf7fcff),
  frostingShade: hex(0xcfeaf8),
  drip: hex(0xb9e2f7),
  outline: hex(0x3a2418),
  rock: hex(0x6b3f24),
  rockStripe: hex(0x8a5530),
  girder: hex(0xc9d3de),
  border: hex(0x2e2433),
  backWall: hex(0x9a6538),
  backWallDark: hex(0x7d4f2b),
  scorch: hex(0xa06e3e),
  scorchDark: hex(0x5e3a22),
  scorchPx: 5,
  frostDepth: 10,
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

/**
 * Pixels outside the painted rect that must be read to colour it correctly — and how far an
 * edit's visual effect (outline, scorch) reaches beyond the edited pixels.
 */
export const PAINT_MARGIN = 8;
const TOP_MARGIN = 20;
const DIST_CAP = 255;

/** Cheap deterministic 2D integer hash → 0..2^32-1 (visual noise only). */
export function noise2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Two-pass chamfer (2/3) distance transform in place; zero cells are the seeds. */
function chamfer(dist: Uint8Array, ew: number, eh: number): void {
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
  /** The bitmap as the map was loaded (same size), enabling damage rendering. */
  original?: Uint8Array,
): void {
  const W = t.width;
  if (original && original.length !== t.mat.length) throw new RangeError('original bitmap size mismatch');
  const src = original ?? t.mat;
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
  chamfer(dist, ew, eh);

  // 1b) Distance to the nearest CARVED pixel (original solid, now air), for scorch marks.
  let carvedDist: Uint8Array | null = null;
  if (original) {
    let any = false;
    const cd = new Uint8Array(ew * eh);
    for (let y = 0; y < eh; y++) {
      const row = (y + ey0) * W;
      for (let x = 0; x < ew; x++) {
        const i = row + x + ex0;
        const carved = t.mat[i] === AIR && original[i] !== AIR;
        cd[y * ew + x] = carved ? 0 : DIST_CAP;
        if (carved) any = true;
      }
    }
    if (any) {
      chamfer(cd, ew, eh);
      carvedDist = cd;
    }
  }

  // 2) Depth below the nearest air directly above (for the frosting crust), on the ORIGINAL surface.
  const depth = new Uint8Array(ew * eh);
  for (let x = 0; x < ew; x++) {
    const gx = x + ex0;
    // seed the first row by looking upward in the real terrain
    let d = 0;
    if (src[ey0 * W + gx] !== AIR) {
      d = 1;
      for (let yy = ey0 - 1; yy >= 0 && d < 250 && src[yy * W + gx] !== AIR; yy--) d++;
      if (ey0 === 0) d = 250; // map top edge is not a surface
    }
    depth[x] = d;
    for (let y = 1; y < eh; y++) {
      const solid = src[(y + ey0) * W + gx] !== AIR;
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
        if (original && original[y * W + x] !== AIR) {
          put(p, noise2(x >> 1, (y >> 1) + 5) % 11 === 0 ? theme.backWallDark : theme.backWall);
        } else {
          out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
        }
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
      if (carvedDist) {
        const cdv = carvedDist[li]!;
        const reach = outlineDist + theme.scorchPx * 2;
        if (cdv <= outlineDist + 3) {
          put(p, theme.scorchDark);
          continue;
        }
        if (cdv <= reach && (noise2(x, y) & 3) <= ((reach - cdv) >> 1)) {
          put(p, theme.scorch);
          continue;
        }
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

export function paintTerrain(t: TerrainLike, theme: TerrainTheme, out: Uint8ClampedArray | Uint8Array, original?: Uint8Array): void {
  paintTerrainRect(t, theme, out, 0, 0, t.width - 1, t.height - 1, original);
}
