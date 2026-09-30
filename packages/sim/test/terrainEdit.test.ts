import { describe, expect, it } from 'vitest';
import {
  GIRDER_BREAK_RADIUS,
  Mat,
  addRect,
  carveCapsule,
  carveCircle,
  countSolid,
  createGame,
  hashState,
  runReplay,
  seedRng,
  nextRange,
  sanitizeCommand,
  step,
  takeDirtyChunks,
  terrainFromMaterials,
  chunkRect,
  pixelWeight,
  recomputeAllChunks,
  type TerrainState,
  type TimedCommand,
} from '../src/index.js';

const W = 1920;
const H = 696;

/** Soil below y=300, a rock slab at y 500..519, a girder at y 250..259 x 800..900, border column x 0..3. */
function testMats(): Uint8Array {
  const mat = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let m: number = y >= 300 ? Mat.SOIL : Mat.AIR;
      if (y >= 500 && y < 520 && x >= 200 && x < 1700) m = Mat.ROCK;
      if (y >= 250 && y < 260 && x >= 800 && x < 900) m = Mat.GIRDER;
      if (x < 4) m = Mat.BORDER;
      mat[y * W + x] = m;
    }
  return mat;
}
const fresh = (): TerrainState => terrainFromMaterials(W, H, testMats());

/**
 * Incrementally maintained chunk data must equal a from-scratch recount, computed here
 * independently with BigInt arithmetic: hash = Σ mat[i]·pixelWeight(i) mod 2³².
 */
function expectChunksConsistent(t: TerrainState): void {
  for (let i = 0; i < t.chunkHash.length; i++) {
    const r = chunkRect(t, i);
    let h = 0n;
    let solid = 0;
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        const p = y * t.width + x;
        const m = t.mat[p]!;
        if (m !== 0) solid++;
        h += BigInt(m) * BigInt(pixelWeight(p));
      }
    expect(t.chunkSolid[i]).toBe(solid);
    expect(t.chunkHash[i]).toBe(Number(h % 4294967296n));
  }
}

describe('carveCircle', () => {
  it('removes exactly the soil pixels with dx² + dy² ≤ r² (brute-force equivalence)', () => {
    const t = fresh();
    const before = t.mat.slice();
    const cx = 413, cy = 331, r = 47;
    const res = carveCircle(t, cx, cy, r)!;
    let expected = 0;
    let mismatches = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
        const shouldCarve = inside && before[i] === Mat.SOIL;
        if (shouldCarve) expected++;
        if (t.mat[i] !== (shouldCarve ? Mat.AIR : before[i])) mismatches++;
      }
    expect(mismatches).toBe(0);
    expect(res.changed).toBe(expected);
    expect(res.x0).toBeGreaterThanOrEqual(cx - r);
    expect(res.x1).toBeLessThanOrEqual(cx + r);
    expect(res.y0).toBe(300); // clipped to the soil surface
  });

  it('never removes rock or border; girders only for big blasts', () => {
    const t = fresh();
    carveCircle(t, 600, 510, 60);
    for (let x = 560; x <= 640; x++) expect(t.mat[510 * W + x]).toBe(Mat.ROCK);
    carveCircle(t, 2, 400, 40);
    for (let y = 380; y <= 420; y++) expect(t.mat[y * W + 1]).toBe(Mat.BORDER);
    carveCircle(t, 850, 255, GIRDER_BREAK_RADIUS - 1);
    expect(t.mat[255 * W + 850]).toBe(Mat.GIRDER);
    carveCircle(t, 850, 255, GIRDER_BREAK_RADIUS);
    expect(t.mat[255 * W + 850]).toBe(Mat.AIR);
  });

  it('keeps chunk counts and hashes consistent, bumps version, marks dirty chunks', () => {
    const t = fresh();
    takeDirtyChunks(t);
    const v = t.version;
    const solidBefore = countSolid(t);
    const res = carveCircle(t, 1000, 320, 90)!;
    expect(t.version).toBe(v + 1);
    expect(countSolid(t)).toBe(solidBefore - res.changed);
    expectChunksConsistent(t);
    const dirty = takeDirtyChunks(t);
    expect(dirty.length).toBeGreaterThan(0);
    for (const i of dirty) {
      const r = chunkRect(t, i);
      expect(r.x1 >= res.x0 && r.x0 <= res.x1 && r.y1 >= res.y0 && r.y0 <= res.y1).toBe(true);
    }
  });

  it('returns null and changes nothing when there is nothing to carve', () => {
    const t = fresh();
    const v = t.version;
    expect(carveCircle(t, 500, 100, 40)).toBeNull(); // sky
    expect(carveCircle(t, -500, -500, 40)).toBeNull(); // off map
    expect(t.version).toBe(v);
  });

  it('incremental chunk data equals a full recompute after many edits of every kind', () => {
    const t = fresh();
    const rng = seedRng(11);
    for (let k = 0; k < 60; k++) {
      carveCircle(t, nextRange(rng, 0, W), nextRange(rng, 240, H), nextRange(rng, 3, 70));
      addRect(t, nextRange(rng, 0, W - 64), nextRange(rng, 100, 400), 64, 10);
      carveCapsule(t, nextRange(rng, 0, W - 300), nextRange(rng, 250, 650), nextRange(rng, 0, W - 300), nextRange(rng, 250, 650), 6);
    }
    const counts = t.chunkSolid.slice();
    const hashes = t.chunkHash.slice();
    recomputeAllChunks(t);
    expect(t.chunkSolid).toEqual(counts);
    expect(t.chunkHash).toEqual(hashes);
  });

  it('clips at map edges', () => {
    const t = fresh();
    const res = carveCircle(t, W - 1, H - 1, 50)!;
    expect(res.x1).toBe(W - 1);
    expect(res.y1).toBe(H - 1);
    expectChunksConsistent(t);
  });

  it('rejects non-integer or out-of-range input', () => {
    const t = fresh();
    expect(() => carveCircle(t, 1.5, 300, 10)).toThrow();
    expect(() => carveCircle(t, 10, 300, -1)).toThrow();
    expect(() => carveCircle(t, 10, 300, 10_000)).toThrow();
  });

  it('property: 300 random carves never add solid pixels and keep chunks consistent', () => {
    const t = fresh();
    const rng = seedRng(5);
    let solid = countSolid(t);
    for (let k = 0; k < 300; k++) {
      carveCircle(t, nextRange(rng, -50, W + 50), nextRange(rng, 200, H + 50), nextRange(rng, 1, 90));
      const s = countSolid(t);
      expect(s).toBeLessThanOrEqual(solid);
      solid = s;
    }
    expectChunksConsistent(t);
  });

  it('performance: an r=100 carve including chunk recompute averages well under 1 ms', () => {
    const t = fresh();
    const rng = seedRng(9);
    const N = 200;
    const t0 = performance.now();
    for (let k = 0; k < N; k++) carveCircle(t, nextRange(rng, 100, W - 100), nextRange(rng, 350, 650), 100);
    const avg = (performance.now() - t0) / N;
    // Real budget (0.2 ms) is checked on bundled code by `pnpm bench:carve`; vitest's module
    // transform slows this ~10× and parallel test files add noise, so this is only a smoke check.
    expect(avg).toBeLessThan(5);
  });
});

describe('carveCapsule', () => {
  it('removes exactly the soil within distance r of the segment', () => {
    const t = fresh();
    const before = t.mat.slice();
    const ax = 300, ay = 320, bx = 520, by = 450, r = 9;
    carveCapsule(t, ax, ay, bx, by, r);
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let mismatches = 0;
    for (let y = 280; y < 480; y++)
      for (let x = 270; x < 550; x++) {
        const px = x - ax, py = y - ay;
        const u = Math.max(0, Math.min(1, (px * dx + py * dy) / L2));
        const ex = ax + u * dx - x, ey = ay + u * dy - y;
        const d2 = ex * ex + ey * ey;
        const i = y * W + x;
        if (Math.abs(d2 - r * r) < 1e-6) continue; // exact boundary: float reference is ambiguous
        const shouldCarve = d2 < r * r && before[i] === Mat.SOIL;
        if (t.mat[i] !== (shouldCarve ? Mat.AIR : before[i])) mismatches++;
      }
    expect(mismatches).toBe(0);
    expectChunksConsistent(t);
  });

  it('degenerates to a circle and rejects over-long segments', () => {
    const a = fresh();
    const b = fresh();
    carveCapsule(a, 700, 330, 700, 330, 20);
    carveCircle(b, 700, 330, 20);
    let diff = 0;
    for (let i = 0; i < a.mat.length; i++) if (a.mat[i] !== b.mat[i]) diff++;
    expect(diff).toBe(0);
    expect(a.chunkHash).toEqual(b.chunkHash);
    expect(() => carveCapsule(a, 0, 400, 3000, 400, 5)).toThrow();
  });
});

describe('addRect', () => {
  it('fills only air, never overwrites terrain, and keeps chunks consistent', () => {
    const t = fresh();
    const res = addRect(t, 1000, 280, 64, 40)!; // straddles the soil surface at y=300
    expect(res.changed).toBe(64 * 20);
    expect(t.mat[290 * W + 1010]).toBe(Mat.GIRDER);
    expect(t.mat[310 * W + 1010]).toBe(Mat.SOIL);
    expectChunksConsistent(t);
    expect(addRect(t, 1000, 280, 64, 20)).toBeNull(); // already full
    expect(() => addRect(t, 0, 0, 10, 10, Mat.AIR)).toThrow();
  });
});

describe('commands and replay', () => {
  const map = { width: W, height: H, mat: testMats(), waterY: 660 };

  it('sanitises untrusted commands', () => {
    expect(sanitizeCommand({ type: 'debugCarve', x: 10, y: 20, r: 30 })).toEqual({ type: 'debugCarve', x: 10, y: 20, r: 30 });
    expect(sanitizeCommand({ type: 'debugCarve', x: 10.5, y: 20, r: 30 })).toBeNull();
    expect(sanitizeCommand({ type: 'debugCarve', x: 10, y: 20, r: 0 })).toBeNull();
    expect(sanitizeCommand({ type: 'debugCarve', x: 10, y: 20, r: 999 })).toBeNull();
    expect(sanitizeCommand({ type: 'nuke' })).toBeNull();
    expect(sanitizeCommand(null)).toBeNull();
    expect(sanitizeCommand({ type: 'debugTunnel', x0: 0, y0: 0, x1: 5000, y1: 0, r: 5 })).toBeNull();
  });

  it('a carve command changes terrain, emits TerrainChanged and changes the state hash', () => {
    const s = createGame({ seed: 1, map });
    const h0 = hashState(s);
    const ev = step(s, 0, [{ type: 'debugCarve', x: 900, y: 320, r: 40 }]);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'TerrainChanged', cause: 'carve', tick: 1 }));
    expect(hashState(s)).not.toBe(h0);
    const junk = step(s, 0, [{ type: 'debugCarve', x: 'x' }, 42]);
    expect(junk.filter((e) => e.type === 'TerrainChanged')).toHaveLength(0);
  });

  it('replays with commands reproduce the live session exactly', () => {
    const rng = seedRng(77);
    const commands: TimedCommand[] = [];
    for (let tick = 1; tick <= 400; tick++) {
      if (tick % 7 === 0) commands.push({ tick, cmd: { type: 'debugCarve', x: nextRange(rng, 0, W), y: nextRange(rng, 250, 690), r: nextRange(rng, 5, 80) } });
      if (tick % 50 === 0) commands.push({ tick, cmd: { type: 'debugGirder', x: nextRange(rng, 0, W - 64), y: nextRange(rng, 100, 290), w: 64, h: 10 } });
      if (tick % 33 === 0) commands.push({ tick, cmd: { type: 'debugTunnel', x0: 100 + tick, y0: 310, x1: 300 + tick, y1: 420, r: 8 } });
    }
    const inputs = new Array(400).fill(0);
    // live session
    const live = createGame({ seed: 3, map });
    let c = 0;
    for (let i = 0; i < inputs.length; i++) {
      const batch = [];
      while (c < commands.length && commands[c]!.tick === live.tick + 1) batch.push(commands[c++]!.cmd);
      step(live, inputs[i], batch);
    }
    const a = runReplay({ config: { seed: 3, map }, inputs, commands });
    const b = runReplay({ config: { seed: 3, map }, inputs, commands });
    expect(a.finalHash).toBe(hashState(live));
    expect(b.checkpoints).toEqual(a.checkpoints);
    expect(runReplay({ config: { seed: 3, map }, inputs }).finalHash).not.toBe(a.finalHash);
  });
});
