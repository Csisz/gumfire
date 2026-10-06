import { deepClone } from '../core/clone.js';
import { Hasher } from '../core/hash.js';
import { EMPTY_INPUT, type InputFrame } from '../core/input.js';
import { RNG_STREAMS, createStreams, type RngStreams } from '../core/rng.js';
import { fromJson, toJson } from '../core/serialize.js';
import type { Body } from '../physics/body.js';
import type { Character } from '../character/character.js';
import { compileWeapons, type WeaponDef, type WeaponJson } from '../weapons/definition.js';
import type { Projectile } from '../weapons/projectile.js';
import type { Explosion } from '../explosions/explosion.js';
import type { Fire } from '../environment/fire.js';
import { hashTerrainInto, terrainFromMaterials, type TerrainState } from '../terrain/terrain.js';
import { findSpawn, setupMatch, type MatchConfig, type MatchState } from '../match/match.js';
import { generateMap, type MapGenConfig } from '../mapgen/mapgen.js';
import { compileProps, makeObject, type PropDef, type PropJson, type WorldObject } from '../environment/objects.js';

/**
 * Authoritative simulation state. Everything that affects future ticks lives here,
 * and everything here is integers / integer arrays so it clones, serialises and hashes
 * deterministically. Grows milestone by milestone (see plan §7.1).
 */
export interface GameState {
  schema: 13;
  seed: number;
  tick: number;
  rng: RngStreams;
  lastInput: InputFrame;
  /** Null only for map-less unit-test states. */
  terrain: TerrainState | null;
  /** Water line in whole pixels from the top; bodies whose centre reaches it sink. 0 = no water. */
  waterY: number;
  /** Physics bodies in ascending id order. */
  bodies: Body[];
  nextBodyId: number;
  /** Characters in ascending id order (dead ones stay, with state 'dead'). */
  characters: Character[];
  nextCharacterId: number;
  /** Id of the character receiving input; 0 = none. */
  activeCharacter: number;
  /** Compiled weapon set for this match (index = weapon id in inputs, events, commands). */
  weapons: WeaponDef[];
  /** Hash of the weapon set, computed once (the set never changes during a match). */
  weaponsHash: number;
  projectiles: Projectile[];
  nextProjectileId: number;
  /** −100..100, positive blows right. */
  wind: number;
  /** Explosions waiting to be resolved (FIFO); ones queued during resolution wait a tick. */
  pendingExplosions: Explosion[];
  /** Consecutive ticks with nothing moving (settle detection, plan §3.2). */
  quietTicks: number;
  /**
   * Reveal pending damage automatically whenever the world settles. True until the turn
   * system (M7) takes over and reveals in its DAMAGE_REVEAL phase.
   */
  autoReveal: boolean;
  /**
   * Turn-based match (M7): teams, turn order, phase machine. Null in free play (sandbox tools,
   * unit tests), where `activeCharacter` is chosen by `debugSelect` and damage auto-reveals.
   */
  match: MatchState | null;
  /** Burning flames (fire payloads), in id order. */
  fires: Fire[];
  nextFireId: number;
  /** Compiled map-object definitions (mines, barrels, crates) and their one-time hash. */
  props: PropDef[];
  propsHash: number;
  /** Map objects in id order. */
  objects: WorldObject[];
  nextObjectId: number;
}

export interface MapSpec {
  width: number;
  height: number;
  /** Materials, width*height (see terrain `Mat`). */
  mat: ArrayLike<number>;
  waterY: number;
}

export interface GameConfig {
  seed: number;
  map?: MapSpec;
  /** Generate the map instead (replays then carry only the generator settings). Ignored with `map`. */
  mapgen?: MapGenConfig;
  /** Authored weapon data (usually `@gumfire/content`'s WEAPONS); compiled at creation. */
  weapons?: readonly WeaponJson[];
  /** Starting wind; default 0 (a match rerolls it at every turn). */
  wind?: number;
  /** Set up a turn-based match: teams are placed and the turn system runs (needs a map). */
  match?: MatchConfig;
  /** Authored map objects (usually `@gumfire/content`'s PROPS); a match places them. */
  props?: readonly PropJson[];
}

export function hashWeapons(defs: readonly WeaponDef[]): number {
  return new Hasher().str(JSON.stringify(defs)).digest();
}

export function createGame(config: GameConfig): GameState {
  const seed = config.seed >>> 0;
  if (!config.map && config.mapgen) config = { ...config, map: generateMap(config.mapgen).spec };
  const s: GameState = {
    schema: 13,
    seed,
    tick: 0,
    rng: createStreams(seed),
    lastInput: EMPTY_INPUT,
    terrain: config.map ? terrainFromMaterials(config.map.width, config.map.height, config.map.mat) : null,
    waterY: config.map ? Math.trunc(config.map.waterY) : 0,
    bodies: [],
    nextBodyId: 1,
    characters: [],
    nextCharacterId: 1,
    activeCharacter: 0,
    ...weaponState(config.weapons ?? []),
    projectiles: [],
    nextProjectileId: 1,
    wind: Math.max(-100, Math.min(100, Math.trunc(config.wind ?? 0))),
    pendingExplosions: [],
    quietTicks: 0,
    autoReveal: true,
    match: null,
    fires: [],
    nextFireId: 1,
    ...propState(config.props ?? []),
    objects: [],
    nextObjectId: 1,
  };
  if (config.match) {
    if (!s.terrain) throw new Error('a match needs a map');
    const { match, characters } = setupMatch(config.match, s.terrain, s.waterY, s.rng.mapgen, s.nextCharacterId);
    s.match = match;
    s.characters = characters;
    s.nextCharacterId += characters.length;
    s.autoReveal = false; // the turn system reveals damage in its own phase (ADR-006)
    for (const t of match.teams) t.ammo = s.weapons.map((w) => (w.hidden ? 0 : w.ammo));
    placeObjects(s, config.match.objects);
  }
  return s;
}

function propState(list: readonly PropJson[]): { props: PropDef[]; propsHash: number } {
  const props = compileProps(list);
  return { props, propsHash: new Hasher().str(JSON.stringify(props)).digest() };
}

/** Match start: mines and barrels on dry, roomy ground, away from the characters. */
function placeObjects(s: GameState, manual?: MatchConfig['objects']): void {
  const m = s.match!, t = s.terrain!;
  if (manual) {
    for (const o of manual) {
      const idx = s.props.findIndex((p) => p.id === o.prop);
      if (idx < 0) throw new Error(`unknown prop ${o.prop}`);
      s.objects.push(makeObject(s.nextObjectId++, idx, s.props[idx]!, Math.trunc(o.x), Math.trunc(o.y)));
    }
    return;
  }
  const taken = s.characters.map((c) => ({ x: c.body.x >> 8, y: c.body.y >> 8 }));
  const place = (kind: 'mine' | 'barrel', count: number) => {
    const idx = s.props.findIndex((p) => p.kind === kind && !p.tags.includes('deployed'));
    if (idx < 0) return;
    for (let i = 0; i < count; i++) {
      const spot = findSpawn(t, s.rng.mapgen, s.waterY, taken, Math.max(48, m.ruleset.placementSpacing), m.ruleset.placementAboveWater);
      if (!spot) return;
      taken.push(spot);
      const def = s.props[idx]!;
      // characters stand with their centre 10 px above the ground; objects sit on it
      s.objects.push(makeObject(s.nextObjectId++, idx, def, spot.x, spot.y + 9 - def.radius));
    }
  };
  place('mine', m.ruleset.mines);
  place('barrel', m.ruleset.barrels);
}

function weaponState(list: readonly WeaponJson[]): { weapons: WeaponDef[]; weaponsHash: number } {
  const weapons = compileWeapons(list);
  return { weapons, weaponsHash: hashWeapons(weapons) };
}

/** Canonical hash of the full state. Field order here IS the canonical order. */
export function hashState(s: GameState): number {
  const h = new Hasher();
  h.u8(s.schema).u32(s.seed).int(s.tick).u32(s.lastInput);
  for (const name of RNG_STREAMS) {
    const r = s.rng[name];
    h.u32(r.s0).u32(r.s1).u32(r.s2).u32(r.s3);
  }
  h.bool(s.terrain !== null);
  if (s.terrain) hashTerrainInto(h, s.terrain);
  h.int(s.waterY).int(s.nextBodyId).u32(s.bodies.length);
  for (const b of s.bodies) hashBody(h, b);
  h.int(s.nextCharacterId).int(s.activeCharacter).u32(s.characters.length);
  for (const c of s.characters) {
    h.int(c.id).int(c.team).str(c.state).int(c.stateTicks).int(c.facing).int(c.aim).int(c.aimHeld);
    h.int(c.hp).int(c.jumpKind).int(c.lastImpact).bool(c.fallImmune).int(c.weapon).int(c.power).int(c.pendingDamage);
    h.int(c.fuse).bool(c.bounceHigh).bool(c.hasTarget).int(c.targetX).int(c.targetY);
    h.bool(c.chute).bool(c.jet).int(c.jetFuel).int(c.toolTicks).int(c.toolDx).int(c.toolDy).int(c.toolWeapon).u32(c.toolStruck.length);
    for (const id of c.toolStruck) h.int(id);
    h.bool(c.ropeOn).int(c.ropeShots).int(c.ropeWeapon).int(c.ropeLen).int(c.ropeWrapped).u32(c.ropePivots.length);
    for (const v of c.ropePivots) h.int(v);
    h.bool(c.headOn).int(c.headX).int(c.headY).int(c.headDx).int(c.headDy).int(c.headDist);
    hashBody(h, c.body);
  }
  h.u32(s.weaponsHash).int(s.wind).int(s.nextProjectileId).u32(s.projectiles.length);
  for (const p of s.projectiles) {
    h.int(p.id).int(p.weapon).int(p.owner).int(p.x).int(p.y).int(p.vx).int(p.vy).int(p.age).int(p.windRem).int(p.fuse);
    h.bool(p.detonate).int(p.walkDir).int(p.blocked).int(p.stride).int(p.tx).int(p.ty).u32(p.struck.length);
    for (const id of p.struck) h.int(id);
    h.int(p.bounces).bool(p.stuck).bool(p.body !== null);
    if (p.body) hashBody(h, p.body);
  }
  h.u32(s.pendingExplosions.length);
  for (const e of s.pendingExplosions) h.int(e.x).int(e.y).int(e.radius).int(e.damage).int(e.knockback).bool(e.carve).str(e.cause).int(e.source);
  h.int(s.quietTicks).bool(s.autoReveal);
  h.bool(s.match !== null);
  if (s.match) hashMatch(h, s.match);
  h.u32(s.propsHash).int(s.nextObjectId).u32(s.objects.length);
  for (const o of s.objects) {
    h.int(o.id).int(o.prop).int(o.hp).int(o.fuse).bool(o.dud).bool(o.falling).int(o.wait);
    hashBody(h, o.body);
  }
  h.int(s.nextFireId).u32(s.fires.length);
  for (const f of s.fires) h.int(f.id).int(f.x).int(f.y).int(f.vx).int(f.vy).int(f.life).bool(f.landed).int(f.damage);
  return h.digest();
}

function hashMatch(h: Hasher, m: MatchState): void {
  // roundTurns (M19) only joins the hash when set, so older matches and replays hash as before
  const { roundTurns, ...older } = m.ruleset;
  h.str(JSON.stringify(roundTurns ? m.ruleset : older)).u32(m.teams.length);
  for (const t of m.teams) {
    h.int(t.id).str(t.name).int(t.next).u32(t.characterIds.length);
    for (const id of t.characterIds) h.int(id);
    h.u32(t.ammo.length);
    for (const a of t.ammo) h.int(a);
    h.int(t.turns).int(t.side);
  }
  h.u32(m.order.length);
  for (const o of m.order) h.int(o);
  h.int(m.orderPos).str(m.phase).int(m.phaseTicks).int(m.turn).int(m.activeTeam);
  h.int(m.turnTicksLeft).int(m.retreatTicksLeft).int(m.roundTicksLeft).bool(m.suddenDeath);
  h.int(m.shotsFired).bool(m.remoteWait).str(m.result).int(m.winner);
}

function hashBody(h: Hasher, b: Body): void {
  h.int(b.id).int(b.x).int(b.y).int(b.vx).int(b.vy).int(b.radius);
  h.int(b.restitution).int(b.friction).int(b.gravityScale).bool(b.sleeping).int(b.stillTicks).int(b.drownTicks);
}

export function cloneState(s: GameState): GameState {
  return deepClone(s);
}

export function serializeState(s: GameState): string {
  return toJson(s);
}

export function deserializeState(json: string): GameState {
  const s = fromJson<GameState>(json);
  if (s.schema !== 13) throw new Error(`Unsupported GameState schema: ${String(s.schema)}`);
  return s;
}
