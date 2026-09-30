import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  Mat,
  chunkIndexAt,
  chunkRect,
  classifyMaskPixel,
  cloneState,
  countSolid,
  createGame,
  createTerrain,
  deserializeState,
  fromJson,
  getMat,
  hashState,
  hashTerrain,
  isSolid,
  markDirtyRect,
  recomputeChunk,
  rleDecodeInto,
  rleEncode,
  serializeState,
  step,
  takeDirtyChunks,
  terrainFromMaterials,
  terrainFromRgba,
  toJson,
  type MapSpec,
} from '../src/index.js';

/** Synthetic 1920×696 map: flat ground below y=500, a rock block, a floating ledge. */
function makeMap(): MapSpec {
  const width = 1920;
  const height = 696;
  const mat = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m: number = y >= 500 ? Mat.SOIL : Mat.AIR;
      if (x >= 900 && x < 1000 && y >= 560 && y < 640) m = Mat.ROCK;
      if (x >= 300 && x < 500 && y >= 300 && y < 320) m = Mat.SOIL;
      mat[y * width + x] = m;
    }
  }
  return { width, height, mat, waterY: 640 };
}

describe('terrain basics', () => {
  it('creates partial edge chunks for non-multiple-of-64 sizes (classic 1920×696)', () => {
    const t = createTerrain(1920, 696);
    expect(t.chunksX).toBe(30);
    expect(t.chunksY).toBe(11); // 696/64 = 10.875
    const last = chunkRect(t, t.chunksX * t.chunksY - 1);
    expect(last).toEqual({ x0: 1856, y0: 640, x1: 1919, y1: 695 });
    expect(() => createTerrain(0, 10)).toThrow();
    expect(() => createTerrain(10.5, 10)).toThrow();
  });

  it('reads materials and treats outside the map as air', () => {
    const map = makeMap();
    const t = terrainFromMaterials(map.width, map.height, map.mat);
    expect(getMat(t, 10, 10)).toBe(Mat.AIR);
    expect(getMat(t, 10, 600)).toBe(Mat.SOIL);
    expect(getMat(t, 950, 600)).toBe(Mat.ROCK);
    expect(isSolid(t, 400, 310)).toBe(true);
    expect(isSolid(t, -1, 600)).toBe(false);
    expect(isSolid(t, 1920, 600)).toBe(false);
    expect(isSolid(t, 5, 696)).toBe(false);
  });

  it('keeps per-chunk solid counts consistent with the bitmap', () => {
    const map = makeMap();
    const t = terrainFromMaterials(map.width, map.height, map.mat);
    let expected = 0;
    for (const m of t.mat) if (m !== Mat.AIR) expected++;
    expect(countSolid(t)).toBe(expected);
    expect(t.chunkSolid[chunkIndexAt(t, 5, 5)]).toBe(0);
    expect(t.chunkSolid[chunkIndexAt(t, 5, 600)]).toBe(CHUNK_SIZE * CHUNK_SIZE);
  });

  it('rejects wrong-sized or invalid material data', () => {
    expect(() => terrainFromMaterials(4, 4, new Uint8Array(15))).toThrow();
    expect(() => terrainFromMaterials(2, 1, [0, 9])).toThrow();
  });

  it('classifies mask colours: transparent → air, grey → rock, other → soil', () => {
    expect(classifyMaskPixel(255, 255, 255, 0)).toBe(Mat.AIR);
    expect(classifyMaskPixel(128, 128, 128, 255)).toBe(Mat.ROCK);
    expect(classifyMaskPixel(135, 122, 130, 255)).toBe(Mat.ROCK);
    expect(classifyMaskPixel(200, 150, 90, 255)).toBe(Mat.SOIL);
    expect(classifyMaskPixel(0, 0, 0, 255)).toBe(Mat.SOIL);
    const rgba = new Uint8Array([0, 0, 0, 0, 128, 128, 128, 255, 10, 200, 10, 255]);
    const t = terrainFromRgba(3, 1, rgba);
    expect(Array.from(t.mat)).toEqual([Mat.AIR, Mat.ROCK, Mat.SOIL]);
  });
});

describe('terrain hashing and dirty tracking', () => {
  it('hash changes when a pixel changes (after chunk recompute) and is stable otherwise', () => {
    const map = makeMap();
    const a = terrainFromMaterials(map.width, map.height, map.mat);
    const b = terrainFromMaterials(map.width, map.height, map.mat);
    expect(hashTerrain(a)).toBe(hashTerrain(b));
    b.mat[600 * b.width + 10] = Mat.AIR;
    recomputeChunk(b, chunkIndexAt(b, 10, 600));
    expect(hashTerrain(a)).not.toBe(hashTerrain(b));
  });

  it('marks and drains dirty chunks in ascending order', () => {
    const t = createTerrain(256, 256);
    takeDirtyChunks(t); // initial full upload
    expect(takeDirtyChunks(t)).toEqual([]);
    markDirtyRect(t, 60, 60, 70, 70); // spans 4 chunks
    expect(takeDirtyChunks(t)).toEqual([0, 1, 4, 5]);
    markDirtyRect(t, -50, -50, 1000, 1000); // clipped to map
    expect(takeDirtyChunks(t, 3)).toEqual([0, 1, 2]);
    expect(takeDirtyChunks(t).length).toBe(13);
  });
});

describe('serialisation with typed arrays', () => {
  it('RLE round-trips', () => {
    const a = new Uint8Array([0, 0, 0, 1, 1, 2, 0]);
    const rle = rleEncode(a);
    expect(rle).toEqual([0, 3, 1, 2, 2, 1, 0, 1]);
    const back = new Uint8Array(a.length);
    rleDecodeInto(rle, back);
    expect(Array.from(back)).toEqual(Array.from(a));
    expect(() => rleDecodeInto([1, 10], new Uint8Array(5))).toThrow();
  });

  it('toJson/fromJson preserve typed array types and values compactly', () => {
    const v = { a: new Uint8Array(100000), b: new Uint32Array([1, 2, 4294967295]), c: [1, 'x'] };
    const json = toJson(v);
    expect(json.length).toBeLessThan(200);
    const back = fromJson<typeof v>(json);
    expect(back.a).toBeInstanceOf(Uint8Array);
    expect(back.b).toBeInstanceOf(Uint32Array);
    expect(Array.from(back.b)).toEqual([1, 2, 4294967295]);
    expect(back.c).toEqual([1, 'x']);
  });

  it('a full game state with a 1920×696 map serialises small and restores exactly', () => {
    const s = createGame({ seed: 7, map: makeMap() });
    for (let i = 0; i < 100; i++) step(s, 0);
    const json = serializeState(s);
    expect(json.length).toBeLessThan(20_000);
    const back = deserializeState(json);
    expect(back.terrain!.mat).toBeInstanceOf(Uint8Array);
    expect(hashState(back)).toBe(hashState(s));
  });

  it('clone copies the terrain buffer (no shared mutation)', () => {
    const s = createGame({ seed: 7, map: makeMap() });
    const c = cloneState(s);
    c.terrain!.mat[0] = Mat.SOIL;
    expect(s.terrain!.mat[0]).toBe(Mat.AIR);
  });

  it('game hash depends on terrain and water level', () => {
    const map = makeMap();
    const a = hashState(createGame({ seed: 1, map }));
    const b = hashState(createGame({ seed: 1, map: { ...map, waterY: 600 } }));
    const mat2 = Uint8Array.from(map.mat as Uint8Array);
    mat2[0] = Mat.SOIL;
    const c = hashState(createGame({ seed: 1, map: { ...map, mat: mat2 } }));
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
