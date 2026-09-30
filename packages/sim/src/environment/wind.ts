import { nextRange, type RngState } from '../core/rng.js';

/**
 * Wind (plan §9.2, §14). An integer W in [−100, 100]; positive blows right.
 * Applied as a horizontal acceleration of W × 0.0006 px/tick² to anything with a wind factor
 * (±0.06 px/tick² at full strength, 30 % of gravity).
 *
 * To keep weak winds from vanishing in integer rounding, each projectile carries a remainder:
 * per tick it adds W × WIND_UNITS_PER_100 × windFactor and takes out whole subpixels, so the
 * accumulated drift is exact over any flight.
 */
export const WIND_MAX = 100;
/** Subpixels/tick² at W = 100 and windFactor = 1 (0.06 px ≈ 15.36 → 15). */
export const WIND_ACCEL_AT_100 = 15;
/** Denominator of the remainder: 100 wind steps × windFactor ×256. */
export const WIND_REM_SCALE = 100 * 256;

/** Advance a wind remainder one tick; returns the whole-subpixel acceleration to apply. */
export function windStep(wind: number, windFactor: number, rem: { windRem: number }): number {
  rem.windRem += wind * WIND_ACCEL_AT_100 * windFactor;
  const dv = Math.trunc(rem.windRem / WIND_REM_SCALE);
  rem.windRem -= dv * WIND_REM_SCALE;
  return dv;
}

/**
 * New wind for the next turn: a triangular step of up to ±40 around the previous value
 * (sum of two uniform draws), clamped. Consecutive turns feel related, with occasional swings.
 */
export function rollWind(rng: RngState, previous: number): number {
  const delta = nextRange(rng, -20, 20) + nextRange(rng, -20, 20);
  return Math.max(-WIND_MAX, Math.min(WIND_MAX, previous + delta));
}
