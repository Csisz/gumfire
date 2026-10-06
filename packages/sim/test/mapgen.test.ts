import { describe, expect, it } from 'vitest';
import { Hasher, Mat, MapGenError, createGame, generateMap, hashState, step } from '../src/index.js';

const hashMat = (m: ArrayLike<number>) => {
  const h = new Hasher();
  for (let i = 0; i < m.length; i += 7) h.u8(m[i]!);
  return h.digest();
};

describe('map generation', () => {
  it('is deterministic per seed and varies between seeds', () => {
    for (const g of ['island', 'cavern'] as const) {
      const a = generateMap({ generator: g, seed: 42 }), b = generateMap({ generator: g, seed: 42 }), c = generateMap({ generator: g, seed: 43 });
      expect(hashMat(a.spec.mat)).toBe(hashMat(b.spec.mat));
      expect(hashMat(a.spec.mat)).not.toBe(hashMat(c.spec.mat));
    }
  });

  it('islands sit in the water; caverns are framed and flooded at the bottom', () => {
    const i = generateMap({ generator: 'island', seed: 7 }).spec;
    expect([i.width, i.height, i.waterY]).toEqual([2000, 760, 700]);
    for (let y = 0; y < i.waterY; y++) expect(i.mat[y * i.width]).toBe(Mat.AIR); // the far left column is open sea
    const c = generateMap({ generator: 'cavern', seed: 7 }).spec;
    for (let x = 0; x < c.width; x++) expect(c.mat[x]).toBe(Mat.BORDER); // sealed ceiling
    expect(c.mat[(c.waterY - 20) * c.width]).toBe(Mat.BORDER); // walls
    let wet = 0;
    for (let x = 0; x < c.width; x++) if (c.mat[(c.waterY + 10) * c.width + x] === Mat.AIR) wet++;
    expect(wet).toBeGreaterThan(c.width * 0.8);
  });

  it('every map offers enough dry standing spots (20 seeds each; 1,000 in pnpm validate:maps)', () => {
    for (const g of ['island', 'cavern'] as const) {
      for (let seed = 1; seed <= 20; seed++) expect(generateMap({ generator: g, seed }).spots).toBeGreaterThanOrEqual(24);
    }
  });

  it('a match can be configured with a generator: replays carry the seed, not the bitmap', () => {
    const cfg = { seed: 5, mapgen: { generator: 'cavern' as const, seed: 77 }, match: { teams: [{ name: 'A', size: 4 }, { name: 'B', size: 4 }] } };
    const a = createGame(cfg), b = createGame(cfg);
    expect(a.terrain!.width).toBe(2000);
    expect(a.characters).toHaveLength(8);
    for (let i = 0; i < 300; i++) {
      step(a, 0);
      step(b, 0);
    }
    expect(hashState(a)).toBe(hashState(b));
    expect(() => generateMap({ generator: 'volcano' as never, seed: 1 })).toThrow(MapGenError);
  });
});
