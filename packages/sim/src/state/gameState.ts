import { deepClone } from '../core/clone.js';
import { Hasher } from '../core/hash.js';
import { EMPTY_INPUT, type InputFrame } from '../core/input.js';
import { RNG_STREAMS, createStreams, type RngStreams } from '../core/rng.js';
import { fromJson, toJson } from '../core/serialize.js';
import { createDemo, type DemoState } from '../demo/bouncers.js';
import { hashTerrainInto, terrainFromMaterials, type TerrainState } from '../terrain/terrain.js';

/**
 * Authoritative simulation state. Everything that affects future ticks lives here,
 * and everything here is integers / integer arrays so it clones, serialises and hashes
 * deterministically. Grows milestone by milestone (see plan §7.1).
 */
export interface GameState {
  schema: 2;
  seed: number;
  tick: number;
  rng: RngStreams;
  lastInput: InputFrame;
  /** Null only in the bouncers demo scene. */
  terrain: TerrainState | null;
  /** Water line in whole pixels from the top; anything below drowns (M3). */
  waterY: number;
  demo: DemoState;
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
  demo?: { widthPx: number; heightPx: number; balls: number };
}

export function createGame(config: GameConfig): GameState {
  const seed = config.seed >>> 0;
  const rng = createStreams(seed);
  const d = config.demo ?? (config.map ? { widthPx: 960, heightPx: 540, balls: 0 } : { widthPx: 960, heightPx: 540, balls: 8 });
  const terrain = config.map ? terrainFromMaterials(config.map.width, config.map.height, config.map.mat) : null;
  return {
    schema: 2,
    seed,
    tick: 0,
    rng,
    lastInput: EMPTY_INPUT,
    terrain,
    waterY: config.map ? Math.trunc(config.map.waterY) : 0,
    demo: createDemo(d.widthPx, d.heightPx, rng.misc, d.balls),
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
  h.int(s.waterY);
  const d = s.demo;
  h.int(d.width).int(d.height).int(d.nextId).u32(d.balls.length);
  for (const b of d.balls) h.int(b.id).int(b.x).int(b.y).int(b.vx).int(b.vy).int(b.radius);
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
  if (s.schema !== 2) throw new Error(`Unsupported GameState schema: ${String(s.schema)}`);
  return s;
}
