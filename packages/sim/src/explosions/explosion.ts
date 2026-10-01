import type { SimEvent } from '../core/events.js';
import { SUB } from '../core/units.js';
import { ilength } from '../core/trig.js';
import { hitboxNearest, type Character } from '../character/character.js';
import type { Body } from '../physics/body.js';

/**
 * Explosions (plan §9.4). An explosion at c with radius R, max damage D and knockback K
 * affects every character (and physics body) whose disc comes within R of c:
 *
 *   d   = max(0, |p − c| − r)        distance from the blast to the disc's edge
 *   φ   = max(0, 1 − d / R)           falloff, ×256 in integers
 *   dmg = round(D · φ)                (only if φ > 0)
 *   J   = K · 0.16 · D · φ  px/tick   along (p − c) biased upward by 0.35 r
 *
 * Damage is not applied to HP here: it accumulates as `pendingDamage` and is revealed once the
 * world has settled (ADR-006). Knocked characters become airborne and immune to fall damage
 * until they land (the blast's damage already accounts for the throw — classic behaviour).
 */
export interface Explosion {
  x: number; // px
  y: number;
  radius: number; // px
  damage: number;
  /** ×256 */
  knockback: number;
  carve: boolean;
  cause: 'weapon' | 'death';
  /** Projectile id (weapon) or character id (death). */
  source: number;
}

/** 0.16 × 256 ≈ 41: impulse per damage point at knockback 1 and full falloff, subpixels/tick. */
export const KNOCKBACK_PER_DAMAGE = 41;
/** Upward bias of the push direction, as a fraction of the target radius (×100). */
export const UP_BIAS_PERCENT = 35;
/** Death blast of a character reaching 0 HP (plan §3.2, §19). */
export const DEATH_BLAST = { radius: 20, damage: 10, knockback: 256 } as const;

export interface BlastEffect {
  /** Falloff ×256 (0 = unaffected). */
  phi: number;
  damage: number;
  /** Impulse in subpixels/tick. */
  jx: number;
  jy: number;
}

/**
 * Effect of an explosion on a disc centred at (bx, by) subpixels with radius r px.
 * Pure function — the core of the damage model, tested in isolation.
 */
export function blastEffect(e: Explosion, bx: number, by: number, r: number): BlastEffect {
  const dxs = bx - e.x * SUB - SUB / 2;
  const dys = by - e.y * SUB - SUB / 2;
  const dist = ilength(dxs, dys);
  const edge = Math.max(0, dist - r * SUB);
  if (e.radius <= 0) return { phi: 0, damage: 0, jx: 0, jy: 0 };
  const phi = Math.max(0, SUB - Math.trunc(edge / e.radius));
  if (phi === 0) return { phi: 0, damage: 0, jx: 0, jy: 0 };
  const damage = (e.damage * phi + SUB / 2) >> 8;
  const j = Math.trunc((e.knockback * KNOCKBACK_PER_DAMAGE * e.damage * phi) / (SUB * SUB));
  // direction: away from the blast, nudged upward so ground-level blasts lift rather than dig
  const ux = dxs;
  const uy = dys - Math.trunc((r * SUB * UP_BIAS_PERCENT) / 100);
  const len = ilength(ux, uy);
  if (len === 0) return { phi, damage, jx: 0, jy: -j };
  return { phi, damage, jx: Math.trunc((j * ux) / len), jy: Math.trunc((j * uy) / len) };
}

/** Apply an explosion to characters: pending damage + knockback. Returns affected ids. */
export function blastCharacters(e: Explosion, chars: Character[], tick: number, events: SimEvent[]): void {
  for (const c of chars) {
    if (c.state === 'dead' || c.state === 'drowning') continue;
    // measured to the nearest point of the hit capsule, so a blast at head height counts
    const n = hitboxNearest(c, e.x * SUB + SUB / 2, e.y * SUB + SUB / 2);
    const fx = blastEffect(e, n.x, n.y, c.body.radius);
    if (fx.phi === 0) continue;
    if (fx.damage > 0) {
      c.pendingDamage += fx.damage;
      events.push({ type: 'CharacterHit', tick, id: c.id, damage: fx.damage, pending: c.pendingDamage });
    }
    if (fx.jx !== 0 || fx.jy !== 0) throwCharacter(c, fx.jx, fx.jy);
  }
}

/**
 * Add an impulse (subpixels/tick) to a character: it becomes airborne, loses any charge, and
 * its landing deals no fall damage (the hit that threw it already counted — classic rule).
 */
export function throwCharacter(c: Character, jx: number, jy: number): void {
  c.body.vx += jx;
  c.body.vy += jy;
  c.body.sleeping = false;
  c.body.stillTicks = 0;
  c.fallImmune = true;
  c.power = 0;
  c.jumpKind = 0;
  c.state = 'air';
  c.stateTicks = 0;
}

/** Apply an explosion to loose physics bodies (toys now, barrels/mines/crates later). */
export function blastBodies(e: Explosion, bodies: Body[]): void {
  for (const b of bodies) {
    if (b.drownTicks > 0) continue;
    const fx = blastEffect(e, b.x, b.y, b.radius);
    if (fx.phi === 0) continue;
    b.vx += fx.jx;
    b.vy += fx.jy;
    b.sleeping = false;
    b.stillTicks = 0;
  }
}
