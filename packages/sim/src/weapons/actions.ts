import type { SimEvent } from '../core/events.js';
import { SUB } from '../core/units.js';
import { QUARTER_TURN, isqrt, normalizeAngle, vecFromAngle } from '../core/trig.js';
import { PHYS } from '../physics/constants.js';
import { nextRange } from '../core/rng.js';
import { touchesHitbox, type Character } from '../character/character.js';
import { spawnFires } from '../environment/fire.js';
import { isSolid } from '../terrain/terrain.js';
import type { GameState } from '../state/gameState.js';
import type { WeaponDef } from './definition.js';
import { launchVector, spawnProjectile } from './projectile.js';

/**
 * Weapon deliveries that are not "throw a projectile" (plan §12): hitscan rays and strikes,
 * plus the payload spawns (cluster bomblets, fire) that happen where a projectile goes off.
 */
export const MAX_PROJECTILES = 64;

/**
 * Hitscan: a ray from the muzzle along the aim, 1 px at a time, stopped by the first character
 * (other than the shooter) or solid pixel; a small blast goes off there. A miss flies out of range.
 */
export function fireHitscan(s: GameState, c: Character, weaponIndex: number, def: WeaponDef, events: SimEvent[]): void {
  const t = s.terrain!;
  const dir = launchVector(c.aim, c.facing, SUB); // ×256 unit vector, screen y down
  let x = c.body.x + Math.trunc((dir.vx * def.muzzleOffset * SUB) / SUB);
  let y = c.body.y + Math.trunc((dir.vy * def.muzzleOffset * SUB) / SUB);
  const x0 = x >> 8, y0 = y >> 8;
  let hit: 'terrain' | 'character' | 'none' = 'none';
  for (let i = 0; i < def.hitscanRange; i++) {
    const px = x >> 8, py = y >> 8;
    for (const o of s.characters) {
      if (o.id === c.id || o.state === 'dead' || o.state === 'drowning') continue;
      if (touchesHitbox(o, x, y, 0)) {
        hit = 'character';
        break;
      }
    }
    if (hit === 'none' && isSolid(t, px, py)) hit = 'terrain';
    if (hit !== 'none') break;
    if (px < -200 || px > t.width + 200 || py < -2000 || py > t.height + 200) break;
    x += dir.vx;
    y += dir.vy;
  }
  const x1 = x >> 8, y1 = y >> 8;
  events.push({ type: 'HitscanFired', tick: s.tick, id: c.id, weapon: weaponIndex, x0, y0, x1, y1, hit });
  if (hit !== 'none') {
    s.pendingExplosions.push({ x: x1, y: y1, radius: def.explosionRadius, damage: def.damage, knockback: def.knockback, carve: def.carve, cause: 'weapon', source: 0 });
  }
}

/**
 * Strike: `count` drops fall from above the map onto the target, spaced across it and drifting
 * in the caller's facing; they start up-wind of the target so they arrive over it.
 */
export function callStrike(s: GameState, c: Character, weaponIndex: number, def: WeaponDef, events: SimEvent[]): void {
  const child = s.weapons[def.strikeChild];
  if (!child || !c.hasTarget) return;
  const startY = -60;
  // time to fall from startY to the target under gravity: d = v t + g t² / 2
  const g = (PHYS.gravity * child.gravityScale) >> 8, v = def.strikeVy, d = (c.targetY - startY) * SUB;
  const fallTicks = g > 0 ? Math.trunc((isqrt(v * v + 2 * g * d) - v) / g) : v > 0 ? Math.trunc(d / v) : 0;
  const drift = Math.trunc((c.facing * def.strikeVx * fallTicks) / SUB); // start up-wind so they arrive over the target
  for (let i = 0; i < def.strikeCount && s.projectiles.length < MAX_PROJECTILES; i++) {
    const off = Math.trunc(((2 * i - (def.strikeCount - 1)) * def.strikeSpacing) / 2);
    const id = s.nextProjectileId++;
    const x = (c.targetX + off - drift) * SUB + SUB / 2;
    s.projectiles.push(spawnProjectile(id, def.strikeChild, child, c.id, x, startY * SUB, c.facing * def.strikeVx, def.strikeVy));
    events.push({ type: 'ProjectileSpawned', tick: s.tick, id, weapon: def.strikeChild, parent: 0 });
  }
  events.push({ type: 'StrikeCalled', tick: s.tick, id: c.id, weapon: weaponIndex, x: c.targetX, y: c.targetY, count: def.strikeCount });
}

/** Payload spawns where a projectile of `def` went off at (x, y) px: bomblets and flames. */
export function spawnPayload(s: GameState, def: WeaponDef, owner: number, parentId: number, x: number, y: number, events: SimEvent[]): void {
  if (def.clusterCount > 0) {
    const child = s.weapons[def.clusterChild];
    if (child) {
      for (let i = 0; i < def.clusterCount && s.projectiles.length < MAX_PROJECTILES; i++) {
        const t = def.clusterCount === 1 ? 0 : Math.trunc((def.clusterSpread * i) / (def.clusterCount - 1)) - (def.clusterSpread >> 1);
        const a = normalizeAngle(QUARTER_TURN + t + nextRange(s.rng.misc, -24, 24));
        const v = vecFromAngle(a, Math.trunc((def.clusterSpeed * nextRange(s.rng.misc, 85, 115)) / 100));
        const id = s.nextProjectileId++;
        s.projectiles.push(spawnProjectile(id, def.clusterChild, child, owner, x * SUB + SUB / 2, (y - 3) * SUB + SUB / 2, v.x, 0 - v.y));
        events.push({ type: 'ProjectileSpawned', tick: s.tick, id, weapon: def.clusterChild, parent: parentId });
      }
    }
  }
  if (def.fireCount > 0) {
    s.nextFireId = spawnFires(s.fires, s.nextFireId, x, y - 3, def.fireCount, def.fireSpeed, def.fireLife, def.fireDamage, s.rng.misc);
    events.push({ type: 'FiresSpawned', tick: s.tick, x, y, count: def.fireCount });
  }
}
