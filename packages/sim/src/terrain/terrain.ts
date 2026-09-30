import { Hasher } from '../core/hash.js';

/**
 * Terrain = a 1-byte-per-pixel material bitmap, split into 64×64 chunks (ADR-003, plan §8).
 * The bitmap IS the collision: every terrain query is an array lookup.
 * Coordinates here are whole pixels, y down. Outside the map is AIR (open map).
 */

export const Mat = {
  AIR: 0,
  SOIL: 1,
  /** Indestructible. */
  ROCK: 2,
  /** Placed platforms; only large blasts damage them (M12). */
  GIRDER: 3,
  /** Indestructible cavern walls (M11). */
  BORDER: 4,
} as const;
export type MatId = (typeof Mat)[keyof typeof Mat];

export const CHUNK_SHIFT = 6;
export const CHUNK_SIZE = 1 << CHUNK_SHIFT; // 64
export const MAX_TERRAIN_SIDE = 32768;

export interface TerrainState {
  width: number;
  height: number;
  chunksX: number;
  chunksY: number;
  /** width*height materials, row-major. */
  mat: Uint8Array;
  /** Non-AIR pixel count per chunk: 0 → skip, CHUNK_SIZE² → full (fast collision early-outs). */
  chunkSolid: Uint16Array;
  /** FNV-1a of each chunk's bytes; lets the state hash stay O(chunks) instead of O(pixels). */
  chunkHash: Uint32Array;
  /** Increments on every edit. Hashed. */
  version: number;
  /** Per-chunk flag for the renderer. NOT hashed, NOT gameplay state. */
  dirty: Uint8Array;
}

function assertSize(width: number, height: number): void {
  for (const v of [width, height]) {
    if (!Number.isInteger(v) || v < 1 || v > MAX_TERRAIN_SIDE) throw new RangeError(`Invalid terrain size ${width}×${height}`);
  }
}

function allocTerrain(width: number, height: number): TerrainState {
  assertSize(width, height);
  const chunksX = Math.ceil(width / CHUNK_SIZE);
  const chunksY = Math.ceil(height / CHUNK_SIZE);
  const n = chunksX * chunksY;
  return {
    width,
    height,
    chunksX,
    chunksY,
    mat: new Uint8Array(width * height),
    chunkSolid: new Uint16Array(n),
    chunkHash: new Uint32Array(n),
    version: 0,
    dirty: new Uint8Array(n).fill(1),
  };
}

/** An all-AIR terrain. */
export function createTerrain(width: number, height: number): TerrainState {
  const t = allocTerrain(width, height);
  recomputeAllChunks(t);
  return t;
}

/** Build terrain from a materials array (copied and validated). Chunk data is computed once. */
export function terrainFromMaterials(width: number, height: number, mat: ArrayLike<number>): TerrainState {
  assertSize(width, height);
  if (mat.length !== width * height) throw new RangeError(`Material array length ${mat.length} ≠ ${width}×${height}`);
  const t = allocTerrain(width, height);
  for (let i = 0; i < mat.length; i++) {
    const m = mat[i]!;
    if (m > Mat.BORDER || m < 0 || !Number.isInteger(m)) throw new RangeError(`Unknown material ${m} at ${i}`);
    t.mat[i] = m;
  }
  recomputeAllChunks(t);
  return t;
}

/**
 * Map-mask colour convention (plan §8.3):
 * alpha < 128 → AIR · neutral grey (128±12 on every channel) → ROCK · anything else opaque → SOIL.
 */
export function classifyMaskPixel(r: number, g: number, b: number, a: number): MatId {
  if (a < 128) return Mat.AIR;
  if (Math.abs(r - 128) <= 12 && Math.abs(g - 128) <= 12 && Math.abs(b - 128) <= 12) return Mat.ROCK;
  return Mat.SOIL;
}

/** Build terrain from decoded RGBA mask pixels (the client decodes the PNG; the sim never does I/O). */
export function terrainFromRgba(width: number, height: number, rgba: ArrayLike<number>): TerrainState {
  assertSize(width, height);
  if (rgba.length !== width * height * 4) throw new RangeError(`RGBA length ${rgba.length} ≠ ${width}×${height}×4`);
  const mat = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < mat.length; i++, p += 4) {
    mat[i] = classifyMaskPixel(rgba[p]!, rgba[p + 1]!, rgba[p + 2]!, rgba[p + 3]!);
  }
  return terrainFromMaterials(width, height, mat);
}

export function inBounds(t: TerrainState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < t.width && y < t.height;
}

/** Material at an integer pixel; AIR outside the map. */
export function getMat(t: TerrainState, x: number, y: number): MatId {
  if (x < 0 || y < 0 || x >= t.width || y >= t.height) return Mat.AIR;
  return t.mat[y * t.width + x] as MatId;
}

export function isSolid(t: TerrainState, x: number, y: number): boolean {
  return getMat(t, x, y) !== Mat.AIR;
}

export function chunkIndexAt(t: TerrainState, x: number, y: number): number {
  return (y >> CHUNK_SHIFT) * t.chunksX + (x >> CHUNK_SHIFT);
}

/** Pixel bounds of a chunk, clipped to the map (edge chunks may be partial). */
export function chunkRect(t: TerrainState, index: number): { x0: number; y0: number; x1: number; y1: number } {
  const cx = index % t.chunksX;
  const cy = Math.trunc(index / t.chunksX);
  const x0 = cx << CHUNK_SHIFT;
  const y0 = cy << CHUNK_SHIFT;
  return { x0, y0, x1: Math.min(t.width, x0 + CHUNK_SIZE) - 1, y1: Math.min(t.height, y0 + CHUNK_SIZE) - 1 };
}

/**
 * Fixed pseudo-random odd weight for pixel index i (a 32-bit integer mix).
 *
 * Chunk hashes are position-weighted sums: chunkHash = Σ mat[i] · pixelWeight(i) (mod 2³²).
 * Unlike a streaming hash this is *incremental*: changing one pixel from a to b adds
 * (b − a) · pixelWeight(i), so an explosion pays per changed pixel, not per chunk byte.
 * Good enough for desync detection (it is not a cryptographic hash).
 */
export function pixelWeight(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h | 1) >>> 0;
}

/**
 * Set one pixel's material and update its chunk's solid count and hash incrementally.
 * `i` = y * width + x. The caller is responsible for dirty marking and `version`.
 */
export function setPixelTracked(t: TerrainState, i: number, x: number, y: number, m: number): void {
  const old = t.mat[i]!;
  if (old === m) return;
  t.mat[i] = m;
  const c = (y >> CHUNK_SHIFT) * t.chunksX + (x >> CHUNK_SHIFT);
  t.chunkSolid[c] = t.chunkSolid[c]! + (m !== 0 ? 1 : 0) - (old !== 0 ? 1 : 0);
  t.chunkHash[c] = (t.chunkHash[c]! + Math.imul(m - old, pixelWeight(i))) >>> 0;
}

/** Recount and rehash one chunk from scratch (map load, or verification). */
export function recomputeChunk(t: TerrainState, index: number): void {
  const { x0, y0, x1, y1 } = chunkRect(t, index);
  const mat = t.mat;
  let h = 0;
  let solid = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * t.width;
    for (let i = row + x0, end = row + x1; i <= end; i++) {
      const m = mat[i]!;
      if (m !== 0) {
        solid++;
        h = (h + Math.imul(m, pixelWeight(i))) | 0;
      }
    }
  }
  t.chunkSolid[index] = solid;
  t.chunkHash[index] = h >>> 0;
}

/** Recompute every chunk overlapping the (clipped, inclusive) pixel rect. */
export function recomputeChunksInRect(t: TerrainState, x0: number, y0: number, x1: number, y1: number): void {
  const cx0 = Math.max(0, x0 >> CHUNK_SHIFT);
  const cy0 = Math.max(0, y0 >> CHUNK_SHIFT);
  const cx1 = Math.min(t.chunksX - 1, x1 >> CHUNK_SHIFT);
  const cy1 = Math.min(t.chunksY - 1, y1 >> CHUNK_SHIFT);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) recomputeChunk(t, cy * t.chunksX + cx);
}

export function recomputeAllChunks(t: TerrainState): void {
  const n = t.chunksX * t.chunksY;
  for (let i = 0; i < n; i++) recomputeChunk(t, i);
}

/** Mark every chunk overlapping the pixel rect as dirty (for the renderer). */
export function markDirtyRect(t: TerrainState, x0: number, y0: number, x1: number, y1: number): void {
  const cx0 = Math.max(0, x0 >> CHUNK_SHIFT);
  const cy0 = Math.max(0, y0 >> CHUNK_SHIFT);
  const cx1 = Math.min(t.chunksX - 1, x1 >> CHUNK_SHIFT);
  const cy1 = Math.min(t.chunksY - 1, y1 >> CHUNK_SHIFT);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) t.dirty[cy * t.chunksX + cx] = 1;
}

/** Return the dirty chunk indices (ascending) and clear their flags. Renderer-side helper. */
export function takeDirtyChunks(t: TerrainState, limit = Infinity): number[] {
  const out: number[] = [];
  for (let i = 0; i < t.dirty.length && out.length < limit; i++) {
    if (t.dirty[i]) {
      t.dirty[i] = 0;
      out.push(i);
    }
  }
  return out;
}

export function countSolid(t: TerrainState): number {
  let s = 0;
  for (let i = 0; i < t.chunkSolid.length; i++) s += t.chunkSolid[i]!;
  return s;
}

/** Feed the terrain into a state hash: size, version and every chunk hash (O(chunks)). */
export function hashTerrainInto(h: Hasher, t: TerrainState): void {
  h.u32(t.width).u32(t.height).int(t.version).u32(t.chunkHash.length);
  for (let i = 0; i < t.chunkHash.length; i++) h.u32(t.chunkHash[i]!);
}

export function hashTerrain(t: TerrainState): number {
  const h = new Hasher();
  hashTerrainInto(h, t);
  return h.digest();
}
