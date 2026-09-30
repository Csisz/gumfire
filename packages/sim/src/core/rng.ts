import { Hasher } from './hash.js';

/**
 * Seeded PRNG: xoshiro128** with splitmix32 seeding (ADR-002).
 *
 * State is a plain object of four uint32 values so it serialises with the rest of
 * GameState. Each purpose gets its own stream, so adding a random call in one system
 * never shifts the numbers another system sees.
 */

export interface RngState {
  s0: number;
  s1: number;
  s2: number;
  s3: number;
}

export const RNG_STREAMS = ['mapgen', 'crates', 'wind', 'fuse', 'ai', 'misc'] as const;
export type RngStreamName = (typeof RNG_STREAMS)[number];
export type RngStreams = Record<RngStreamName, RngState>;

const TWO_32 = 4294967296;

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function seedRng(seed: number): RngState {
  let z = seed >>> 0;
  const next = (): number => {
    z = (z + 0x9e3779b9) >>> 0;
    let t = z;
    t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
    return (t ^ (t >>> 16)) >>> 0;
  };
  const s: RngState = { s0: next(), s1: next(), s2: next(), s3: next() };
  if ((s.s0 | s.s1 | s.s2 | s.s3) === 0) s.s0 = 1; // all-zero state is invalid for xoshiro
  return s;
}

/** Next uint32. Mutates `r`. */
export function nextU32(r: RngState): number {
  const result = Math.imul(rotl(Math.imul(r.s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (r.s1 << 9) >>> 0;
  r.s2 = (r.s2 ^ r.s0) >>> 0;
  r.s3 = (r.s3 ^ r.s1) >>> 0;
  r.s1 = (r.s1 ^ r.s2) >>> 0;
  r.s0 = (r.s0 ^ r.s3) >>> 0;
  r.s2 = (r.s2 ^ t) >>> 0;
  r.s3 = rotl(r.s3, 11);
  return result;
}

/** Uniform integer in [0, n), unbiased (rejection sampling). 1 ≤ n ≤ 2^32. */
export function nextInt(r: RngState, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > TWO_32) throw new RangeError(`nextInt: bad bound ${n}`);
  const limit = TWO_32 - (TWO_32 % n);
  let v = nextU32(r);
  while (v >= limit) v = nextU32(r);
  return v % n;
}

/** Uniform integer in [lo, hi], inclusive. */
export function nextRange(r: RngState, lo: number, hi: number): number {
  if (hi < lo) throw new RangeError(`nextRange: hi < lo (${lo}, ${hi})`);
  return lo + nextInt(r, hi - lo + 1);
}

/** True with probability num/den. */
export function chance(r: RngState, num: number, den: number): boolean {
  return nextInt(r, den) < num;
}

export function cloneRng(r: RngState): RngState {
  return { s0: r.s0, s1: r.s1, s2: r.s2, s3: r.s3 };
}

/** Independent stream per purpose, derived from the match seed and the stream name. */
export function createStreams(seed: number): RngStreams {
  const streams = {} as RngStreams;
  for (const name of RNG_STREAMS) {
    streams[name] = seedRng(new Hasher().u32(seed).str(name).digest());
  }
  return streams;
}
