import { SUB, toSub } from '../core/units.js';

/**
 * Physics constants (plan §9, §19). Units: subpixels (1 px = 256) and ticks (50 per second).
 * All PROPOSED values, to be tuned by play; they move into content JSON at M5.
 */
export const PHYS = {
  /** 0.20 px/tick² ≈ 500 px/s². */
  gravity: toSub(0.2),
  /** Max downward speed: 12 px/tick. */
  terminalVy: toSub(12),
  /** Hard cap on any speed component (thrown objects, blasts). */
  maxSpeed: toSub(32),
  /** Below this speed (per axis) a supported body counts as still. */
  restSpeed: toSub(0.5),
  /** Consecutive still ticks before a body sleeps. */
  restTicks: 10,
  /** Steepest surface a body can rest on: normal within 40° of straight up (cos 40° ≈ 0.766). */
  restMaxSlopeCos: Math.round(0.766 * SUB),
  /** Normal-velocity magnitude reported as an impact event. */
  impactSpeed: toSub(2),
  /** Ticks a body sinks before it is removed. */
  drownTicks: 75,
  /** Sinking speed in water. */
  sinkSpeed: toSub(1),
  /** Bodies further than this outside the map (left, right, below) are lost. */
  lostMarginPx: 200,
} as const;
