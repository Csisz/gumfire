import { deepClone } from '../core/clone.js';
import { Hasher } from '../core/hash.js';
import { EMPTY_INPUT, type InputFrame } from '../core/input.js';
import { RNG_STREAMS, createStreams, type RngStreams } from '../core/rng.js';
import { createDemo, type DemoState } from '../demo/bouncers.js';

/**
 * Authoritative simulation state. Everything that affects future ticks lives here,
 * and everything here is plain integers/arrays so it clones, serialises and hashes
 * deterministically. Grows milestone by milestone (see plan §7.1).
 */
export interface GameState {
  schema: 1;
  seed: number;
  tick: number;
  rng: RngStreams;
  lastInput: InputFrame;
  demo: DemoState;
}

export interface GameConfig {
  seed: number;
  demo?: { widthPx: number; heightPx: number; balls: number };
}

export function createGame(config: GameConfig): GameState {
  const seed = config.seed >>> 0;
  const rng = createStreams(seed);
  const d = config.demo ?? { widthPx: 960, heightPx: 540, balls: 8 };
  return {
    schema: 1,
    seed,
    tick: 0,
    rng,
    lastInput: EMPTY_INPUT,
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
  const d = s.demo;
  h.int(d.width).int(d.height).int(d.nextId).u32(d.balls.length);
  for (const b of d.balls) h.int(b.id).int(b.x).int(b.y).int(b.vx).int(b.vy).int(b.radius);
  return h.digest();
}

export function cloneState(s: GameState): GameState {
  return deepClone(s);
}

export function serializeState(s: GameState): string {
  return JSON.stringify(s);
}

export function deserializeState(json: string): GameState {
  const s = JSON.parse(json) as GameState;
  if (s.schema !== 1) throw new Error(`Unsupported GameState schema: ${String(s.schema)}`);
  return s;
}
