import { nextInt, nextRange, seedRng, type RngState } from '../core/rng.js';
import { Mat, terrainFromMaterials } from '../terrain/terrain.js';
import { findSpawn } from '../match/match.js';
import type { MapSpec } from '../state/gameState.js';

/**
 * Procedural maps (plan §8.4, M11). Pure integer code seeded by the map seed, so a replay only
 * needs `{ generator, seed }` — the client, the server and the AI all build the same bitmap.
 *
 *   island  — a hilly island in the water: layered value-noise heights under an edge envelope,
 *             winding tunnels, a few floating islets, embedded hard-candy boulders
 *   cavern  — a closed cave: solid ceiling and floor, chambers joined by winding tunnels,
 *             pillars, a flooded bottom
 *
 * Every map is validated (enough dry standing spots, a sane amount of land); a map that fails
 * is regenerated from the next derived seed, deterministically.
 */
export type MapGenerator = 'island' | 'cavern';

export interface MapGenConfig {
  generator: MapGenerator;
  seed: number;
  /** Default 2000 × 760. */
  width?: number;
  height?: number;
  /** 0..100: amount of tunnels / chambers (default 50). */
  holes?: number;
  /** 0..100: hilliness (default 50). */
  roughness?: number;
  /** Standing spots the map must offer (characters + objects); default 24. */
  minSpots?: number;
}

export interface GeneratedMap {
  spec: MapSpec;
  /** Generation attempts (1 = the first try was valid). */
  attempts: number;
  /** Standing spots found by validation. */
  spots: number;
}

const clampI = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Integer smoothstep for t in [0, 256] → [0, 256]. */
function smooth(t: number): number {
  return (t * t * (768 - 2 * t)) >> 16;
}

/** 1D value noise: lattice every `step` px with values in [−amp, amp]. */
function noise1(rng: RngState, length: number, step: number, amp: number): Int32Array {
  const n = Math.ceil(length / step) + 2;
  const lattice = new Int32Array(n);
  for (let i = 0; i < n; i++) lattice[i] = nextRange(rng, -amp, amp);
  const out = new Int32Array(length);
  for (let x = 0; x < length; x++) {
    const i = Math.trunc(x / step);
    const t = smooth(Math.trunc(((x - i * step) * 256) / step));
    out[x] = lattice[i]! + (((lattice[i + 1]! - lattice[i]!) * t) >> 8);
  }
  return out;
}

class Canvas {
  readonly mat: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.mat = new Uint8Array(w * h);
  }
  set(x: number, y: number, m: number): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.mat[y * this.w + x] = m;
  }
  get(x: number, y: number): number {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.mat[y * this.w + x]! : Mat.AIR;
  }
  /** Filled ellipse; `onlyOver` restricts the write to pixels currently of that material. */
  ellipse(cx: number, cy: number, rx: number, ry: number, m: number, onlyOver = -1): void {
    for (let y = -ry; y <= ry; y++) {
      // x extent of the ellipse row: rx * sqrt(1 − y²/ry²), integer
      const span = Math.trunc((rx * isqrtSmall(ry * ry - y * y)) / Math.max(1, ry));
      for (let x = -span; x <= span; x++) {
        if (onlyOver >= 0 && this.get(cx + x, cy + y) !== onlyOver) continue;
        this.set(cx + x, cy + y, m);
      }
    }
  }
  /** A thick line (capsule) of material `m`. */
  capsule(x0: number, y0: number, x1: number, y1: number, r: number, m: number, onlyOver = -1): void {
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let s = 0; s <= steps; s += Math.max(1, r >> 1)) {
      this.ellipse(x0 + Math.trunc((dx * s) / steps), y0 + Math.trunc((dy * s) / steps), r, r, m, onlyOver);
    }
    this.ellipse(x1, y1, r, r, m, onlyOver);
  }
}

function isqrtSmall(n: number): number {
  if (n <= 0) return 0;
  let x = 1;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

/** A winding tunnel: a random walk of capsules, carving soil only. */
function tunnel(c: Canvas, rng: RngState, x: number, y: number, length: number, r: number, yMin: number, yMax: number): void {
  let dir = nextRange(rng, 0, 7); // 8 directions
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
  for (let i = 0; i < length; i++) {
    const seg = nextRange(rng, 16, 40);
    const nx = clampI(x + DX[dir]! * seg, 20, c.w - 21);
    const ny = clampI(y + DY[dir]! * Math.trunc(seg / 2), yMin, yMax);
    c.capsule(x, y, nx, ny, r, Mat.AIR, Mat.SOIL);
    x = nx;
    y = ny;
    dir = (dir + nextRange(rng, -1, 1) + 8) % 8;
    if (DY[dir] === 1 && nextInt(rng, 3) === 0) dir = (dir + 4) % 8; // prefer sideways
  }
}

function island(cfg: Required<MapGenConfig>, rng: RngState): Canvas {
  const { width: W, height: H } = cfg;
  const c = new Canvas(W, H);
  const water = H - 60;
  const rough = cfg.roughness;
  const big = noise1(rng, W, 320, Math.trunc((140 * rough) / 50));
  const mid = noise1(rng, W, 110, Math.trunc((55 * rough) / 50));
  const small = noise1(rng, W, 36, Math.trunc((10 * rough) / 50));
  const base = Math.trunc(H * 0.42);
  const margin = Math.trunc(W * 0.07);
  for (let x = 0; x < W; x++) {
    // envelope: the island slopes into the water near both ends
    const edge = Math.min(x, W - 1 - x);
    const env = edge >= margin * 2 ? 256 : Math.trunc((edge * 256) / (margin * 2));
    let land = base + big[x]! + mid[x]! + small[x]!;
    land = Math.trunc((land * smooth(env)) >> 8) - (env < 256 ? 30 : 0);
    const top = clampI(H - land, 60, H);
    for (let y = top; y < H; y++) c.set(x, y, Mat.SOIL);
  }
  // tunnels inside the land
  const holes = Math.trunc((cfg.holes * 7) / 50);
  for (let i = 0; i < holes; i++) {
    tunnel(c, rng, nextRange(rng, margin * 2, W - margin * 2), nextRange(rng, Math.trunc(H * 0.45), water - 40), nextRange(rng, 6, 14), nextRange(rng, 10, 18), Math.trunc(H * 0.3), water - 20);
  }
  // floating islets above the land
  const islets = nextRange(rng, 2, 4);
  for (let i = 0; i < islets; i++) {
    const cx = nextRange(rng, margin * 2, W - margin * 2);
    let surface = 0;
    while (surface < H && c.get(cx, surface) === Mat.AIR) surface++;
    const cy = surface - nextRange(rng, 140, 220);
    if (cy < 70) continue;
    const rx = nextRange(rng, 70, 130), ry = nextRange(rng, 22, 34);
    c.ellipse(cx, cy, rx, ry, Mat.SOIL);
  }
  // hard-candy boulders half buried in the slopes (indestructible)
  const rocks = nextRange(rng, 2, 5);
  for (let i = 0; i < rocks; i++) {
    const cx = nextRange(rng, margin * 2, W - margin * 2);
    let surface = 0;
    while (surface < H && c.get(cx, surface) === Mat.AIR) surface++;
    if (surface >= water - 30) continue;
    c.ellipse(cx, surface + 14, nextRange(rng, 18, 34), nextRange(rng, 12, 22), Mat.ROCK);
  }
  return c;
}

function cavern(cfg: Required<MapGenConfig>, rng: RngState): Canvas {
  const { width: W, height: H } = cfg;
  const c = new Canvas(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) c.set(x, y, Mat.SOIL);
  const water = H - 50;
  // chambers on two or three bands, joined by tunnels
  const chambers: Array<{ x: number; y: number; ry: number }> = [];
  const count = 6 + Math.trunc((cfg.holes * 6) / 50);
  for (let i = 0; i < count; i++) {
    const x = Math.trunc(((i + 0.5) * W) / count) + nextRange(rng, -60, 60);
    const y = nextRange(rng, Math.trunc(H * 0.22), Math.trunc(H * 0.72));
    const rx = nextRange(rng, 90, 170), ry = nextRange(rng, 60, 110);
    c.ellipse(x, y, rx, ry, Mat.AIR);
    chambers.push({ x, y, ry });
  }
  for (let i = 0; i + 1 < chambers.length; i++) {
    const a = chambers[i]!, b = chambers[i + 1]!;
    const midY = clampI(Math.trunc((a.y + b.y) / 2) + nextRange(rng, -80, 80), 80, H - 120);
    c.capsule(a.x, a.y, Math.trunc((a.x + b.x) / 2), midY, nextRange(rng, 26, 40), Mat.AIR);
    c.capsule(Math.trunc((a.x + b.x) / 2), midY, b.x, b.y, nextRange(rng, 26, 40), Mat.AIR);
  }
  for (let i = 0; i < Math.trunc((cfg.holes * 5) / 50); i++) {
    tunnel(c, rng, nextRange(rng, 60, W - 60), nextRange(rng, 100, H - 120), nextRange(rng, 5, 10), nextRange(rng, 12, 20), 60, H - 80);
  }
  // a flooded floor channel and a few hard-candy boulders on chamber floors
  c.capsule(40, water + 20, W - 40, water + 20, 34, Mat.AIR);
  const boulders = nextRange(rng, 2, 4);
  for (let i = 0; i < boulders; i++) {
    const ch = chambers[nextInt(rng, chambers.length)]!;
    c.ellipse(ch.x + nextRange(rng, -50, 50), ch.y + ch.ry - 4, nextRange(rng, 18, 30), nextRange(rng, 12, 18), Mat.ROCK);
  }
  // indestructible frame: no escaping through the ceiling or the walls
  for (let x = 0; x < W; x++) for (let y = 0; y < 8; y++) c.set(x, y, Mat.BORDER);
  for (let y = 0; y < water; y++) {
    for (let x = 0; x < 8; x++) {
      c.set(x, y, Mat.BORDER);
      c.set(W - 1 - x, y, Mat.BORDER);
    }
  }
  return c;
}

/** Count dry standing spots (spaced 40 px) the way match placement finds them. */
function countSpots(spec: MapSpec, want: number, seed: number): number {
  const t = terrainFromMaterials(spec.width, spec.height, spec.mat);
  const rng = seedRng(seed ^ 0x5eed);
  const taken: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < want; i++) {
    const s = findSpawn(t, rng, spec.waterY, taken, 40, 60);
    if (!s) break;
    taken.push(s);
  }
  return taken.length;
}

/** Fraction of solid pixels ×1000. */
function landShare(c: Canvas): number {
  let n = 0;
  for (let i = 0; i < c.mat.length; i++) if (c.mat[i] !== Mat.AIR) n++;
  return Math.trunc((n * 1000) / c.mat.length);
}

export class MapGenError extends Error {}

export function generateMap(cfg: MapGenConfig): GeneratedMap {
  if (cfg.generator !== 'island' && cfg.generator !== 'cavern') throw new MapGenError(`unknown generator ${JSON.stringify(cfg.generator)}`);
  const full: Required<MapGenConfig> = {
    generator: cfg.generator,
    seed: cfg.seed >>> 0,
    width: clampI(Math.trunc(cfg.width ?? 2000), 400, 6000),
    height: clampI(Math.trunc(cfg.height ?? 760), 300, 2000),
    holes: clampI(Math.trunc(cfg.holes ?? 50), 0, 100),
    roughness: clampI(Math.trunc(cfg.roughness ?? 50), 0, 100),
    minSpots: clampI(Math.trunc(cfg.minSpots ?? 24), 2, 64),
  };
  for (let attempt = 1; attempt <= 12; attempt++) {
    const rng = seedRng((full.seed + Math.imul(attempt - 1, 0x9e3779b1)) >>> 0);
    const c = full.generator === 'island' ? island(full, rng) : cavern(full, rng);
    const waterY = full.generator === 'island' ? full.height - 60 : full.height - 50;
    const spec: MapSpec = { width: full.width, height: full.height, mat: c.mat, waterY };
    const share = landShare(c);
    const okShare = full.generator === 'island' ? share > 150 && share < 650 : share > 300 && share < 850;
    if (!okShare) continue;
    const spots = countSpots(spec, full.minSpots, full.seed + attempt);
    if (spots >= full.minSpots) return { spec, attempts: attempt, spots };
  }
  throw new MapGenError(`no playable ${full.generator} map for seed ${full.seed} after 12 attempts`);
}
