import { ATAN_TABLE, SIN_TABLE } from './trigTables.js';

/**
 * Integer trigonometry (ADR-002).
 *
 * Angles are integers 0..4095 for a full turn, measured counter-clockwise from +x
 * in *mathematical* orientation (y up). Screen code flips y when needed.
 * sin/cos return Q16 values: 65536 = 1.0.
 */

export const ANGLE_STEPS = 4096;
export const ANGLE_MASK = ANGLE_STEPS - 1;
export const QUARTER_TURN = ANGLE_STEPS / 4; // 1024 = 90°
export const HALF_TURN = ANGLE_STEPS / 2; // 2048 = 180°
export const TRIG_ONE = 65536;

const ATAN_STEPS = 1024;

export function normalizeAngle(a: number): number {
  return a & ANGLE_MASK;
}

export function sinA(a: number): number {
  return SIN_TABLE[a & ANGLE_MASK]!;
}

export function cosA(a: number): number {
  return SIN_TABLE[(a + QUARTER_TURN) & ANGLE_MASK]!;
}

/** Degrees (content/config, may be fractional) → angle units, rounded. */
export function degToAngle(deg: number): number {
  return Math.round((deg * ANGLE_STEPS) / 360);
}

/** Angle units → degrees. For display only. */
export function angleToDeg(a: number): number {
  return ((a & ANGLE_MASK) * 360) / ANGLE_STEPS;
}

/**
 * Integer atan2: angle of vector (x, y) in angle units, 0..4095.
 * Maximum error ≈ 1 angle unit (0.09°). (0, 0) returns 0.
 */
export function atan2A(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  let a: number;
  if (ax >= ay) {
    a = ATAN_TABLE[Math.trunc((ay * ATAN_STEPS) / ax)]!;
  } else {
    a = QUARTER_TURN - ATAN_TABLE[Math.trunc((ax * ATAN_STEPS) / ay)]!;
  }
  if (x < 0) a = HALF_TURN - a;
  if (y < 0) a = ANGLE_STEPS - a;
  return a & ANGLE_MASK;
}

/** Exact integer floor square root for 0 ≤ n ≤ Number.MAX_SAFE_INTEGER. */
export function isqrt(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`isqrt: invalid input ${n}`);
  if (n < 2) return n;
  // Hardware sqrt only gives a starting guess; the loops below make the result exact on every engine.
  // eslint-disable-next-line no-restricted-properties
  let x = Math.floor(Math.sqrt(n));
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

/** Integer length of vector (x, y). */
export function ilength(x: number, y: number): number {
  return isqrt(x * x + y * y);
}

/**
 * Unit vector for an angle, scaled to `scale` (e.g. SUB for a 256-scaled normal,
 * or a speed in subpixels/tick to get a velocity).
 */
export function vecFromAngle(a: number, scale: number): { x: number; y: number } {
  return {
    x: Math.trunc((cosA(a) * scale) / TRIG_ONE),
    y: Math.trunc((sinA(a) * scale) / TRIG_ONE),
  };
}
