import { SUB } from '../core/units.js';
import { isqrt } from '../core/trig.js';
import { isSolid, type TerrainState } from '../terrain/terrain.js';

/**
 * Circle-vs-bitmap collision (plan §9.1). Bodies are discs of integer pixel radius centred on
 * their pixel position. Moving at most 1 px per substep, a disc can only touch new terrain
 * through its outermost ring of pixels, so the per-substep test checks just that ring —
 * and a 1 px wall can never be skipped.
 */

export type Offsets = Int16Array; // [dx0, dy0, dx1, dy1, ...]

const ringCache = new Map<number, Offsets>();
const discCache = new Map<number, Offsets>();
export const MAX_BODY_RADIUS = 48;

function build(r: number, test: (d2: number) => boolean): Offsets {
  const out: number[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (test(dx * dx + dy * dy)) out.push(dx, dy);
  return Int16Array.from(out);
}

function checkR(r: number): void {
  if (!Number.isInteger(r) || r < 1 || r > MAX_BODY_RADIUS + 2) throw new RangeError(`bad body radius ${r}`);
}

/** Pixels at distance (r−1, r]: the disc's outermost, 4-connected ring. */
export function ringOffsets(r: number): Offsets {
  checkR(r);
  let o = ringCache.get(r);
  if (!o) {
    o = build(r, (d2) => d2 <= r * r && d2 > (r - 1) * (r - 1));
    ringCache.set(r, o);
  }
  return o;
}

/** All pixels with distance ≤ r. */
export function discOffsets(r: number): Offsets {
  checkR(r);
  let o = discCache.get(r);
  if (!o) {
    o = build(r, (d2) => d2 <= r * r);
    discCache.set(r, o);
  }
  return o;
}

export function overlapsOffsets(t: TerrainState, px: number, py: number, offs: Offsets): boolean {
  for (let k = 0; k < offs.length; k += 2) if (isSolid(t, px + offs[k]!, py + offs[k + 1]!)) return true;
  return false;
}

export const overlapsRing = (t: TerrainState, px: number, py: number, r: number) => overlapsOffsets(t, px, py, ringOffsets(r));
export const overlapsDisc = (t: TerrainState, px: number, py: number, r: number) => overlapsOffsets(t, px, py, discOffsets(r));

export interface Normal {
  /** Unit vector ×256 pointing out of the terrain (y down). */
  nx: number;
  ny: number;
}

/**
 * Surface normal around a pixel: the negated sum of offsets to solid pixels within radius
 * r + 2, normalised to length 256. Falls back to straight up when the sum cancels out.
 */
export function surfaceNormal(t: TerrainState, px: number, py: number, r: number): Normal {
  const offs = discOffsets(Math.min(r + 2, MAX_BODY_RADIUS + 2));
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < offs.length; k += 2) {
    const dx = offs[k]!, dy = offs[k + 1]!;
    if (isSolid(t, px + dx, py + dy)) {
      sx -= dx;
      sy -= dy;
    }
  }
  const len = isqrt(sx * sx + sy * sy);
  if (len === 0) return { nx: 0, ny: -SUB };
  return { nx: Math.trunc((sx * SUB) / len), ny: Math.trunc((sy * SUB) / len) };
}

/** Whether there is terrain directly beneath the disc (touching its lower ring shifted 1 px down). */
export function isSupported(t: TerrainState, px: number, py: number, r: number): boolean {
  const ring = ringOffsets(r);
  for (let k = 0; k < ring.length; k += 2) {
    const dy = ring[k + 1]!;
    if (dy > 0 && isSolid(t, px + ring[k]!, py + dy + 1)) return true;
  }
  return false;
}
