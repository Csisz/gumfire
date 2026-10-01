import type { SimEvent } from '../core/events.js';
import { SUB } from '../core/units.js';
import { QUARTER_TURN, normalizeAngle, vecFromAngle } from '../core/trig.js';
import { nextRange, type RngState } from '../core/rng.js';
import type { Character } from '../character/character.js';
import { PHYS } from '../physics/constants.js';
import { isSolid, type TerrainState } from '../terrain/terrain.js';

/**
 * Fire (plan §14, payload `fire`): burning droplets thrown out by a payload. They fall, stick
 * where they land, slowly eat the ground under them (so they sink into it) and hurt anyone
 * standing in them. Damage is per character per burn pulse — standing in ten flames hurts as
 * much as standing in one — so fire zones deny ground without stacking into one-shots.
 * Fire keeps the world "in motion" until it is out, so turns wait for it (ADR-006).
 */
export interface Fire {
  id: number;
  x: number; // subpixels
  y: number;
  vx: number;
  vy: number;
  /** Ticks left. */
  life: number;
  landed: boolean;
  /** Damage per burn pulse to characters touching it. */
  damage: number;
}

export const FIRE = {
  /** A burn pulse every N ticks (damage + a pinch of terrain). */
  pulseTicks: 10,
  /** Touch distance from a flame to a character's edge, px. */
  reach: 5,
  /** Radius of ground burnt away per pulse, px. */
  burnRadius: 2,
  /** Flames fall at this share of normal gravity (×256). */
  gravityScale: 160,
  max: 256,
} as const;

/** Throw `count` flames in an upward fan from (x, y) px. */
export function spawnFires(
  fires: Fire[],
  nextId: number,
  x: number,
  y: number,
  count: number,
  speed: number,
  life: number,
  damage: number,
  rng: RngState,
): number {
  let id = nextId;
  const spread = QUARTER_TURN + QUARTER_TURN / 8; // ~100° fan around straight up
  for (let i = 0; i < count && fires.length < FIRE.max; i++) {
    const t = count === 1 ? 0 : Math.trunc((spread * i) / (count - 1)) - (spread >> 1);
    const a = normalizeAngle(QUARTER_TURN + t + nextRange(rng, -40, 40));
    const v = vecFromAngle(a, Math.trunc((speed * nextRange(rng, 70, 110)) / 100));
    fires.push({ id: id++, x: x * SUB + SUB / 2, y: y * SUB + SUB / 2, vx: v.x, vy: 0 - v.y, life: life + nextRange(rng, -10, 10), landed: false, damage });
  }
  return id;
}

/** Advance all flames one tick. Returns the rects of ground they burnt (for terrain edits). */
export function stepFires(
  fires: Fire[],
  t: TerrainState,
  chars: Character[],
  waterY: number,
  tick: number,
  events: SimEvent[],
  burn: (x: number, y: number, r: number) => void,
): Fire[] {
  const keep: Fire[] = [];
  const pulse = tick % FIRE.pulseTicks === 0;
  for (const f of fires) {
    if (--f.life <= 0) continue;
    if (f.landed && !isSolid(t, f.x >> 8, (f.y >> 8) + 1)) f.landed = false; // ground burnt or blasted away
    if (!f.landed) {
      f.vy = Math.min(PHYS.terminalVy, f.vy + ((PHYS.gravity * FIRE.gravityScale) >> 8));
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(f.vx), Math.abs(f.vy)) / SUB));
      for (let s = 0; s < steps; s++) {
        const nx = f.x + Math.trunc((f.vx * (s + 1)) / steps) - Math.trunc((f.vx * s) / steps);
        const ny = f.y + Math.trunc((f.vy * (s + 1)) / steps) - Math.trunc((f.vy * s) / steps);
        if (isSolid(t, nx >> 8, ny >> 8)) {
          f.landed = true;
          f.vx = 0;
          f.vy = 0;
          break;
        }
        f.x = nx;
        f.y = ny;
      }
      if (waterY > 0 && f.y >> 8 >= waterY) continue; // fizzles out
      if (f.x >> 8 < -PHYS.lostMarginPx || f.x >> 8 > t.width + PHYS.lostMarginPx || f.y >> 8 > t.height) continue;
    }
    if (pulse && f.landed) burn(f.x >> 8, (f.y >> 8) + 1, FIRE.burnRadius);
    keep.push(f);
  }
  if (pulse && keep.length > 0) {
    // one damage pulse per character: the strongest flame touching it
    for (const c of chars) {
      if (c.state === 'dead' || c.state === 'drowning') continue;
      let dmg = 0;
      const r = c.body.radius + FIRE.reach;
      for (const f of keep) {
        const dx = (f.x >> 8) - (c.body.x >> 8), dy = (f.y >> 8) - (c.body.y >> 8);
        if (dx * dx + dy * dy <= r * r && f.damage > dmg) dmg = f.damage;
      }
      if (dmg > 0) {
        c.pendingDamage += dmg;
        events.push({ type: 'CharacterHit', tick, id: c.id, damage: dmg, pending: c.pendingDamage });
      }
    }
  }
  return keep;
}
