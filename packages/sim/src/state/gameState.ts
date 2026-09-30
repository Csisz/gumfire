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
import { hashTerrainInto, terrainFromMaterials, type TerrainState } from '../terrain/terrain.js';

/**
 * Authoritative simulation state. Everything that affects future ticks lives here,
 * and everything here is integers / integer arrays so it clones, serialises and hashes
 * deterministically. Grows milestone by milestone (see plan §7.1).
 */
export interface GameState {
  schema: 6;
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
  /** Authored weapon data (usually `@gumfire/content`'s WEAPONS); compiled at creation. */
  weapons?: readonly WeaponJson[];
  /** Starting wind; default 0. */
  wind?: number;
}

export function hashWeapons(defs: readonly WeaponDef[]): number {
  return new Hasher().str(JSON.stringify(defs)).digest();
}

export function createGame(config: GameConfig): GameState {
  const seed = config.seed >>> 0;
  return {
    schema: 6,
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
  };
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
    hashBody(h, c.body);
  }
  h.u32(s.weaponsHash).int(s.wind).int(s.nextProjectileId).u32(s.projectiles.length);
  for (const p of s.projectiles) h.int(p.id).int(p.weapon).int(p.owner).int(p.x).int(p.y).int(p.vx).int(p.vy).int(p.age).int(p.windRem);
  h.u32(s.pendingExplosions.length);
  for (const e of s.pendingExplosions) h.int(e.x).int(e.y).int(e.radius).int(e.damage).int(e.knockback).bool(e.carve).str(e.cause).int(e.source);
  h.int(s.quietTicks).bool(s.autoReveal);
  return h.digest();
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
  if (s.schema !== 6) throw new Error(`Unsupported GameState schema: ${String(s.schema)}`);
  return s;
}
