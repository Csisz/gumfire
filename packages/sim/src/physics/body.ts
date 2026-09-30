import type { SimEvent } from '../core/events.js';
import { SUB } from '../core/units.js';
import type { TerrainState } from '../terrain/terrain.js';
import { MAX_BODY_RADIUS, isSupported, overlapsDisc, overlapsRing, surfaceNormal } from './collision.js';
import { PHYS } from './constants.js';

/**
 * A physics body: a disc moving over the terrain bitmap (plan §9). Characters, grenades,
 * mines, barrels and crates are all bodies with different parameters.
 * Positions/velocities in subpixels; ratios (restitution, friction, gravityScale) ×256.
 */
export interface Body {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Collision radius in whole pixels. */
  radius: number;
  /** Fraction of normal speed kept on impact, ×256. */
  restitution: number;
  /** Fraction of tangential speed kept per contact, ×256. */
  friction: number;
  /** ×256; 256 = normal gravity. */
  gravityScale: number;
  sleeping: boolean;
  /** Consecutive supported, slow ticks (rest detection). */
  stillTicks: number;
  /** 0 = dry; otherwise ticks spent sinking. */
  drownTicks: number;
}

export interface BodyParams {
  radius: number;
  restitution?: number;
  friction?: number;
  gravityScale?: number;
}

export const MAX_BODIES = 256;

export function makeBody(id: number, x: number, y: number, vx: number, vy: number, p: BodyParams): Body {
  if (!Number.isInteger(p.radius) || p.radius < 1 || p.radius > MAX_BODY_RADIUS) throw new RangeError(`bad radius ${p.radius}`);
  return {
    id,
    x,
    y,
    vx,
    vy,
    radius: p.radius,
    restitution: p.restitution ?? 128,
    friction: p.friction ?? 230,
    gravityScale: p.gravityScale ?? SUB,
    sleeping: false,
    stillTicks: 0,
    drownTicks: 0,
  };
}

/** Search order for popping a buried body out: up first, then diagonally up, sideways, down. */
const POP_DIRS = [0, -1, -1, -1, 1, -1, -1, 0, 1, 0, 0, 1] as const;

function findFreeSpot(t: TerrainState, px: number, py: number, r: number): { dx: number; dy: number } | null {
  const maxD = 2 * r + 16;
  for (let d = 1; d <= maxD; d++) {
    for (let k = 0; k < POP_DIRS.length; k += 2) {
      const dx = POP_DIRS[k]! * d, dy = POP_DIRS[k + 1]! * d;
      if (!overlapsDisc(t, px + dx, py + dy, r)) return { dx, dy };
    }
  }
  return null;
}

const clampAbs = (v: number, m: number) => (v > m ? m : v < -m ? -m : v);
const pxOf = (sub: number) => sub >> 8; // floor for int32 subpixel values

/** Wake bodies whose disc (plus a margin) touches an edited pixel rect. */
export function wakeBodiesInRect(bodies: Body[], x0: number, y0: number, x1: number, y1: number): void {
  for (const b of bodies) {
    if (!b.sleeping) continue;
    const px = pxOf(b.x), py = pxOf(b.y), m = b.radius + 2;
    if (px + m >= x0 && px - m <= x1 && py + m >= y0 && py - m <= y1) {
      b.sleeping = false;
      b.stillTicks = 0;
    }
  }
}

/**
 * Advance every body one tick: water, depenetration, gravity, substepped movement with
 * collision response, rest detection, loss off-map. Bodies are processed in id order and
 * removed in place, so iteration order is deterministic.
 */
export function stepBodies(bodies: Body[], t: TerrainState, waterY: number, tick: number, events: SimEvent[]): Body[] {
  const keep: Body[] = [];
  for (const b of bodies) {
    const removed = stepBody(b, t, waterY, tick, events);
    if (!removed) keep.push(b);
  }
  return keep;
}

function stepBody(b: Body, t: TerrainState, waterY: number, tick: number, events: SimEvent[]): boolean {
  // ---- in water: sink, then drown
  if (b.drownTicks > 0) {
    b.drownTicks++;
    b.y += PHYS.sinkSpeed;
    b.vx = (b.vx * 200) >> 8;
    b.vy = PHYS.sinkSpeed;
    if (b.drownTicks > PHYS.drownTicks) {
      events.push({ type: 'BodyRemoved', tick, id: b.id, reason: 'drowned' });
      return true;
    }
    return false;
  }
  if (b.sleeping) return false;

  const r = b.radius;
  let px = pxOf(b.x);
  let py = pxOf(b.y);

  // ---- depenetration: terrain appeared inside the body (girder, spawn inside ground).
  // Pop out to the nearest free spot, preferring up, then sideways, then down.
  if (overlapsDisc(t, px, py, r)) {
    const free = findFreeSpot(t, px, py, r);
    if (free) {
      b.x += free.dx * SUB;
      b.y += free.dy * SUB;
      px += free.dx;
      py += free.dy;
    }
    b.vx = 0;
    b.vy = 0;
    if (!free) return false; // fully buried: wait for terrain to change
  }

  // ---- forces
  b.vy += (PHYS.gravity * b.gravityScale) >> 8;
  if (b.vy > PHYS.terminalVy) b.vy = PHYS.terminalVy;
  b.vx = clampAbs(b.vx, PHYS.maxSpeed);
  b.vy = clampAbs(b.vy, PHYS.maxSpeed);

  // ---- substepped movement, ≤ 1 px per substep
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)) / SUB));
  let touched = false;
  let contactNy = 0;
  for (let s = 0; s < steps; s++) {
    // Exact distribution: the substeps of a free flight sum to exactly (vx, vy).
    const dx = Math.trunc((b.vx * (s + 1)) / steps) - Math.trunc((b.vx * s) / steps);
    const dy = Math.trunc((b.vy * (s + 1)) / steps) - Math.trunc((b.vy * s) / steps);
    if (dx === 0 && dy === 0) continue;
    const nx = b.x + dx;
    const ny = b.y + dy;
    const npx = pxOf(nx);
    const npy = pxOf(ny);
    if ((npx === px && npy === py) || !overlapsRing(t, npx, npy, r)) {
      b.x = nx;
      b.y = ny;
      px = npx;
      py = npy;
      continue;
    }
    // Collision: respond along the surface normal at the blocked position.
    touched = true;
    const n = surfaceNormal(t, npx, npy, r);
    contactNy = n.ny;
    const vn = Math.trunc((b.vx * n.nx + b.vy * n.ny) / SUB);
    if (vn < 0) {
      if (-vn >= PHYS.impactSpeed) events.push({ type: 'BodyImpact', tick, id: b.id, speed: -vn, x: npx, y: npy });
      const tx = b.vx - Math.trunc((vn * n.nx) / SUB);
      const ty = b.vy - Math.trunc((vn * n.ny) / SUB);
      let bounce = Math.trunc((-vn * b.restitution) / SUB);
      if (bounce < PHYS.gravity * 2) bounce = 0; // kill micro-bounces
      b.vx = Math.trunc((tx * b.friction) / SUB) + Math.trunc((bounce * n.nx) / SUB);
      b.vy = Math.trunc((ty * b.friction) / SUB) + Math.trunc((bounce * n.ny) / SUB);
    }
    // Slide: try each axis of the blocked step on its own.
    let moved = false;
    if (dx !== 0 && ((npx === px) || !overlapsRing(t, npx, py, r))) {
      b.x = nx;
      px = npx;
      moved = true;
    }
    if (dy !== 0 && ((npy === py) || !overlapsRing(t, px, npy, r))) {
      b.y = ny;
      py = npy;
      moved = true;
    }
    if (!moved && vn >= 0) {
      // Wedged in a corner with no usable normal: stop rather than jitter.
      b.vx = 0;
      b.vy = 0;
      break;
    }
  }

  // ---- water and map bounds
  if (waterY > 0 && py >= waterY) {
    b.drownTicks = 1;
    b.sleeping = false;
    events.push({ type: 'BodyEnteredWater', tick, id: b.id, x: px, y: waterY });
    return false;
  }
  const m = PHYS.lostMarginPx;
  if (px < -m || px > t.width + m || py > t.height + m) {
    events.push({ type: 'BodyRemoved', tick, id: b.id, reason: 'lost' });
    return true;
  }

  // ---- rest detection (static friction on gentle slopes)
  const slow = Math.abs(b.vx) < PHYS.restSpeed && Math.abs(b.vy) < PHYS.restSpeed;
  if (slow && (touched || isSupported(t, px, py, r))) {
    b.stillTicks++;
    if (b.stillTicks >= PHYS.restTicks) {
      const ny = touched ? contactNy : surfaceNormal(t, px, py, r).ny;
      if (-ny >= PHYS.restMaxSlopeCos) {
        b.sleeping = true;
        b.vx = 0;
        b.vy = 0;
      } else {
        b.stillTicks = 0;
      }
    }
  } else {
    b.stillTicks = 0;
  }
  return false;
}
