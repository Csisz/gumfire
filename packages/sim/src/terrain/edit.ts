import { isqrt } from '../core/trig.js';
import { CHUNK_SHIFT, Mat, markDirtyRect, pixelWeight, setPixelTracked, type TerrainState } from './terrain.js';

/**
 * Terrain edit operations (plan §8.3–8.4). Each operation:
 * - clips to the map, touches only the pixels it needs (row spans, no per-pixel sqrt),
 * - never changes ROCK or BORDER; GIRDER only yields to carves of radius ≥ GIRDER_BREAK_RADIUS,
 * - updates chunk counts/hashes incrementally per changed pixel (O(changed), not O(chunk)),
 * - marks touched chunks dirty for the renderer and bumps `version`,
 * - returns the pixel rect it touched, or null if no pixel changed.
 * Coordinates and radii are whole pixels.
 */

export interface EditRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Number of pixels whose material changed. */
  changed: number;
}

export const GIRDER_BREAK_RADIUS = 30;
export const MAX_EDIT_RADIUS = 512;
/** Longest capsule segment accepted in one call (keeps the integer maths exact). */
export const MAX_CAPSULE_LENGTH = 2048;

function checkInt(name: string, v: number): void {
  if (!Number.isSafeInteger(v)) throw new RangeError(`${name} must be an integer, got ${v}`);
}

function checkRadius(r: number): void {
  checkInt('radius', r);
  if (r < 0 || r > MAX_EDIT_RADIUS) throw new RangeError(`radius out of range: ${r}`);
}

function finish(t: TerrainState, x0: number, y0: number, x1: number, y1: number, changed: number): EditRect | null {
  if (changed === 0) return null;
  markDirtyRect(t, x0, y0, x1, y1);
  t.version++;
  return { x0, y0, x1, y1, changed };
}

/** Whether a carve of radius r removes this material. */
function carvable(m: number, r: number): boolean {
  return m === Mat.SOIL || (m === Mat.GIRDER && r >= GIRDER_BREAK_RADIUS);
}

/** Remove terrain inside the disc (x−cx)² + (y−cy)² ≤ r². */
export function carveCircle(t: TerrainState, cx: number, cy: number, r: number): EditRect | null {
  checkInt('cx', cx);
  checkInt('cy', cy);
  checkRadius(r);
  const x0 = Math.max(0, cx - r);
  const x1 = Math.min(t.width - 1, cx + r);
  const y0 = Math.max(0, cy - r);
  const y1 = Math.min(t.height - 1, cy + r);
  if (x0 > x1 || y0 > y1) return null;
  const r2 = r * r;
  const mat = t.mat;
  const solidArr = t.chunkSolid;
  const hashArr = t.chunkHash;
  const breaksGirder = r >= GIRDER_BREAK_RADIUS;
  let changed = 0;
  let minX = x1, maxX = x0, minY = y1, maxY = y0;
  // Hot path of every explosion: chunk bookkeeping is accumulated per (row, chunk) segment
  // in locals and written once per segment, instead of per pixel (see setPixelTracked).
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const span = isqrt(r2 - dy * dy);
    const xa = Math.max(x0, cx - span);
    const xb = Math.min(x1, cx + span);
    const row = y * t.width;
    const chunkRow = (y >> CHUNK_SHIFT) * t.chunksX;
    let rowMin = -1, rowMax = -1;
    for (let segStart = xa; segStart <= xb; ) {
      const segEnd = Math.min(xb, (((segStart >> CHUNK_SHIFT) + 1) << CHUNK_SHIFT) - 1);
      let dSolid = 0;
      let dHash = 0;
      for (let x = segStart; x <= segEnd; x++) {
        const i = row + x;
        const m = mat[i]!;
        if (m === Mat.SOIL || (m === Mat.GIRDER && breaksGirder)) {
          mat[i] = Mat.AIR;
          dSolid++;
          dHash = (dHash + Math.imul(m, pixelWeight(i))) | 0;
          if (rowMin < 0) rowMin = x;
          rowMax = x;
        }
      }
      if (dSolid) {
        const c = chunkRow + (segStart >> CHUNK_SHIFT);
        solidArr[c] = solidArr[c]! - dSolid;
        hashArr[c] = (hashArr[c]! - dHash) >>> 0;
        changed += dSolid;
      }
      segStart = segEnd + 1;
    }
    if (rowMin >= 0) {
      if (rowMin < minX) minX = rowMin;
      if (rowMax > maxX) maxX = rowMax;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  return finish(t, minX, minY, maxX, maxY, changed);
}

/**
 * Remove terrain within distance r of the segment (ax, ay)–(bx, by): tunnels, drills, torches.
 * Exact integer test: for a pixel p with t = (p−a)·(b−a), L² = |b−a|²,
 *   t ≤ 0 → |p−a|² ≤ r²;  t ≥ L² → |p−b|² ≤ r²;  else |p−a|²·L² − t² ≤ r²·L².
 */
export function carveCapsule(t: TerrainState, ax: number, ay: number, bx: number, by: number, r: number): EditRect | null {
  for (const [n, v] of [['ax', ax], ['ay', ay], ['bx', bx], ['by', by]] as const) checkInt(n, v);
  checkRadius(r);
  const dx = bx - ax;
  const dy = by - ay;
  const L2 = dx * dx + dy * dy;
  if (L2 > MAX_CAPSULE_LENGTH * MAX_CAPSULE_LENGTH) throw new RangeError('capsule too long; split it');
  if (L2 === 0) return carveCircle(t, ax, ay, r);
  const x0 = Math.max(0, Math.min(ax, bx) - r);
  const x1 = Math.min(t.width - 1, Math.max(ax, bx) + r);
  const y0 = Math.max(0, Math.min(ay, by) - r);
  const y1 = Math.min(t.height - 1, Math.max(ay, by) + r);
  if (x0 > x1 || y0 > y1) return null;
  const r2 = r * r;
  const r2L2 = r2 * L2;
  const mat = t.mat;
  let changed = 0;
  let minX = x1, maxX = x0, minY = y1, maxY = y0;
  for (let y = y0; y <= y1; y++) {
    const py = y - ay;
    const row = y * t.width;
    for (let x = x0; x <= x1; x++) {
      const i = row + x;
      const m = mat[i]!;
      if (!carvable(m, r)) continue;
      const px = x - ax;
      const proj = px * dx + py * dy;
      let inside: boolean;
      if (proj <= 0) inside = px * px + py * py <= r2;
      else if (proj >= L2) {
        const qx = x - bx, qy = y - by;
        inside = qx * qx + qy * qy <= r2;
      } else inside = (px * px + py * py) * L2 - proj * proj <= r2L2;
      if (inside) {
        setPixelTracked(t, i, x, y, Mat.AIR);
        changed++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return finish(t, minX, minY, maxX, maxY, changed);
}

/**
 * Fill AIR pixels of the rect [x, x+w) × [y, y+h) with `material` (girders, terrain-adding
 * weapons). Existing terrain is left alone, so a girder never overwrites soil or rock.
 */
export function addRect(t: TerrainState, x: number, y: number, w: number, h: number, material: number = Mat.GIRDER): EditRect | null {
  for (const [n, v] of [['x', x], ['y', y], ['w', w], ['h', h]] as const) checkInt(n, v);
  if (w < 1 || h < 1 || w > 4096 || h > 4096) throw new RangeError(`rect size out of range: ${w}×${h}`);
  if (material === Mat.AIR || material < 0 || material > Mat.BORDER || !Number.isInteger(material)) {
    throw new RangeError(`addRect: invalid material ${material}`);
  }
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(t.width - 1, x + w - 1);
  const y1 = Math.min(t.height - 1, y + h - 1);
  if (x0 > x1 || y0 > y1) return null;
  const mat = t.mat;
  let changed = 0;
  for (let yy = y0; yy <= y1; yy++) {
    const row = yy * t.width;
    for (let xx = x0; xx <= x1; xx++) {
      if (mat[row + xx] === Mat.AIR) {
        setPixelTracked(t, row + xx, xx, yy, material);
        changed++;
      }
    }
  }
  return finish(t, x0, y0, x1, y1, changed);
}
