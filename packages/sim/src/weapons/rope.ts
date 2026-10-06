import type { SimEvent } from '../core/events.js';
import { Btn, isDown, pressed, type InputFrame } from '../core/input.js';
import { SUB } from '../core/units.js';
import { ilength } from '../core/trig.js';
import { CHAR, startFall, type Character } from '../character/character.js';
import { overlapsDisc } from '../physics/collision.js';
import { PHYS } from '../physics/constants.js';
import { isSolid } from '../terrain/terrain.js';
import type { GameState } from '../state/gameState.js';
import type { WeaponDef } from './definition.js';
import { launchVector } from './projectile.js';

/**
 * Licorice Grapple (plan §12.5, M13): a variable-length inextensible pendulum with corner wrapping.
 *
 *   shoot  — the head flies `headSpeed` px/tick along the aim and bites the first solid pixel
 *            within `maxLength`; a miss just retracts. The first bite of a use costs ammo; while
 *            the use lasts (until the Gumling lands) up to `shots` re-shots are free.
 *   swing  — gravity + ← → push along the tangent while the rope is taut; ↑ ↓ reel in / out.
 *            Moving past the rope length projects back onto the circle and drops the outward
 *            radial velocity: momentum stays tangential — the swing feel. Wall bumps halve speed.
 *   wrap   — when terrain cuts the line from the pivot to the Gumling, the last free pixel before
 *            it becomes a new pivot; the line unwraps when the Gumling swings back past it.
 *   release — Space (with the rope in hand) or Enter: let go, keep the velocity, fly.
 *   weapons — with another weapon in hand, Space uses it from the rope (thrown ones charge
 *            as usual); ↑ ↓ then aim instead of reeling. That starts the longer rope retreat.
 */
export const ROPE = {
  /** Shortest rope, px. */
  minLen: 12,
  /** Head starts this far from the Gumling's centre, px. */
  headStart: 10,
  /** Pivot stack limit (a rope wound round many corners). */
  maxPivots: 24,
} as const;

const px = (v: number) => v >> 8;
const centre = (p: number) => p * SUB + SUB / 2;

/** Fire with the rope in hand, off the rope: shoot the head (a re-shot costs one of the use's shots). */
export function shootHead(s: GameState, c: Character, index: number, def: WeaponDef, events: SimEvent[]): boolean {
  if (c.headOn || (c.ropeOn && c.ropeShots <= 0)) return false;
  const dir = launchVector(c.aim, c.facing, SUB);
  c.headOn = true;
  c.headDx = dir.vx;
  c.headDy = dir.vy;
  c.headX = c.body.x + dir.vx * ROPE.headStart;
  c.headY = c.body.y + dir.vy * ROPE.headStart;
  c.headDist = ROPE.headStart;
  c.ropeWeapon = index;
  if (c.ropeOn) c.ropeShots--;
  events.push({ type: 'RopeShot', tick: s.tick, id: c.id, shotsLeft: c.ropeOn ? c.ropeShots : def.ropeShots });
  return true;
}

/**
 * Advance a flying head. Returns 'first' when it bit and this was the use's first bite (the
 * caller spends ammo), 'attached' for a re-shot bite, 'missed' or 'flying'.
 */
export function stepHead(s: GameState, c: Character, events: SimEvent[]): 'first' | 'attached' | 'missed' | 'flying' {
  const def = s.weapons[c.ropeWeapon];
  const t = s.terrain!;
  if (!def || c.state === 'dead' || c.state === 'drowning') {
    c.headOn = false;
    return 'missed';
  }
  for (let i = 0; i < def.ropeHeadSpeed; i++) {
    const nx = c.headX + c.headDx, ny = c.headY + c.headDy;
    if (isSolid(t, px(nx), px(ny))) return attach(s, c, def, px(c.headX), px(c.headY), events);
    c.headX = nx;
    c.headY = ny;
    c.headDist++;
    const hx = px(nx), hy = px(ny);
    if (c.headDist >= def.ropeLength || hx < 0 || hx >= t.width || hy >= t.height || hy < -400) {
      c.headOn = false;
      events.push({ type: 'RopeMissed', tick: s.tick, id: c.id });
      return 'missed';
    }
  }
  return 'flying';
}

function attach(s: GameState, c: Character, def: WeaponDef, ax: number, ay: number, events: SimEvent[]): 'first' | 'attached' {
  c.headOn = false;
  const first = !c.ropeOn;
  if (first) {
    c.ropeOn = true;
    c.ropeShots = def.ropeShots;
  }
  c.ropePivots = [ax, ay, 0];
  c.ropeWrapped = 0;
  c.ropeLen = Math.max(ROPE.minLen * SUB, Math.min(def.ropeLength * SUB, ilength(c.body.x - centre(ax), c.body.y - centre(ay))));
  c.state = 'rope';
  c.stateTicks = 0;
  c.power = 0;
  c.jet = false;
  c.chute = false;
  c.body.sleeping = false;
  c.body.stillTicks = 0;
  c.fallImmune = false;
  events.push({ type: 'RopeAttached', tick: s.tick, id: c.id, x: ax, y: ay });
  return first ? 'first' : 'attached';
}

/** Let go of the rope: keep the velocity and fly (re-shots stay available until landing). */
export function releaseRope(s: GameState, c: Character, events: SimEvent[]): void {
  c.ropePivots = [];
  c.ropeLen = 0;
  c.ropeWrapped = 0;
  startFall(c, c.body.vx, c.body.vy);
  c.fallImmune = false;
  events.push({ type: 'RopeReleased', tick: s.tick, id: c.id });
}

/**
 * Charge-and-fire for weapons used off the ground (rope, jetpack). Instant weapons fire on the
 * press; thrown ones charge while Space is held and fire on release or at full charge.
 * Returns the charge to fire with, or −1.
 */
export function airCharge(c: Character, w: WeaponDef, input: InputFrame, prev: InputFrame): number {
  if (w.needsTarget && !c.hasTarget) return -1;
  if (w.instant) return pressed(prev, input, Btn.Fire) ? 0 : -1;
  if (c.power > 0) {
    if (isDown(input, Btn.Fire) && c.power < w.chargeTicks) {
      c.power++;
      if (c.power < w.chargeTicks) return -1;
    }
    const p = c.power;
    c.power = 0;
    return p;
  }
  if (pressed(prev, input, Btn.Fire)) c.power = 1;
  return -1;
}

/** 2-D cross product (a→b) × (b→c): which side of the line a→b the point c bends to. */
function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
}
/** Unwrap only once the Gumling is this far (px) past the old line: no flicker at the corner. */
const UNWRAP_MARGIN = 2;

/**
 * One tick on the rope. `weapon` is the usable selected weapon (or null). Returns the charge to
 * fire `weapon` with from the rope, or −1.
 */
export function stepRope(s: GameState, c: Character, controlled: boolean, input: InputFrame, prev: InputFrame, weapon: WeaponDef | null, events: SimEvent[]): number {
  const def = s.weapons[c.ropeWeapon];
  const t = s.terrain!;
  const b = c.body;
  c.stateTicks++;
  if (!def || !controlled || c.ropePivots.length < 3) {
    releaseRope(s, c, events);
    return -1;
  }
  const ropeInHand = !weapon || weapon.utility === 'rope' || !weapon.usableFromRope;
  if (pressed(prev, input, Btn.Jump) || (ropeInHand && pressed(prev, input, Btn.Fire))) {
    releaseRope(s, c, events);
    return -1;
  }
  let fire = -1;
  if (!ropeInHand && weapon) fire = airCharge(c, weapon, input, prev);

  const n = c.ropePivots.length;
  let pX = c.ropePivots[n - 3]!, pY = c.ropePivots[n - 2]!;
  const left = isDown(input, Btn.Left), right = isDown(input, Btn.Right);
  const up = isDown(input, Btn.Up), down = isDown(input, Btn.Down);
  if (left !== right) c.facing = right ? 1 : -1;

  // ---- forces: gravity, swing push along the tangent (only while taut)
  b.vy += (PHYS.gravity * b.gravityScale) >> 8;
  let rx = b.x - centre(pX), ry = b.y - centre(pY);
  let dist = ilength(rx, ry);
  if (left !== right && dist > 0 && dist >= c.ropeLen - SUB) {
    let tx = -ry, ty = rx; // perpendicular to the rope
    const want = right ? 1 : -1;
    if (tx * want < 0 || (tx === 0 && ty * want < 0)) {
      tx = -tx;
      ty = -ty;
    }
    b.vx += Math.trunc((tx * def.ropeSwing) / dist);
    b.vy += Math.trunc((ty * def.ropeSwing) / dist);
  }
  // ---- reel (with the rope in hand; with a weapon in hand ↑ ↓ aim instead)
  if (up !== down) {
    if (ropeInHand) {
      const maxLen = Math.max(ROPE.minLen * SUB, def.ropeLength * SUB - c.ropeWrapped);
      c.ropeLen = Math.max(ROPE.minLen * SUB, Math.min(maxLen, c.ropeLen + (up ? -def.ropeReel : def.ropeReel)));
    } else {
      c.aimHeld++;
      const stepA = c.aimHeld > CHAR.aimFastAfter ? CHAR.aimStepFast : CHAR.aimStep;
      c.aim = Math.max(-CHAR.aimMax, Math.min(CHAR.aimMax, c.aim + (up ? stepA : -stepA)));
    }
  } else c.aimHeld = 0;
  // ---- speed cap
  const sp = ilength(b.vx, b.vy);
  if (sp > def.ropeMaxSpeed) {
    b.vx = Math.trunc((b.vx * def.ropeMaxSpeed) / sp);
    b.vy = Math.trunc((b.vy * def.ropeMaxSpeed) / sp);
  }
  // ---- move with collision (≤ 1 px substeps); a bump halves the speed
  const r = CHAR.radius;
  let bumped = false;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)) / SUB));
  for (let k = 0; k < steps; k++) {
    const sx = Math.trunc((b.vx * (k + 1)) / steps) - Math.trunc((b.vx * k) / steps);
    const sy = Math.trunc((b.vy * (k + 1)) / steps) - Math.trunc((b.vy * k) / steps);
    if (!overlapsDisc(t, px(b.x + sx), px(b.y + sy), r)) {
      b.x += sx;
      b.y += sy;
    } else if (sx !== 0 && !overlapsDisc(t, px(b.x + sx), px(b.y), r)) {
      b.x += sx;
      bumped = true;
      b.vy = -Math.trunc(b.vy / 4);
    } else if (sy !== 0 && !overlapsDisc(t, px(b.x), px(b.y + sy), r)) {
      b.y += sy;
      bumped = true;
      b.vx = -Math.trunc(b.vx / 4);
    } else {
      bumped = true;
      b.vx = -Math.trunc(b.vx / 4);
      b.vy = -Math.trunc(b.vy / 4);
      break;
    }
  }
  if (bumped) {
    b.vx = Math.trunc(b.vx / 2);
    b.vy = Math.trunc(b.vy / 2);
  }
  // ---- the rope is inextensible: back onto the circle, drop the outward radial speed
  rx = b.x - centre(pX);
  ry = b.y - centre(pY);
  dist = ilength(rx, ry);
  if (dist > c.ropeLen && dist > 0) {
    const nx = centre(pX) + Math.trunc((rx * c.ropeLen) / dist), ny = centre(pY) + Math.trunc((ry * c.ropeLen) / dist);
    if (!overlapsDisc(t, px(nx), px(ny), r)) {
      b.x = nx;
      b.y = ny;
    }
    const vr = Math.trunc((b.vx * rx + b.vy * ry) / dist);
    if (vr > 0) {
      b.vx -= Math.trunc((rx * vr) / dist);
      b.vy -= Math.trunc((ry * vr) / dist);
    }
  }
  // ---- wrap: terrain between the pivot and the Gumling makes a new pivot
  const cx = px(b.x), cy = px(b.y);
  const dx = pX - cx, dy = pY - cy;
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  let wrapped = false;
  if (c.ropePivots.length / 3 < ROPE.maxPivots) {
    for (let k = 1; k < m - 3; k++) {
      const x = cx + Math.trunc((dx * k) / m), y = cy + Math.trunc((dy * k) / m);
      if (!isSolid(t, x, y)) continue;
      const fx = cx + Math.trunc((dx * (k - 1)) / m), fy = cy + Math.trunc((dy * (k - 1)) / m);
      const seg = ilength(fx - pX, fy - pY) * SUB;
      if (seg >= 4 * SUB) {
        // the bend goes the way the Gumling is moving (it sits on the old line right now)
        const bend = (fx - pX) * b.vy - (fy - pY) * b.vx;
        c.ropePivots.push(fx, fy, bend > 0 ? 1 : -1);
        c.ropeWrapped += seg;
        c.ropeLen = Math.max(ROPE.minLen * SUB, c.ropeLen - seg);
        events.push({ type: 'RopeWrapped', tick: s.tick, id: c.id, x: fx, y: fy, pivots: c.ropePivots.length / 3 });
        pX = fx;
        pY = fy;
        wrapped = true;
      }
      break;
    }
  }
  // ---- unwrap: swung back past the last corner
  if (!wrapped && c.ropePivots.length >= 6) {
    const k = c.ropePivots.length;
    const qX = c.ropePivots[k - 6]!, qY = c.ropePivots[k - 5]!, sgn = c.ropePivots[k - 1]!;
    const now = cross(qX, qY, pX, pY, cx, cy);
    const seg0 = Math.max(1, ilength(pX - qX, pY - qY));
    if (now * sgn < 0 && Math.abs(now) > UNWRAP_MARGIN * seg0) {
      const seg = ilength(pX - qX, pY - qY) * SUB;
      c.ropePivots.length = k - 3;
      c.ropeWrapped = Math.max(0, c.ropeWrapped - seg);
      c.ropeLen += seg;
      events.push({ type: 'RopeUnwrapped', tick: s.tick, id: c.id, pivots: c.ropePivots.length / 3 });
    }
  }
  // ---- water and the map edges end the swing
  if ((s.waterY > 0 && cy >= s.waterY) || cx < -100 || cx > t.width + 100 || cy > t.height + 100) releaseRope(s, c, events);
  return fire;
}
