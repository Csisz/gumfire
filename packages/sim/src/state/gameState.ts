import { deepClone } from '../core/clone.js';
import { Hasher } from '../core/hash.js';
import { EMPTY_INPUT, type InputFrame } from '../core/input.js';
import { RNG_STREAMS, createStreams, type RngStreams } from '../core/rng.js';
import { fromJson, toJson } from '../core/serialize.js';
import type { Body } from '../physics/body.js';
import { hashTerrainInto, terrainFromMaterials, type TerrainState } from '../terrain/terrain.js';

/**
 * Authoritative simulation state. Everything that affects future ticks lives here,
 * and everything here is integers / integer arrays so it clones, serialises and hashes
 * deterministically. Grows milestone by milestone (see plan §7.1).
 */
export interface GameState {
  schema: 3;
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
}

export function createGame(config: GameConfig): GameState {
  const seed = config.seed >>> 0;
  return {
    schema: 3,
    seed,
    tick: 0,
    rng: createStreams(seed),
    lastInput: EMPTY_INPUT,
    terrain: config.map ? terrainFromMaterials(config.map.width, config.map.height, config.map.mat) : null,
    waterY: config.map ? Math.trunc(config.map.waterY) : 0,
    bodies: [],
    nextBodyId: 1,
  };
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
  for (const b of s.bodies) {
    h.int(b.id).int(b.x).int(b.y).int(b.vx).int(b.vy).int(b.radius);
    h.int(b.restitution).int(b.friction).int(b.gravityScale).bool(b.sleeping).int(b.stillTicks).int(b.drownTicks);
  }
  return h.digest();
}

export function cloneState(s: GameState): GameState {
  return deepClone(s);
}

export function serializeState(s: GameState): string {
  return toJson(s);
}

export function deserializeState(json: string): GameState {
  const s = fromJson<GameState>(json);
  if (s.schema !== 3) throw new Error(`Unsupported GameState schema: ${String(s.schema)}`);
  return s;
}
