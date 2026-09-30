import { SUB, TICKS_PER_SECOND, toSub } from '../core/units.js';
import { degToAngle, vecFromAngle } from '../core/trig.js';

/**
 * Data-driven weapons (plan §12, ADR-004).
 *
 * Content is authored as JSON in human units (px, px/tick, ticks, ratios). At match creation
 * the sim *compiles* each definition to integer sim units (subpixels, ×256 ratios) and keeps the
 * compiled set in the GameState, so a replay carries its own weapon data and the state hash
 * covers it. M5 implemented the ballistic subset; M8 adds fused bouncing projectiles and melee;
 * later milestones add more blocks.
 */

// ---------------------------------------------------------------- authored (JSON) shape
export type WeaponCategory = 'ballistic' | 'melee';

export interface ProjectileJson {
  radius: number;
  /** 1 = normal gravity. */
  gravityScale: number;
  /** 0 = ignores wind, 1 = full wind. */
  windFactor: number;
  /**
   * `impact`: goes off on first contact. `fuse`: bounces around until the fuse burns down
   * (`playerSet`: the player picks 1–5 s with the fuse keys).
   */
  triggers: Array<{ kind: 'impact'; ignoreOwnerTicks?: number } | { kind: 'fuse'; defaultSeconds: number; playerSet?: boolean }>;
  /** Fused projectiles are physics bodies; restitution for the low / high bounce setting. */
  bounce?: { low: number; high: number; friction: number };
  payload: { explosion: { radius: number; damage: number; knockback: number; carve: boolean } };
  /** Safety: force-trigger after this many ticks in flight. */
  maxLifeTicks: number;
}

export interface MeleeJson {
  /** Reach from the attacker's centre to the target's edge, px. */
  reach: number;
  /** Full width of the swing arc around the aim direction, degrees. */
  arcDegrees: number;
  damage: number;
  /** Launch speed given to the target along the aim, px/tick. */
  impulse: number;
}

export interface WeaponJson {
  id: string;
  name: string;
  category: WeaponCategory;
  description?: string;
  /** `aimCharge`: hold Fire to charge, release to fire. `instant`: fires on the press. */
  input: { mode: 'aimCharge' | 'instant' };
  launch?: {
    /** Launch speed at zero charge, px/tick. */
    speedMin: number;
    /** Launch speed at full charge, px/tick. */
    speedMax: number;
    /** Ticks of holding Fire to reach full power (then it fires by itself). */
    chargeTicks: number;
    /** Spawn distance from the shooter's centre along the aim, px. */
    muzzleOffset: number;
  };
  projectile?: ProjectileJson;
  melee?: MeleeJson;
  ammo: { default: number | 'inf' };
  turn: { endsTurn: boolean; shotsPerTurn: number };
}

// ---------------------------------------------------------------- compiled (sim) shape
export interface WeaponDef {
  id: string;
  name: string;
  category: WeaponCategory;
  /** Fires on the Fire press, no charge. */
  instant: boolean;
  speedMin: number; // subpixels/tick
  speedMax: number;
  chargeTicks: number;
  muzzleOffset: number; // px
  radius: number; // px
  gravityScale: number; // ×256
  windFactor: number; // ×256
  impact: boolean;
  ignoreOwnerTicks: number;
  /** Fuse length in ticks when the player does not set it; 0 = no fuse. */
  fuseTicks: number;
  playerFuse: boolean;
  /** Bounce restitution ×256 (low / high setting) and friction ×256; 0 = not a bouncing body. */
  bounceLow: number;
  bounceHigh: number;
  bounceFriction: number;
  explosionRadius: number; // px
  damage: number;
  knockback: number; // ×256
  carve: boolean;
  maxLifeTicks: number;
  meleeReach: number; // px
  /** cos(arc / 2) ×256: a target must lie within this cone around the aim. */
  meleeArcCos: number;
  meleeDamage: number;
  meleeImpulse: number; // subpixels/tick
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

/** cos of whole degrees 0..180, ×256, from the integer trig table (no float trig in the sim). */
function cosDeg256(deg: number): number {
  return Math.trunc(vecFromAngle(degToAngle(deg), SUB).x);
}

/** Validate and convert one authored weapon to sim units. Throws WeaponDefinitionError. */
export function compileWeapon(w: WeaponJson): WeaponDef {
  const at = (p: string) => `${w?.id ?? '?'}.${p}`;
  if (!w || typeof w.id !== 'string' || !/^[a-z][a-z0-9_]{1,40}$/.test(w.id)) throw new WeaponDefinitionError(`bad weapon id ${JSON.stringify(w?.id)}`);
  if (typeof w.name !== 'string' || w.name.length < 1 || w.name.length > 40) throw new WeaponDefinitionError(at('name'));
  if (w.category !== 'ballistic' && w.category !== 'melee') throw new WeaponDefinitionError(`${at('category')}: 'ballistic' or 'melee' (others arrive at M9)`);
  const mode = w.input?.mode;
  if (mode !== 'aimCharge' && mode !== 'instant') throw new WeaponDefinitionError(`${at('input.mode')}: 'aimCharge' or 'instant'`);
  const ammo = w.ammo?.default === 'inf' ? -1 : num(at('ammo.default'), w.ammo?.default, 0, 99, true);
  const base = {
    id: w.id,
    name: w.name,
    category: w.category,
    instant: mode === 'instant',
    speedMin: 0,
    speedMax: 0,
    chargeTicks: 1,
    muzzleOffset: 0,
    radius: 1,
    gravityScale: SUB,
    windFactor: 0,
    impact: false,
    ignoreOwnerTicks: 0,
    fuseTicks: 0,
    playerFuse: false,
    bounceLow: 0,
    bounceHigh: 0,
    bounceFriction: 0,
    explosionRadius: 0,
    damage: 0,
    knockback: 0,
    carve: false,
    maxLifeTicks: 1,
    meleeReach: 0,
    meleeArcCos: 0,
    meleeDamage: 0,
    meleeImpulse: 0,
    ammo,
    endsTurn: w.turn?.endsTurn !== false,
    shotsPerTurn: num(at('turn.shotsPerTurn'), w.turn?.shotsPerTurn ?? 1, 1, 10, true),
  } satisfies WeaponDef;

  if (w.category === 'melee') {
    const M = w.melee;
    if (!M) throw new WeaponDefinitionError(`${w.id}: a melee weapon needs a 'melee' block`);
    if (mode !== 'instant') throw new WeaponDefinitionError(`${at('input.mode')}: melee weapons are 'instant'`);
    return {
      ...base,
      meleeReach: num(at('melee.reach'), M.reach, 1, 80, true),
      meleeArcCos: cosDeg256(Math.round(num(at('melee.arcDegrees'), M.arcDegrees, 1, 360) / 2)),
      meleeDamage: num(at('melee.damage'), M.damage, 0, 200, true),
      meleeImpulse: toSub(num(at('melee.impulse'), M.impulse, 0, 32)),
    };
  }

  const L = w.launch, P = w.projectile, E = P?.payload?.explosion;
  if (!L || !P || !E) throw new WeaponDefinitionError(`${w.id}: launch, projectile and payload.explosion are required`);
  const speedMin = num(at('launch.speedMin'), L.speedMin, 0, 32);
  const speedMax = num(at('launch.speedMax'), L.speedMax, speedMin, 32);
  const impact = P.triggers?.find((t) => t.kind === 'impact');
  const fuse = P.triggers?.find((t) => t.kind === 'fuse');
  if (!impact && !fuse) throw new WeaponDefinitionError(`${at('projectile.triggers')}: needs an 'impact' or a 'fuse' trigger`);
  if (fuse && !P.bounce) throw new WeaponDefinitionError(`${at('projectile.bounce')}: fused projectiles need a bounce block`);
  const B = P.bounce;
  return {
    ...base,
    speedMin: toSub(speedMin),
    speedMax: toSub(speedMax),
    chargeTicks: num(at('launch.chargeTicks'), L.chargeTicks, 1, 500, true),
    muzzleOffset: num(at('launch.muzzleOffset'), L.muzzleOffset, 0, 64, true),
    radius: num(at('projectile.radius'), P.radius, 1, 16, true),
    gravityScale: ratio(num(at('projectile.gravityScale'), P.gravityScale, 0, 4)),
    windFactor: ratio(num(at('projectile.windFactor'), P.windFactor, 0, 4)),
    impact: impact !== undefined,
    ignoreOwnerTicks: impact ? num(at('triggers.impact.ignoreOwnerTicks'), impact.ignoreOwnerTicks ?? 0, 0, 100, true) : 0,
    fuseTicks: fuse ? Math.round(num(at('triggers.fuse.defaultSeconds'), fuse.defaultSeconds, 0.1, 10) * TICKS_PER_SECOND) : 0,
    playerFuse: fuse?.playerSet === true,
    bounceLow: B ? ratio(num(at('bounce.low'), B.low, 0, 1)) : 0,
    bounceHigh: B ? ratio(num(at('bounce.high'), B.high, 0, 1)) : 0,
    bounceFriction: B ? ratio(num(at('bounce.friction'), B.friction, 0, 1)) : 0,
    explosionRadius: num(at('payload.explosion.radius'), E.radius, 0, 200, true),
    damage: num(at('payload.explosion.damage'), E.damage, 0, 200, true),
    knockback: ratio(num(at('payload.explosion.knockback'), E.knockback, 0, 4)),
    carve: E.carve === true,
    maxLifeTicks: num(at('projectile.maxLifeTicks'), P.maxLifeTicks, 1, 6000, true),
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
