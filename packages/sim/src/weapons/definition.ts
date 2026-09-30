import { SUB, toSub } from '../core/units.js';

/**
 * Data-driven weapons (plan §12, ADR-004).
 *
 * Content is authored as JSON in human units (px, px/tick, ticks, ratios). At match creation
 * the sim *compiles* each definition to integer sim units (subpixels, ×256 ratios) and keeps the
 * compiled set in the GameState, so a replay carries its own weapon data and the state hash
 * covers it. M5 implements the ballistic subset; later milestones add more blocks.
 */

// ---------------------------------------------------------------- authored (JSON) shape
export interface WeaponJson {
  id: string;
  name: string;
  category: 'ballistic';
  description?: string;
  input: { mode: 'aimCharge' };
  launch: {
    /** Launch speed at zero charge, px/tick. */
    speedMin: number;
    /** Launch speed at full charge, px/tick. */
    speedMax: number;
    /** Ticks of holding Fire to reach full power (then it fires by itself). */
    chargeTicks: number;
    /** Spawn distance from the shooter's centre along the aim, px. */
    muzzleOffset: number;
  };
  projectile: {
    radius: number;
    /** 1 = normal gravity. */
    gravityScale: number;
    /** 0 = ignores wind, 1 = full wind. */
    windFactor: number;
    triggers: Array<{ kind: 'impact'; ignoreOwnerTicks?: number }>;
    payload: { explosion: { radius: number; damage: number; knockback: number; carve: boolean } };
    /** Safety: force-trigger after this many ticks in flight. */
    maxLifeTicks: number;
  };
  ammo: { default: number | 'inf' };
  turn: { endsTurn: boolean; shotsPerTurn: number };
}

// ---------------------------------------------------------------- compiled (sim) shape
export interface WeaponDef {
  id: string;
  name: string;
  speedMin: number; // subpixels/tick
  speedMax: number;
  chargeTicks: number;
  muzzleOffset: number; // px
  radius: number; // px
  gravityScale: number; // ×256
  windFactor: number; // ×256
  impact: boolean;
  ignoreOwnerTicks: number;
  explosionRadius: number; // px
  damage: number;
  knockback: number; // ×256
  carve: boolean;
  maxLifeTicks: number;
  ammo: number; // −1 = infinite
  endsTurn: boolean;
  shotsPerTurn: number;
}

export class WeaponDefinitionError extends Error {}

function num(path: string, v: unknown, lo: number, hi: number, integer = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi || (integer && !Number.isInteger(v))) {
    throw new WeaponDefinitionError(`${path}: expected ${integer ? 'an integer' : 'a number'} in [${lo}, ${hi}], got ${JSON.stringify(v)}`);
  }
  return v;
}

const ratio = (v: number) => Math.round(v * SUB);

/** Validate and convert one authored weapon to sim units. Throws WeaponDefinitionError. */
export function compileWeapon(w: WeaponJson): WeaponDef {
  const at = (p: string) => `${w?.id ?? '?'}.${p}`;
  if (!w || typeof w.id !== 'string' || !/^[a-z][a-z0-9_]{1,40}$/.test(w.id)) throw new WeaponDefinitionError(`bad weapon id ${JSON.stringify(w?.id)}`);
  if (typeof w.name !== 'string' || w.name.length < 1 || w.name.length > 40) throw new WeaponDefinitionError(at('name'));
  if (w.category !== 'ballistic') throw new WeaponDefinitionError(`${at('category')}: only 'ballistic' is supported so far`);
  if (w.input?.mode !== 'aimCharge') throw new WeaponDefinitionError(`${at('input.mode')}: only 'aimCharge' is supported so far`);
  const L = w.launch, P = w.projectile, E = P?.payload?.explosion;
  if (!L || !P || !E) throw new WeaponDefinitionError(`${w.id}: launch, projectile and payload.explosion are required`);
  const speedMin = num(at('launch.speedMin'), L.speedMin, 0, 32);
  const speedMax = num(at('launch.speedMax'), L.speedMax, speedMin, 32);
  const impact = P.triggers?.find((t) => t.kind === 'impact');
  if (!impact) throw new WeaponDefinitionError(`${at('projectile.triggers')}: an 'impact' trigger is required so far`);
  const ammo = w.ammo?.default === 'inf' ? -1 : num(at('ammo.default'), w.ammo?.default, 0, 99, true);
  return {
    id: w.id,
    name: w.name,
    speedMin: toSub(speedMin),
    speedMax: toSub(speedMax),
    chargeTicks: num(at('launch.chargeTicks'), L.chargeTicks, 1, 500, true),
    muzzleOffset: num(at('launch.muzzleOffset'), L.muzzleOffset, 0, 64, true),
    radius: num(at('projectile.radius'), P.radius, 1, 16, true),
    gravityScale: ratio(num(at('projectile.gravityScale'), P.gravityScale, 0, 4)),
    windFactor: ratio(num(at('projectile.windFactor'), P.windFactor, 0, 4)),
    impact: true,
    ignoreOwnerTicks: num(at('triggers.impact.ignoreOwnerTicks'), impact.ignoreOwnerTicks ?? 0, 0, 100, true),
    explosionRadius: num(at('payload.explosion.radius'), E.radius, 0, 200, true),
    damage: num(at('payload.explosion.damage'), E.damage, 0, 200, true),
    knockback: ratio(num(at('payload.explosion.knockback'), E.knockback, 0, 4)),
    carve: E.carve === true,
    maxLifeTicks: num(at('projectile.maxLifeTicks'), P.maxLifeTicks, 1, 6000, true),
    ammo,
    endsTurn: w.turn?.endsTurn !== false,
    shotsPerTurn: num(at('turn.shotsPerTurn'), w.turn?.shotsPerTurn ?? 1, 1, 10, true),
  };
}

/** Compile a whole set; ids must be unique. */
export function compileWeapons(list: readonly WeaponJson[]): WeaponDef[] {
  const out = list.map(compileWeapon);
  const seen = new Set<string>();
  for (const d of out) {
    if (seen.has(d.id)) throw new WeaponDefinitionError(`duplicate weapon id ${d.id}`);
    seen.add(d.id);
  }
  return out;
}

/** Launch speed for a charge of `power` ticks (0..chargeTicks), subpixels/tick. */
export function launchSpeed(d: WeaponDef, power: number): number {
  const p = Math.max(0, Math.min(d.chargeTicks, power));
  return d.speedMin + Math.trunc(((d.speedMax - d.speedMin) * p) / d.chargeTicks);
}
