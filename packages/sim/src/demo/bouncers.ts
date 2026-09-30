/**
 * TEMPORARY M0 demo: bouncing placeholder bodies in a box.
 *
 * Exists only to exercise the fixed-step loop, input handling, seeded RNG, hashing
 * and render interpolation before real physics lands. Replaced by `physics/` at M3.
 */
import type { SimEvent } from '../core/events.js';
import { Btn, isDown, pressed, type InputFrame } from '../core/input.js';
import { nextRange, type RngState } from '../core/rng.js';
import { fmul, toSub } from '../core/units.js';

export interface DemoBall {
  id: number;
  x: number; // subpixels
  y: number; // subpixels, y down
  vx: number; // subpixels / tick
  vy: number;
  radius: number; // subpixels
}

export interface DemoState {
  width: number; // subpixels
  height: number;
  balls: DemoBall[];
  nextId: number;
}

export const DEMO = {
  gravity: toSub(0.2), // px/tick²
  restitution: toSub(0.8), // fraction, 256-scaled
  friction: toSub(0.98),
  push: toSub(0.15),
  maxBalls: 64,
  radiusPx: 12,
} as const;

export function createDemo(widthPx: number, heightPx: number, rng: RngState, initialBalls: number): DemoState {
  const demo: DemoState = { width: toSub(widthPx), height: toSub(heightPx), balls: [], nextId: 1 };
  for (let i = 0; i < initialBalls; i++) spawnBall(demo, rng);
  return demo;
}

export function spawnBall(demo: DemoState, rng: RngState): DemoBall | null {
  if (demo.balls.length >= DEMO.maxBalls) return null;
  const r = toSub(DEMO.radiusPx);
  const ball: DemoBall = {
    id: demo.nextId++,
    x: nextRange(rng, r, demo.width - r),
    y: nextRange(rng, r, Math.max(r, Math.trunc(demo.height / 3))),
    vx: nextRange(rng, -toSub(4), toSub(4)),
    vy: nextRange(rng, -toSub(2), 0),
    radius: r,
  };
  demo.balls.push(ball);
  return ball;
}

export function stepDemo(
  demo: DemoState,
  rng: RngState,
  prevInput: InputFrame,
  input: InputFrame,
  tick: number,
  events: SimEvent[],
): void {
  if (pressed(prevInput, input, Btn.Fire)) {
    const b = spawnBall(demo, rng);
    if (b) events.push({ type: 'DemoSpawned', tick, id: b.id });
  }
  const push = (isDown(input, Btn.Right) ? DEMO.push : 0) - (isDown(input, Btn.Left) ? DEMO.push : 0);
  const kick = pressed(prevInput, input, Btn.Jump);

  for (const b of demo.balls) {
    b.vx += push;
    if (kick) b.vy -= toSub(6);
    b.vy += DEMO.gravity;
    b.x += b.vx;
    b.y += b.vy;

    const floor = demo.height - b.radius;
    if (b.y > floor) {
      b.y = floor;
      if (b.vy > toSub(1)) events.push({ type: 'DemoBounced', tick, id: b.id, speed: b.vy });
      b.vy = -fmul(b.vy, DEMO.restitution);
      b.vx = fmul(b.vx, DEMO.friction);
      if (Math.abs(b.vy) < DEMO.gravity * 2) b.vy = 0;
    }
    if (b.y < b.radius) {
      b.y = b.radius;
      b.vy = -fmul(b.vy, DEMO.restitution);
    }
    if (b.x < b.radius) {
      b.x = b.radius;
      b.vx = -fmul(b.vx, DEMO.restitution);
    } else if (b.x > demo.width - b.radius) {
      b.x = demo.width - b.radius;
      b.vx = -fmul(b.vx, DEMO.restitution);
    }
  }
}
