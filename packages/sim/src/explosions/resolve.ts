import type { SimEvent } from '../core/events.js';
import { killCharacter } from '../character/character.js';
import type { GameState } from '../state/gameState.js';
import { DEATH_BLAST, type Explosion } from './explosion.js';

/**
 * Settle detection and damage reveal (plan §3.2, §7.3; ADR-006).
 *
 * The world is *settled* when nothing is in motion: no projectiles, no queued explosions, no
 * airborne / sinking / crouching characters, no awake loose bodies. After SETTLE_TICKS settled
 * ticks in a row, all pending damage is revealed at once: hp drops, numbers pop, and anyone at
 * 0 hp dies with a small death blast (which can start the cycle again — chain reactions).
 */
export const SETTLE_TICKS = 10;

export function worldInMotion(s: GameState): boolean {
  if (s.projectiles.length > 0 || s.pendingExplosions.length > 0 || s.fires.length > 0) return true;
  for (const c of s.characters) {
    if (c.state === 'air' || c.state === 'drowning' || c.state === 'jumpPrep' || c.state === 'landing') return true;
  }
  for (const b of s.bodies) if (!b.sleeping || b.drownTicks > 0) return true;
  return false;
}

export function hasPendingDamage(s: GameState): boolean {
  return s.characters.some((c) => c.pendingDamage > 0 && c.state !== 'dead');
}

/** Apply every character's pending damage now (in id order). Deaths queue death blasts. */
export function revealDamage(s: GameState, events: SimEvent[]): void {
  let total = 0;
  for (const c of s.characters) {
    if (c.state === 'dead' || c.pendingDamage <= 0) continue;
    const amount = c.pendingDamage;
    total += amount;
    c.pendingDamage = 0;
    c.hp = Math.max(0, c.hp - amount);
    events.push({ type: 'CharacterDamaged', tick: s.tick, id: c.id, amount, hp: c.hp });
  }
  if (total > 0) events.push({ type: 'DamageRevealed', tick: s.tick, total });
  for (const c of s.characters) {
    if (c.state === 'dead' || c.state === 'drowning' || c.hp > 0) continue;
    killCharacter(c, s.tick, 'hp', events);
    const death: Explosion = {
      x: c.body.x >> 8,
      y: c.body.y >> 8,
      radius: DEATH_BLAST.radius,
      damage: DEATH_BLAST.damage,
      knockback: DEATH_BLAST.knockback,
      carve: true,
      cause: 'death',
      source: c.id,
    };
    s.pendingExplosions.push(death);
  }
}

/** Per-tick settle bookkeeping; reveals automatically when `autoReveal` is on. */
export function stepSettle(s: GameState, events: SimEvent[]): void {
  s.quietTicks = worldInMotion(s) ? 0 : Math.min(s.quietTicks + 1, 1 << 20);
  if (s.autoReveal && s.quietTicks >= SETTLE_TICKS && hasPendingDamage(s)) revealDamage(s, events);
}
