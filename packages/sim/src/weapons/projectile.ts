import { SUB } from '../core/units.js';
import { vecFromAngle, normalizeAngle, HALF_TURN } from '../core/trig.js';
import { windStep } from '../environment/wind.js';
import { overlapsDisc } from '../physics/collision.js';
import { PHYS } from '../physics/constants.js';
import type { Character } from '../character/character.js';
import type { TerrainState } from '../terrain/terrain.js';
import { launchSpeed, type WeaponDef } from './definition.js';

/**
 * Projectiles (plan §12, ProjectileSystem). Ballistic flight: gravity × gravityScale plus
 * wind × windFactor, moved in exact ≤ 1 px substeps so nothing tunnels through thin terrain
 * or a character. The impact trigger fires on the first contact with terrain or a character
 * (the shooter is ignored for `ignoreOwnerTicks` after launch).
 */
export interface Projectile {
  id: number;
  /** Index into `state.weapons`. */
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
}

export type ProjectileOutcome =
  | { kind: 'flying' }
  | { kind: 'explode'; x: number; y: number; hit: 'terrain' | 'character' | 'timeout'; characterId: number }
  | { kind: 'splash'; x: number }
  | { kind: 'lost' };

/**
 * Launch velocity from a character's aim and facing (plan §9.2). `aim` is relative to
 * horizontal-forward, positive = up; screen y points down.
 */
export function launchVector(aim: number, facing: number, speed: number): { vx: number; vy: number } {
  const world = normalizeAngle(facing >= 0 ? aim : HALF_TURN - aim);
  const v = vecFromAngle(world, speed);
  return { vx: v.x, vy: 0 - v.y }; // screen y is down; `0 -` avoids a −0
}

/** Create a projectile at the shooter's muzzle. */
export function makeProjectile(id: number, weaponIndex: number, def: WeaponDef, shooter: Character, power: number): Projectile {
  const speed = launchSpeed(def, power);
  const v = launchVector(shooter.aim, shooter.facing, speed);
  const dir = launchVector(shooter.aim, shooter.facing, def.muzzleOffset * SUB);
  return {
    id,
    weapon: weaponIndex,
    owner: shooter.id,
    x: shooter.body.x + dir.vx,
    y: shooter.body.y + dir.vy,
    vx: v.vx,
    vy: v.vy,
    age: 0,
    windRem: 0,
  };
}

const pxOf = (s: number) => s >> 8;

function hitCharacter(p: Projectile, def: WeaponDef, chars: readonly Character[], x: number, y: number): number {
  for (const c of chars) {
    if (c.state === 'dead' || c.state === 'drowning') continue;
    if (c.id === p.owner && p.age <= def.ignoreOwnerTicks) continue;
    const dx = pxOf(x) - pxOf(c.body.x);
    const dy = pxOf(y) - pxOf(c.body.y);
    const rr = def.radius + c.body.radius;
    if (dx * dx + dy * dy <= rr * rr) return c.id;
  }
  return 0;
}

/** Advance one projectile one tick. */
export function stepProjectile(
  p: Projectile,
  def: WeaponDef,
  t: TerrainState,
  chars: readonly Character[],
  wind: number,
  waterY: number,
): ProjectileOutcome {
  p.age++;
  // A projectile that starts inside terrain (fired point-blank into a wall) goes off at once.
  if (p.age === 1 && overlapsDisc(t, pxOf(p.x), pxOf(p.y), def.radius)) {
    return { kind: 'explode', x: pxOf(p.x), y: pxOf(p.y), hit: 'terrain', characterId: 0 };
  }
  p.vy += (PHYS.gravity * def.gravityScale) >> 8;
  if (def.windFactor !== 0) p.vx += windStep(wind, def.windFactor, p);
  const cap = PHYS.maxSpeed;
  p.vx = Math.max(-cap, Math.min(cap, p.vx));
  p.vy = Math.max(-cap, Math.min(cap, p.vy));

  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vy)) / SUB));
  for (let s = 0; s < steps; s++) {
    const nx = p.x + Math.trunc((p.vx * (s + 1)) / steps) - Math.trunc((p.vx * s) / steps);
    const ny = p.y + Math.trunc((p.vy * (s + 1)) / steps) - Math.trunc((p.vy * s) / steps);
    const who = hitCharacter(p, def, chars, nx, ny);
    if (who) return { kind: 'explode', x: pxOf(nx), y: pxOf(ny), hit: 'character', characterId: who };
    if (overlapsDisc(t, pxOf(nx), pxOf(ny), def.radius)) return { kind: 'explode', x: pxOf(nx), y: pxOf(ny), hit: 'terrain', characterId: 0 };
    p.x = nx;
    p.y = ny;
  }
  const px = pxOf(p.x), py = pxOf(p.y);
  if (waterY > 0 && py >= waterY) return { kind: 'splash', x: px };
  const m = PHYS.lostMarginPx;
  if (px < -m || px > t.width + m || py > t.height + m) return { kind: 'lost' };
  if (p.age >= def.maxLifeTicks) return { kind: 'explode', x: px, y: py, hit: 'timeout', characterId: 0 };
  return { kind: 'flying' };
}

