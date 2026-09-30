/**
 * Units used by the simulation (ADR-002).
 *
 * All positions and velocities in simulation state are integers in *subpixels*:
 * 1 px = 256 subpixel units. Time is measured in ticks: 50 ticks per second.
 * Keep every multiplied operand below 2^26 so products stay exact in float64.
 */

export const SUB_SHIFT = 8;
export const SUB = 1 << SUB_SHIFT; // 256 subpixels per pixel

export const TICKS_PER_SECOND = 50;
export const TICK_MS = 1000 / TICKS_PER_SECOND; // 20 ms

/** Pixels (may be fractional, e.g. from content JSON) → integer subpixels, truncated toward zero. */
export function toSub(px: number): number {
  return Math.trunc(px * SUB);
}

/** Subpixels → whole pixels, floored (so -1 sub is pixel -1, not 0). */
export function toPx(sub: number): number {
  return Math.floor(sub / SUB);
}

/** Subpixels → fractional pixels. For rendering only; never feed back into the simulation. */
export function subToPxFloat(sub: number): number {
  return sub / SUB;
}

/** Fixed-point multiply of two subpixel-scaled values (result subpixel-scaled). */
export function fmul(a: number, b: number): number {
  return Math.trunc((a * b) / SUB);
}

/** Fixed-point divide of two subpixel-scaled values (result subpixel-scaled). */
export function fdiv(a: number, b: number): number {
  if (b === 0) throw new RangeError('fdiv by zero');
  return Math.trunc((a * SUB) / b);
}

/** Seconds (content/config) → whole ticks, rounded to nearest. */
export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}

/** Clamp an integer into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
