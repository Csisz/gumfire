import type { SimEvent } from '../core/events.js';
import { SUB } from '../core/units.js';
import { HALF_TURN, ilength } from '../core/trig.js';
import type { Character } from '../character/character.js';
import { throwCharacter } from '../explosions/explosion.js';
import type { WeaponDef } from './definition.js';
import { launchVector } from './projectile.js';

/**
 * Melee (plan §12: melee arcs). A swing strikes every living character whose disc comes within
 * `reach` of the attacker's centre inside the arc around the aim direction. Each target takes
 * the damage as pending damage (ADR-006) and is launched along the aim at `impulse`, nudged
 * slightly upward so a level swing lifts instead of scraping along the ground.
 */
/** Upward share of the launch, ×256 of the impulse (≈ 0.25; M8 playtest: hits should send targets flying). */
export const MELEE_UP_BIAS = 64;

export function meleeSwing(attacker: Character, weaponIndex: number, def: WeaponDef, chars: readonly Character[], tick: number, events: SimEvent[]): number[] {
  const dir = launchVector(attacker.aim, attacker.facing, SUB); // unit ×256, screen y down
  const hits: number[] = [];
  for (const c of chars) {
    if (c.id === attacker.id || c.state === 'dead' || c.state === 'drowning') continue;
    const dx = c.body.x - attacker.body.x;
    const dy = c.body.y - attacker.body.y;
    const dist = ilength(dx, dy);
    if (dist - c.body.radius * SUB > def.meleeReach * SUB) continue;
    // inside the cone: cos(angle between aim and target) ≥ cos(arc/2); very close targets count
    const dot = Math.trunc((dir.vx * dx + dir.vy * dy) / SUB);
    if (dist > c.body.radius * SUB && dot * SUB < def.meleeArcCos * dist) continue;
    hits.push(c.id);
    if (def.meleeDamage > 0) {
      c.pendingDamage += def.meleeDamage;
      events.push({ type: 'CharacterHit', tick, id: c.id, damage: def.meleeDamage, pending: c.pendingDamage });
    }
    const j = def.meleeImpulse;
    const up = Math.trunc((j * MELEE_UP_BIAS) / SUB);
    if (j > 0) throwCharacter(c, Math.trunc((dir.vx * j) / SUB), Math.trunc((dir.vy * j) / SUB) - up);
  }
  const angle = attacker.facing >= 0 ? attacker.aim : HALF_TURN - attacker.aim;
  events.push({ type: 'MeleeSwing', tick, id: attacker.id, weapon: weaponIndex, x: attacker.body.x >> 8, y: attacker.body.y >> 8, dir: angle, hits });
  return hits;
}
