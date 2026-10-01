/**
 * Commands: tick-stamped structured input that does not fit in the 16-bit button frame —
 * e.g. a target point for placed weapons (M9) or sandbox debug edits (M2). They travel with
 * the input stream and are stored in replays, so everything they cause is reproducible.
 * All fields are integers (whole pixels).
 */
export type SimCommand =
  | { type: 'debugCarve'; x: number; y: number; r: number }
  | { type: 'debugTunnel'; x0: number; y0: number; x1: number; y1: number; r: number }
  | { type: 'debugGirder'; x: number; y: number; w: number; h: number }
  /** Spawn a test body at pixel (x, y) with velocity (vx, vy) in subpixels/tick. */
  | { type: 'debugSpawn'; x: number; y: number; vx: number; vy: number; r: number }
  /** Place a character (team 0..5) at pixel (x, y); it falls and lands. */
  | { type: 'debugSpawnCharacter'; x: number; y: number; team: number }
  /** Give input control to character `id` (0 = nobody). The turn system replaces this at M7. */
  | { type: 'debugSelect'; id: number }
  /** The active character selects weapon `index` (a normal player action, not a debug tool). */
  | { type: 'selectWeapon'; index: number }
  /** Set the wind directly (−100..100) — tests and sandbox. */
  | { type: 'debugSetWind'; wind: number }
  /** Re-roll the wind from the seeded wind stream, as a new turn will (M7). */
  | { type: 'debugRollWind' }
  /** Target point for targeted weapons (strikes, homing), whole px. */
  | { type: 'setTarget'; x: number; y: number }
  /** Free character select (ruleset `characterSelect: free`): the active team's next character. */
  | { type: 'nextCharacter' }
  /** Detonate an explosion at pixel (x, y): radius px, damage, knockback ×256 (sandbox tool, tests). */
  | { type: 'debugExplode'; x: number; y: number; r: number; damage: number; knockback: number };

/** A command applied at the start of simulation tick `tick` (1-based, the tick being computed). */
export interface TimedCommand {
  tick: number;
  cmd: SimCommand;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
const COORD = 1 << 16;

/** Validate untrusted command data (network, replay files). Returns null if invalid. */
export function sanitizeCommand(c: unknown): SimCommand | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const coords = (...keys: string[]) => keys.every((k) => isInt(o[k]) && inRange(o[k] as number, -COORD, COORD));
  switch (o.type) {
    case 'debugCarve':
      if (!coords('x', 'y') || !isInt(o.r) || !inRange(o.r, 1, 200)) return null;
      return { type: 'debugCarve', x: o.x as number, y: o.y as number, r: o.r };
    case 'debugTunnel':
      if (!coords('x0', 'y0', 'x1', 'y1') || !isInt(o.r) || !inRange(o.r, 1, 60)) return null;
      if (Math.abs((o.x1 as number) - (o.x0 as number)) > 2048 || Math.abs((o.y1 as number) - (o.y0 as number)) > 2048) return null;
      return { type: 'debugTunnel', x0: o.x0 as number, y0: o.y0 as number, x1: o.x1 as number, y1: o.y1 as number, r: o.r };
    case 'debugGirder':
      if (!coords('x', 'y') || !isInt(o.w) || !isInt(o.h) || !inRange(o.w, 1, 512) || !inRange(o.h, 1, 64)) return null;
      return { type: 'debugGirder', x: o.x as number, y: o.y as number, w: o.w, h: o.h };
    case 'debugSpawn': {
      const v = (k: string) => isInt(o[k]) && inRange(o[k] as number, -8192, 8192);
      if (!coords('x', 'y') || !v('vx') || !v('vy') || !isInt(o.r) || !inRange(o.r, 3, 24)) return null;
      return { type: 'debugSpawn', x: o.x as number, y: o.y as number, vx: o.vx as number, vy: o.vy as number, r: o.r };
    }
    case 'debugSpawnCharacter':
      if (!coords('x', 'y') || !isInt(o.team) || !inRange(o.team, 0, 5)) return null;
      return { type: 'debugSpawnCharacter', x: o.x as number, y: o.y as number, team: o.team };
    case 'debugSelect':
      if (!isInt(o.id) || !inRange(o.id, 0, 1 << 20)) return null;
      return { type: 'debugSelect', id: o.id };
    case 'selectWeapon':
      if (!isInt(o.index) || !inRange(o.index, 0, 63)) return null;
      return { type: 'selectWeapon', index: o.index };
    case 'debugSetWind':
      if (!isInt(o.wind) || !inRange(o.wind, -100, 100)) return null;
      return { type: 'debugSetWind', wind: o.wind };
    case 'debugRollWind':
      return { type: 'debugRollWind' };
    case 'setTarget':
      if (!coords('x', 'y')) return null;
      return { type: 'setTarget', x: o.x as number, y: o.y as number };
    case 'nextCharacter':
      return { type: 'nextCharacter' };
    case 'debugExplode':
      if (!coords('x', 'y') || !isInt(o.r) || !inRange(o.r, 1, 200)) return null;
      if (!isInt(o.damage) || !inRange(o.damage, 0, 200) || !isInt(o.knockback) || !inRange(o.knockback, 0, 2048)) return null;
      return { type: 'debugExplode', x: o.x as number, y: o.y as number, r: o.r, damage: o.damage, knockback: o.knockback };
    default:
      return null;
  }
}
