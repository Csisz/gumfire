import { SUB, TICKS_PER_SECOND } from '../core/units.js';
import { ANGLE_STEPS, HALF_TURN, atan2A, ilength, normalizeAngle, vecFromAngle } from '../core/trig.js';
import { windStep } from '../environment/wind.js';
import { isSupported, overlapsDisc } from '../physics/collision.js';
import { PHYS } from '../physics/constants.js';
import { touchesHitbox, type Character } from '../character/character.js';
import { makeBody, stepBody, type Body } from '../physics/body.js';
import type { SimEvent } from '../core/events.js';
import type { TerrainState } from '../terrain/terrain.js';
import { throwCharacter } from '../explosions/explosion.js';
import { touchesObject, type WorldObject } from '../environment/objects.js';
import { launchSpeed, type WeaponDef } from './definition.js';

/**
 * Projectiles (plan §12, ProjectileSystem). Three ways to fly:
 *  - ballistic: gravity × gravityScale + wind × windFactor in exact ≤ 1 px substeps (nothing
 *    tunnels); impact trigger on terrain or a character (shooter ignored for a few ticks);
 *    optional homing that steers towards the target for a while;
 *  - body: fused / bouncing / walking projectiles are physics bodies (same collision code as
 *    everything else); walkers stroll along the ground once they land;
 *  - boomerang: pulled back towards the thrower, striking characters it passes, caught on return.
 * Fuse and remote triggers work with any of them.
 */
export interface Projectile {
  id: number;
  /** Index into `state.weapons` (may be a hidden sub-projectile def). */
  weapon: number;
  /** Character id of the shooter (0 = none). */
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  /** Wind remainder (see environment/wind.ts). */
  windRem: number;
  /** Ticks left on the fuse; −1 = no fuse. */
  fuse: number;
  /** Fused / bouncing / walking projectiles fly as physics bodies; `x/y/vx/vy` mirror it. */
  body: Body | null;
  /** Remote trigger pulled (set by the owner's Fire press). */
  detonate: boolean;
  /** Walker: 0 = still in the air after launch, ±1 = walking direction. */
  walkDir: number;
  /** Walker: blocked attempts since it last walked `WALK_RESET` px freely (turns round after two). */
  blocked: number;
  /** Walker: px walked since the last block. */
  stride: number;
  /** Homing target / boomerang home, whole px. */
  tx: number;
  ty: number;
  /** Boomerang: characters already struck on this throw. */
  struck: number[];
}

export type ProjectileOutcome =
  | { kind: 'flying' }
  | { kind: 'explode'; x: number; y: number; hit: 'terrain' | 'character' | 'object' | 'timeout' | 'fuse' | 'remote'; characterId: number }
  | { kind: 'splash'; x: number }
  | { kind: 'lost' }
  /** Ended without a payload (a boomerang caught or dropped). */
  | { kind: 'gone'; caught: boolean };

/**
 * Launch velocity from a character's aim and facing (plan §9.2). `aim` is relative to
 * horizontal-forward, positive = up; screen y points down.
 */
export function launchVector(aim: number, facing: number, speed: number): { vx: number; vy: number } {
  const world = normalizeAngle(facing >= 0 ? aim : HALF_TURN - aim);
  const v = vecFromAngle(world, speed);
  return { vx: v.x, vy: 0 - v.y }; // screen y is down; `0 -` avoids a −0
}

function bodyFor(id: number, def: WeaponDef, x: number, y: number, vx: number, vy: number, bouncy: boolean): Body | null {
  if (!(def.bounceLow > 0 || def.bounceHigh > 0 || def.fuseTicks > 0 || def.behavior === 'walker')) return null;
  return makeBody(id, x, y, vx, vy, {
    radius: def.radius,
    restitution: bouncy ? def.bounceHigh : def.bounceLow,
    friction: def.bounceFriction,
    gravityScale: def.gravityScale,
  });
}

/** A projectile at (x, y) subpixels with velocity (vx, vy) — sub-projectiles and strikes. */
export function spawnProjectile(id: number, weaponIndex: number, def: WeaponDef, owner: number, x: number, y: number, vx: number, vy: number): Projectile {
  return {
    id,
    weapon: weaponIndex,
    owner,
    x,
    y,
    vx,
    vy,
    age: 0,
    windRem: 0,
    fuse: def.fuseTicks > 0 ? def.fuseTicks : -1,
    body: bodyFor(id, def, x, y, vx, vy, false),
    detonate: false,
    walkDir: 0,
    blocked: 0,
    stride: 0,
    tx: x >> 8,
    ty: y >> 8,
    struck: [],
  };
}

/** Create a projectile at the shooter's muzzle. */
export function makeProjectile(id: number, weaponIndex: number, def: WeaponDef, shooter: Character, power: number): Projectile {
  const speed = launchSpeed(def, power);
  const v = launchVector(shooter.aim, shooter.facing, speed);
  const dir = launchVector(shooter.aim, shooter.facing, def.muzzleOffset * SUB);
  const x = shooter.body.x + dir.vx, y = shooter.body.y + dir.vy;
  const p = spawnProjectile(id, weaponIndex, def, shooter.id, x, y, v.vx, v.vy);
  if (def.fuseTicks > 0 && def.playerFuse) p.fuse = shooter.fuse * TICKS_PER_SECOND;
  if (p.body) p.body.restitution = shooter.bounceHigh ? def.bounceHigh : def.bounceLow;
  if (def.behavior === 'walker') p.walkDir = 0;
  if (def.homingDuration > 0 && shooter.hasTarget) {
    p.tx = shooter.targetX;
    p.ty = shooter.targetY;
  }
  if (def.behavior === 'boomerang') {
    p.tx = shooter.body.x >> 8;
    p.ty = shooter.body.y >> 8;
  }
  return p;
}

const pxOf = (s: number) => s >> 8;
/** A walker that walks this far after a block forgets it (so separate bumps each get a hop). */
const WALK_RESET = 40;
/** Boomerang: it homes on a point this far above the thrower, who catches it within this reach. */
const BOOMERANG_HOME_LIFT = 20;
const BOOMERANG_CATCH_REACH = 10;
const BOOMERANG_CATCH_AFTER = 20;

function hitCharacter(p: Projectile, def: WeaponDef, chars: readonly Character[], x: number, y: number): number {
  for (const c of chars) {
    if (c.state === 'dead' || c.state === 'drowning') continue;
    if (c.id === p.owner && p.age <= def.ignoreOwnerTicks) continue;
    if (touchesHitbox(c, x, y, def.radius)) return c.id;
  }
  return 0;
}

/** Fuse, remote and max-life checks shared by every kind of flight. */
function triggers(p: Projectile, def: WeaponDef): ProjectileOutcome | null {
  if (p.detonate) return { kind: 'explode', x: pxOf(p.x), y: pxOf(p.y), hit: 'remote', characterId: 0 };
  if (p.fuse >= 0 && p.fuse-- <= 0) return { kind: 'explode', x: pxOf(p.x), y: pxOf(p.y), hit: 'fuse', characterId: 0 };
  if (p.age >= def.maxLifeTicks) return { kind: 'explode', x: pxOf(p.x), y: pxOf(p.y), hit: 'timeout', characterId: 0 };
  return null;
}

function mirror(p: Projectile, b: Body): void {
  p.x = b.x;
  p.y = b.y;
  p.vx = b.vx;
  p.vy = b.vy;
}

/**
 * Walker on the ground: move `speed` px along `walkDir`, stepping up or down at most
 * `maxStep` px per pixel; a wall it cannot climb makes it hop, two in a row make it turn round.
 * Returns false when it lost the ground (the body takes over again).
 */
function walk(p: Projectile, b: Body, def: WeaponDef, t: TerrainState): boolean {
  const r = def.radius;
  let px = pxOf(b.x), py = pxOf(b.y);
  if (!isSupported(t, px, py, r)) return false;
  for (let s = 0; s < def.walkerSpeed; s++) {
    const nx = px + p.walkDir;
    let moved = false;
    for (let up = 0; up <= def.walkerMaxStep; up++) {
      if (overlapsDisc(t, nx, py - up, r)) continue;
      // found room; settle down onto the ground below (small steps down)
      let ny = py - up;
      for (let d = 0; d < def.walkerMaxStep && !isSupported(t, nx, ny, r) && !overlapsDisc(t, nx, ny + 1, r); d++) ny++;
      px = nx;
      py = ny;
      moved = true;
      break;
    }
    if (!moved) {
      p.blocked++;
      b.x = px * SUB + SUB / 2;
      b.y = py * SUB + SUB / 2;
      p.stride = 0;
      if (p.blocked >= 2) {
        p.walkDir = -p.walkDir; // a wall it cannot hop: turn round
        p.blocked = 0;
        b.vx = 0;
        b.vy = 0;
        return true;
      }
      b.vy = -def.walkerHop; // try to hop over it
      b.vx = p.walkDir * def.walkerSpeed * SUB;
      b.sleeping = false;
      return false;
    }
  }
  p.stride += def.walkerSpeed;
  if (p.stride >= WALK_RESET) p.blocked = 0; // walked clear of the last obstacle
  b.x = px * SUB + SUB / 2;
  b.y = py * SUB + SUB / 2;
  b.vx = p.walkDir * def.walkerSpeed * SUB;
  b.vy = 0;
  b.sleeping = false;
  b.stillTicks = 0;
  return true; // a ledge (no support any more) is handled next tick by the body
}

/** Body flight: fused grenades, bouncers and walkers. Characters are passed through. */
function stepBodyProjectile(p: Projectile, b: Body, def: WeaponDef, t: TerrainState, wind: number, waterY: number, tick: number, events: SimEvent[]): ProjectileOutcome {
  const fired = triggers(p, def);
  if (fired) return fired;
  if (def.behavior === 'walker' && p.walkDir !== 0 && b.drownTicks === 0 && b.vy >= 0 && walk(p, b, def, t)) {
    mirror(p, b);
    if (waterY > 0 && pxOf(b.y) >= waterY) return { kind: 'splash', x: pxOf(b.x) };
    return { kind: 'flying' };
  }
  if (def.windFactor !== 0 && !b.sleeping) b.vx += windStep(wind, def.windFactor, p);
  const res = stepBody(b, t, waterY, tick, []);
  mirror(p, b);
  if (res.impactSpeed > 0) events.push({ type: 'ProjectileBounced', tick, id: p.id, speed: res.impactSpeed, x: pxOf(b.x), y: pxOf(b.y) });
  if (res.enteredWater) return { kind: 'splash', x: pxOf(b.x) };
  if (res.removed === 'lost') return { kind: 'lost' };
  // a walker starts walking once it touches ground it can stand on
  if (def.behavior === 'walker' && (res.touched || b.sleeping) && isSupported(t, pxOf(b.x), pxOf(b.y), def.radius)) {
    if (p.walkDir === 0) p.walkDir = p.vx < 0 ? -1 : 1;
    if (p.walkDir === 0) p.walkDir = 1;
  }
  return { kind: 'flying' };
}

/** Steer the velocity towards the target by at most `homingTurn` per tick. */
function home(p: Projectile, def: WeaponDef): void {
  const want = atan2A(-((p.ty * SUB + SUB / 2) - p.y), p.tx * SUB + SUB / 2 - p.x);
  const have = atan2A(-p.vy, p.vx);
  let diff = (want - have) & (ANGLE_STEPS - 1);
  if (diff > ANGLE_STEPS / 2) diff -= ANGLE_STEPS;
  const turn = Math.max(-def.homingTurn, Math.min(def.homingTurn, diff));
  const v = vecFromAngle(normalizeAngle(have + turn), def.homingSpeed);
  p.vx = v.x;
  p.vy = 0 - v.y;
}

/** Advance one projectile one tick. */
export function stepProjectile(
  p: Projectile,
  def: WeaponDef,
  t: TerrainState,
  chars: Character[],
  wind: number,
  waterY: number,
  tick = 0,
  events: SimEvent[] = [],
  objects: readonly WorldObject[] = [],
): ProjectileOutcome {
  p.age++;
  if (p.body) return stepBodyProjectile(p, p.body, def, t, wind, waterY, tick, events);
  // A projectile that starts inside terrain (fired point-blank into a wall) goes off at once.
  if (p.age === 1 && def.impact && overlapsDisc(t, pxOf(p.x), pxOf(p.y), def.radius)) {
    return { kind: 'explode', x: pxOf(p.x), y: pxOf(p.y), hit: 'terrain', characterId: 0 };
  }
  const fired = triggers(p, def);
  if (fired) return fired;

  const homing = def.homingDuration > 0 && p.age > def.homingDelay && p.age <= def.homingDelay + def.homingDuration;
  const boomerang = def.behavior === 'boomerang';
  if (homing) home(p, def);
  else {
    p.vy += (PHYS.gravity * def.gravityScale) >> 8;
    if (def.windFactor !== 0) p.vx += windStep(wind, def.windFactor, p);
  }
  if (boomerang && p.age > 8) {
    // pulled back towards the thrower's current position
    const owner = chars.find((c) => c.id === p.owner && c.state !== 'dead');
    if (owner) {
      p.tx = owner.body.x >> 8;
      p.ty = (owner.body.y >> 8) - BOOMERANG_HOME_LIFT; // aim above the head so it does not dig in
    }
    const dx = p.tx * SUB + SUB / 2 - p.x, dy = p.ty * SUB + SUB / 2 - p.y;
    const len = ilength(dx, dy);
    if (len > 0) {
      p.vx += Math.trunc((dx * def.boomReturnAccel) / len);
      p.vy += Math.trunc((dy * def.boomReturnAccel) / len);
    }
  }
  const cap = PHYS.maxSpeed;
  p.vx = Math.max(-cap, Math.min(cap, p.vx));
  p.vy = Math.max(-cap, Math.min(cap, p.vy));

  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vy)) / SUB));
  for (let s = 0; s < steps; s++) {
    const nx = p.x + Math.trunc((p.vx * (s + 1)) / steps) - Math.trunc((p.vx * s) / steps);
    const ny = p.y + Math.trunc((p.vy * (s + 1)) / steps) - Math.trunc((p.vy * s) / steps);
    if (boomerang) {
      const out = boomerangContact(p, def, chars, nx, ny, tick, events);
      if (out) return out;
    } else {
      const who = def.impact ? hitCharacter(p, def, chars, nx, ny) : 0;
      if (who) return { kind: 'explode', x: pxOf(nx), y: pxOf(ny), hit: 'character', characterId: who };
      if (def.impact && objects.length && touchesObject(objects, nx, ny, def.radius)) return { kind: 'explode', x: pxOf(nx), y: pxOf(ny), hit: 'object', characterId: 0 };
    }
    if (overlapsDisc(t, pxOf(nx), pxOf(ny), def.radius)) {
      if (boomerang) {
        events.push({ type: 'ProjectileDropped', tick, id: p.id, x: pxOf(p.x), y: pxOf(p.y) });
        return { kind: 'gone', caught: false };
      }
      if (def.impact) return { kind: 'explode', x: pxOf(nx), y: pxOf(ny), hit: 'terrain', characterId: 0 };
      p.vx = 0; // remote-only projectiles stop dead against terrain
      p.vy = 0;
      break;
    }
    p.x = nx;
    p.y = ny;
  }
  const px = pxOf(p.x), py = pxOf(p.y);
  if (waterY > 0 && py >= waterY) return { kind: 'splash', x: px };
  const m = PHYS.lostMarginPx;
  if (px < -m || px > t.width + m || py > t.height + m) return { kind: 'lost' };
  return { kind: 'flying' };
}

/** Boomerang: strike each character once; the thrower catches it on the way back. */
function boomerangContact(p: Projectile, def: WeaponDef, chars: Character[], x: number, y: number, tick: number, events: SimEvent[]): ProjectileOutcome | null {
  for (const c of chars) {
    if (c.state === 'dead' || c.state === 'drowning') continue;
    if (!touchesHitbox(c, x, y, def.radius + (c.id === p.owner ? BOOMERANG_CATCH_REACH : 0))) continue;
    if (c.id === p.owner) {
      if (p.age > BOOMERANG_CATCH_AFTER) {
        events.push({ type: 'ProjectileCaught', tick, id: p.id, by: c.id });
        return { kind: 'gone', caught: true };
      }
      continue;
    }
    if (p.struck.includes(c.id)) continue;
    p.struck.push(c.id);
    if (def.boomDamage > 0) {
      c.pendingDamage += def.boomDamage;
      events.push({ type: 'CharacterHit', tick, id: c.id, damage: def.boomDamage, pending: c.pendingDamage });
    }
    const len = Math.max(1, ilength(p.vx, p.vy));
    throwCharacter(c, Math.trunc((p.vx * def.boomImpulse) / len), Math.trunc((p.vy * def.boomImpulse) / len) - (def.boomImpulse >> 2));
    events.push({ type: 'ProjectileStruck', tick, id: p.id, characterId: c.id });
  }
  return null;
}
