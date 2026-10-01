import { SUB, TICKS_PER_SECOND, toSub } from '../core/units.js';
import { degToAngle, vecFromAngle } from '../core/trig.js';

/**
 * Data-driven weapons (plan §12, ADR-004).
 *
 * Content is authored as JSON in human units (px, px/tick, ticks, degrees, ratios). At match
 * creation the sim *compiles* each definition to integer sim units and keeps the compiled set in
 * the GameState, so a replay carries its own weapon data and the state hash covers it.
 *
 * A weapon is composed of blocks (M9, Phase 2 hook 26.6):
 *   delivery  — how it leaves the shooter: a projectile (ballistic, walker, boomerang), a melee
 *               swing, a hitscan ray or a strike from the sky;
 *   payload   — what happens where it goes off: explosion, cluster of sub-projectiles, fire;
 *   modifiers — fuse, bounce, remote trigger, homing.
 * Sub-projectiles (cluster bomblets, strike bombs) compile to hidden weapon defs appended after
 * the selectable ones, so every projectile in flight is simply "a projectile of def N".
 */

// ---------------------------------------------------------------- authored (JSON) shape
export type WeaponCategory = 'ballistic' | 'melee' | 'hitscan' | 'strike';
export type ProjectileBehavior = 'ballistic' | 'walker' | 'boomerang';

export interface ExplosionJson {
  radius: number;
  damage: number;
  knockback: number;
  carve: boolean;
}

export interface PayloadJson {
  explosion?: ExplosionJson;
  /** Bomblets thrown upward in a fan where the projectile goes off. */
  cluster?: { count: number; speed: number; spreadDegrees: number; projectile: ProjectileJson };
  /** Burning droplets: they fall, stick, burn the ground and hurt whoever stands in them. */
  fire?: { count: number; speed: number; lifeSeconds: number; damage: number };
}

export interface ProjectileJson {
  radius: number;
  /** 1 = normal gravity. */
  gravityScale: number;
  /** 0 = ignores wind, 1 = full wind. */
  windFactor: number;
  behavior?: ProjectileBehavior;
  /**
   * `impact`: goes off on first contact. `fuse`: goes off when the fuse burns down (`playerSet`:
   * keys 1–5). `remote`: goes off when its owner presses Fire again.
   */
  triggers: Array<
    | { kind: 'impact'; ignoreOwnerTicks?: number }
    | { kind: 'fuse'; defaultSeconds: number; playerSet?: boolean }
    | { kind: 'remote' }
  >;
  /** Bouncing body (fused grenades, walkers): restitution for the low / high setting. */
  bounce?: { low: number; high: number; friction: number };
  /** Walks along the ground once it lands, hopping over steps it cannot climb. */
  walker?: { speed: number; maxStep: number; hop: number };
  /** Steers towards the target after `delaySeconds`, for `durationSeconds`. */
  homing?: { delaySeconds: number; durationSeconds: number; speed: number; turnDegrees: number };
  /** Flies out and is pulled back to the thrower, striking characters on the way. */
  boomerang?: { returnAccel: number; damage: number; impulse: number };
  payload: PayloadJson;
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

export interface HitscanJson {
  /** Ray length, px. */
  range: number;
  /** The small blast where the ray stops. */
  explosion: ExplosionJson;
}

export interface StrikeJson {
  count: number;
  /** Horizontal distance between drops, px. */
  spacing: number;
  /** Drop velocity: sideways (in the shooter's facing) and down, px/tick. */
  vx: number;
  vy: number;
  projectile: ProjectileJson;
}

export interface WeaponJson {
  id: string;
  name: string;
  category: WeaponCategory;
  description?: string;
  /**
   * `aimCharge`: hold Fire to charge, release to fire. `instant`: fires on the press.
   * `target`: click a target, then Fire. `targetCharge`: click a target, then aim and charge.
   */
  input: { mode: 'aimCharge' | 'instant' | 'target' | 'targetCharge' };
  launch?: {
    speedMin: number;
    speedMax: number;
    chargeTicks: number;
    muzzleOffset: number;
  };
  projectile?: ProjectileJson;
  melee?: MeleeJson;
  hitscan?: HitscanJson;
  strike?: StrikeJson;
  ammo: { default: number | 'inf' };
  turn: { endsTurn: boolean; shotsPerTurn: number };
}

// ---------------------------------------------------------------- compiled (sim) shape
export interface WeaponDef {
  id: string;
  name: string;
  category: WeaponCategory;
  /** Sub-projectile def (cluster bomblet, strike bomb): never selectable. */
  hidden: boolean;
  /** Fires on the Fire press, no charge. */
  instant: boolean;
  /** Needs a target point (setTarget command) before it can fire. */
  needsTarget: boolean;
  speedMin: number; // subpixels/tick
  speedMax: number;
  chargeTicks: number;
  muzzleOffset: number; // px
  // ---- projectile
  behavior: ProjectileBehavior;
  radius: number; // px
  gravityScale: number; // ×256
  windFactor: number; // ×256
  impact: boolean;
  ignoreOwnerTicks: number;
  /** Fuse length in ticks when the player does not set it; 0 = no fuse. */
  fuseTicks: number;
  playerFuse: boolean;
  remote: boolean;
  /** Bounce restitution ×256 (low / high setting) and friction ×256; 0 = not a bouncing body. */
  bounceLow: number;
  bounceHigh: number;
  bounceFriction: number;
  walkerSpeed: number; // px/tick
  walkerMaxStep: number; // px
  walkerHop: number; // subpixels/tick
  homingDelay: number; // ticks; 0 with homingDuration 0 = no homing
  homingDuration: number; // ticks
  homingSpeed: number; // subpixels/tick
  homingTurn: number; // angle units per tick
  boomReturnAccel: number; // subpixels/tick²
  boomDamage: number;
  boomImpulse: number; // subpixels/tick
  maxLifeTicks: number;
  // ---- payload
  explosionRadius: number; // px
  damage: number;
  knockback: number; // ×256
  carve: boolean;
  clusterCount: number;
  clusterSpeed: number; // subpixels/tick
  clusterSpread: number; // angle units (full fan)
  clusterChild: number; // def index, −1 = none
  fireCount: number;
  fireSpeed: number; // subpixels/tick
  fireLife: number; // ticks
  fireDamage: number; // per burn
  // ---- melee
  meleeReach: number; // px
  /** cos(arc / 2) ×256: a target must lie within this cone around the aim. */
  meleeArcCos: number;
  meleeDamage: number;
  meleeImpulse: number; // subpixels/tick
  // ---- hitscan
  hitscanRange: number; // px
  // ---- strike
  strikeCount: number;
  strikeSpacing: number; // px
  strikeVx: number; // subpixels/tick
  strikeVy: number;
  strikeChild: number; // def index, −1 = none
  // ---- rules
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
const secondsTicks = (v: number) => Math.round(v * TICKS_PER_SECOND);

/** cos of whole degrees 0..180, ×256, from the integer trig table (no float trig in the sim). */
function cosDeg256(deg: number): number {
  return Math.trunc(vecFromAngle(degToAngle(deg), SUB).x);
}

/** Every field at its "absent" value; blocks fill in what they define. */
function blank(id: string, name: string, category: WeaponCategory): WeaponDef {
  return {
    id,
    name,
    category,
    hidden: false,
    instant: false,
    needsTarget: false,
    speedMin: 0,
    speedMax: 0,
    chargeTicks: 1,
    muzzleOffset: 0,
    behavior: 'ballistic',
    radius: 1,
    gravityScale: SUB,
    windFactor: 0,
    impact: false,
    ignoreOwnerTicks: 0,
    fuseTicks: 0,
    playerFuse: false,
    remote: false,
    bounceLow: 0,
    bounceHigh: 0,
    bounceFriction: 0,
    walkerSpeed: 0,
    walkerMaxStep: 0,
    walkerHop: 0,
    homingDelay: 0,
    homingDuration: 0,
    homingSpeed: 0,
    homingTurn: 0,
    boomReturnAccel: 0,
    boomDamage: 0,
    boomImpulse: 0,
    maxLifeTicks: 1,
    explosionRadius: 0,
    damage: 0,
    knockback: 0,
    carve: false,
    clusterCount: 0,
    clusterSpeed: 0,
    clusterSpread: 0,
    clusterChild: -1,
    fireCount: 0,
    fireSpeed: 0,
    fireLife: 0,
    fireDamage: 0,
    meleeReach: 0,
    meleeArcCos: 0,
    meleeDamage: 0,
    meleeImpulse: 0,
    hitscanRange: 0,
    strikeCount: 0,
    strikeSpacing: 0,
    strikeVx: 0,
    strikeVy: 0,
    strikeChild: -1,
    ammo: -1,
    endsTurn: true,
    shotsPerTurn: 1,
  };
}

/** Collects hidden sub-projectile defs while compiling; they are appended after the set. */
interface Children {
  base: number;
  list: WeaponDef[];
}

function explosionInto(d: WeaponDef, at: string, E: ExplosionJson): void {
  d.explosionRadius = num(`${at}.radius`, E.radius, 0, 200, true);
  d.damage = num(`${at}.damage`, E.damage, 0, 200, true);
  d.knockback = ratio(num(`${at}.knockback`, E.knockback, 0, 4));
  d.carve = E.carve === true;
}

/** Compile a projectile block (+ its payload) into `d`; sub-projectiles go to `kids`. */
function projectileInto(d: WeaponDef, at: string, P: ProjectileJson, kids: Children, depth: number): void {
  if (!P) throw new WeaponDefinitionError(`${at}: projectile block required`);
  const behavior = P.behavior ?? 'ballistic';
  if (!['ballistic', 'walker', 'boomerang'].includes(behavior)) throw new WeaponDefinitionError(`${at}.behavior: ballistic, walker or boomerang`);
  d.behavior = behavior;
  d.radius = num(`${at}.radius`, P.radius, 1, 16, true);
  d.gravityScale = ratio(num(`${at}.gravityScale`, P.gravityScale, 0, 4));
  d.windFactor = ratio(num(`${at}.windFactor`, P.windFactor, 0, 4));
  d.maxLifeTicks = num(`${at}.maxLifeTicks`, P.maxLifeTicks, 1, 6000, true);
  const impact = P.triggers?.find((t) => t.kind === 'impact');
  const fuse = P.triggers?.find((t) => t.kind === 'fuse');
  const remote = P.triggers?.find((t) => t.kind === 'remote');
  if (!impact && !fuse && !remote && behavior !== 'boomerang') throw new WeaponDefinitionError(`${at}.triggers: needs an 'impact', 'fuse' or 'remote' trigger`);
  d.impact = impact !== undefined;
  d.ignoreOwnerTicks = impact ? num(`${at}.triggers.impact.ignoreOwnerTicks`, impact.ignoreOwnerTicks ?? 0, 0, 100, true) : 0;
  d.fuseTicks = fuse ? secondsTicks(num(`${at}.triggers.fuse.defaultSeconds`, fuse.defaultSeconds, 0.1, 10)) : 0;
  d.playerFuse = fuse?.playerSet === true;
  d.remote = remote !== undefined;
  if ((fuse || behavior === 'walker') && !P.bounce) throw new WeaponDefinitionError(`${at}.bounce: fused projectiles and walkers need a bounce block`);
  if (P.bounce) {
    d.bounceLow = ratio(num(`${at}.bounce.low`, P.bounce.low, 0, 1));
    d.bounceHigh = ratio(num(`${at}.bounce.high`, P.bounce.high, 0, 1));
    d.bounceFriction = ratio(num(`${at}.bounce.friction`, P.bounce.friction, 0, 1));
  }
  if (behavior === 'walker') {
    const Wk = P.walker;
    if (!Wk) throw new WeaponDefinitionError(`${at}.walker: required for behavior 'walker'`);
    d.walkerSpeed = num(`${at}.walker.speed`, Wk.speed, 1, 4, true);
    d.walkerMaxStep = num(`${at}.walker.maxStep`, Wk.maxStep, 0, 16, true);
    d.walkerHop = toSub(num(`${at}.walker.hop`, Wk.hop, 0, 12));
  }
  if (behavior === 'boomerang') {
    const B = P.boomerang;
    if (!B) throw new WeaponDefinitionError(`${at}.boomerang: required for behavior 'boomerang'`);
    d.boomReturnAccel = Math.max(1, Math.round(num(`${at}.boomerang.returnAccel`, B.returnAccel, 0.01, 2) * SUB));
    d.boomDamage = num(`${at}.boomerang.damage`, B.damage, 0, 200, true);
    d.boomImpulse = toSub(num(`${at}.boomerang.impulse`, B.impulse, 0, 32));
  }
  if (P.homing) {
    const H = P.homing;
    d.homingDelay = secondsTicks(num(`${at}.homing.delaySeconds`, H.delaySeconds, 0, 10));
    d.homingDuration = secondsTicks(num(`${at}.homing.durationSeconds`, H.durationSeconds, 0.1, 30));
    d.homingSpeed = toSub(num(`${at}.homing.speed`, H.speed, 1, 32));
    d.homingTurn = Math.max(1, degToAngle(num(`${at}.homing.turnDegrees`, H.turnDegrees, 0.1, 90)));
  }
  const pay = P.payload ?? {};
  if (pay.explosion) explosionInto(d, `${at}.payload.explosion`, pay.explosion);
  if (pay.cluster) {
    if (depth > 0) throw new WeaponDefinitionError(`${at}.payload.cluster: bomblets cannot carry another cluster`);
    const C = pay.cluster;
    d.clusterCount = num(`${at}.payload.cluster.count`, C.count, 1, 12, true);
    d.clusterSpeed = toSub(num(`${at}.payload.cluster.speed`, C.speed, 0.5, 16));
    d.clusterSpread = degToAngle(num(`${at}.payload.cluster.spreadDegrees`, C.spreadDegrees, 0, 180));
    d.clusterChild = childDef(`${d.id}__bomblet`, `${d.name} bomblet`, `${at}.payload.cluster.projectile`, C.projectile, kids, depth + 1);
  }
  if (pay.fire) {
    const F = pay.fire;
    d.fireCount = num(`${at}.payload.fire.count`, F.count, 1, 24, true);
    d.fireSpeed = toSub(num(`${at}.payload.fire.speed`, F.speed, 0, 12));
    d.fireLife = secondsTicks(num(`${at}.payload.fire.lifeSeconds`, F.lifeSeconds, 0.2, 20));
    d.fireDamage = num(`${at}.payload.fire.damage`, F.damage, 0, 50, true);
  }
  if (!pay.explosion && !pay.cluster && !pay.fire && behavior !== 'boomerang') throw new WeaponDefinitionError(`${at}.payload: needs an explosion, cluster or fire`);
}

function childDef(id: string, name: string, at: string, P: ProjectileJson, kids: Children, depth: number): number {
  const d = blank(id, name, 'ballistic');
  d.hidden = true;
  projectileInto(d, at, P, kids, depth);
  kids.list.push(d);
  return kids.base + kids.list.length - 1;
}

function compileInto(w: WeaponJson, kids: Children): WeaponDef {
  const at = (p: string) => `${w?.id ?? '?'}.${p}`;
  if (!w || typeof w.id !== 'string' || !/^[a-z][a-z0-9_]{1,40}$/.test(w.id)) throw new WeaponDefinitionError(`bad weapon id ${JSON.stringify(w?.id)}`);
  if (typeof w.name !== 'string' || w.name.length < 1 || w.name.length > 40) throw new WeaponDefinitionError(at('name'));
  if (!['ballistic', 'melee', 'hitscan', 'strike'].includes(w.category)) {
    throw new WeaponDefinitionError(`${at('category')}: one of ballistic, melee, hitscan, strike (got ${JSON.stringify(w.category)})`);
  }
  const mode = w.input?.mode;
  if (!['aimCharge', 'instant', 'target', 'targetCharge'].includes(mode)) throw new WeaponDefinitionError(`${at('input.mode')}: aimCharge, instant, target or targetCharge`);
  const d = blank(w.id, w.name, w.category);
  d.instant = mode === 'instant' || mode === 'target';
  d.needsTarget = mode === 'target' || mode === 'targetCharge';
  d.ammo = w.ammo?.default === 'inf' ? -1 : num(at('ammo.default'), w.ammo?.default, 0, 99, true);
  d.endsTurn = w.turn?.endsTurn !== false;
  d.shotsPerTurn = num(at('turn.shotsPerTurn'), w.turn?.shotsPerTurn ?? 1, 1, 10, true);

  switch (w.category) {
    case 'melee': {
      const M = w.melee;
      if (!M) throw new WeaponDefinitionError(`${w.id}: a melee weapon needs a 'melee' block`);
      if (mode !== 'instant') throw new WeaponDefinitionError(`${at('input.mode')}: melee weapons are 'instant'`);
      d.meleeReach = num(at('melee.reach'), M.reach, 1, 80, true);
      d.meleeArcCos = cosDeg256(Math.round(num(at('melee.arcDegrees'), M.arcDegrees, 1, 360) / 2));
      d.meleeDamage = num(at('melee.damage'), M.damage, 0, 200, true);
      d.meleeImpulse = toSub(num(at('melee.impulse'), M.impulse, 0, 32));
      return d;
    }
    case 'hitscan': {
      const H = w.hitscan;
      if (!H) throw new WeaponDefinitionError(`${w.id}: a hitscan weapon needs a 'hitscan' block`);
      if (mode !== 'instant') throw new WeaponDefinitionError(`${at('input.mode')}: hitscan weapons are 'instant'`);
      d.hitscanRange = num(at('hitscan.range'), H.range, 8, 4000, true);
      d.muzzleOffset = 12;
      explosionInto(d, at('hitscan.explosion'), H.explosion);
      return d;
    }
    case 'strike': {
      const S = w.strike;
      if (!S) throw new WeaponDefinitionError(`${w.id}: a strike weapon needs a 'strike' block`);
      if (mode !== 'target') throw new WeaponDefinitionError(`${at('input.mode')}: strikes are 'target'`);
      d.strikeCount = num(at('strike.count'), S.count, 1, 12, true);
      d.strikeSpacing = num(at('strike.spacing'), S.spacing, 0, 200, true);
      d.strikeVx = toSub(num(at('strike.vx'), S.vx, 0, 16));
      d.strikeVy = toSub(num(at('strike.vy'), S.vy, 0, 16));
      d.strikeChild = childDef(`${w.id}__drop`, `${w.name} drop`, at('strike.projectile'), S.projectile, kids, 1);
      return d;
    }
    case 'ballistic': {
      const L = w.launch;
      if (!L || !w.projectile) throw new WeaponDefinitionError(`${w.id}: launch and projectile blocks are required`);
      if (mode === 'instant' || mode === 'target') throw new WeaponDefinitionError(`${at('input.mode')}: thrown weapons are 'aimCharge' or 'targetCharge'`);
      const speedMin = num(at('launch.speedMin'), L.speedMin, 0, 32);
      d.speedMin = toSub(speedMin);
      d.speedMax = toSub(num(at('launch.speedMax'), L.speedMax, speedMin, 32));
      d.chargeTicks = num(at('launch.chargeTicks'), L.chargeTicks, 1, 500, true);
      d.muzzleOffset = num(at('launch.muzzleOffset'), L.muzzleOffset, 0, 64, true);
      projectileInto(d, w.id + '.projectile', w.projectile, kids, 0);
      if (d.homingDuration > 0 && !d.needsTarget) throw new WeaponDefinitionError(`${at('input.mode')}: homing needs 'targetCharge'`);
      return d;
    }
  }
}

/** Validate and convert one authored weapon (sub-projectile defs are dropped). */
export function compileWeapon(w: WeaponJson): WeaponDef {
  return compileInto(w, { base: 1 << 20, list: [] });
}

/**
 * Compile a whole set; ids must be unique. Selectable weapons keep their authored order (the
 * weapon index); hidden sub-projectile defs follow them.
 */
export function compileWeapons(list: readonly WeaponJson[]): WeaponDef[] {
  const kids: Children = { base: list.length, list: [] };
  const out = list.map((w) => compileInto(w, kids));
  const seen = new Set<string>();
  for (const d of out) {
    if (seen.has(d.id)) throw new WeaponDefinitionError(`duplicate weapon id ${d.id}`);
    seen.add(d.id);
  }
  return [...out, ...kids.list];
}

/** Launch speed for a charge of `power` ticks (0..chargeTicks), subpixels/tick. */
export function launchSpeed(d: WeaponDef, power: number): number {
  const p = Math.max(0, Math.min(d.chargeTicks, power));
  return d.speedMin + Math.trunc(((d.speedMax - d.speedMin) * p) / d.chargeTicks);
}
