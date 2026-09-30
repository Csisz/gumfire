import { describe, expect, it } from 'vitest';
import { BIRTHDAY_THEME, noise2, paintTerrain, paintTerrainRect, type TerrainLike } from '../src/terrainPaint.js';

const AIR = 0, SOIL = 1, ROCK = 2;

function box(): TerrainLike {
  // 120×80: soil below y=40, a rock block at x 90..109, y 50..69
  const width = 120, height = 80;
  const mat = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let m = y >= 40 ? SOIL : AIR;
      if (x >= 90 && x < 110 && y >= 50 && y < 70) m = ROCK;
      mat[y * width + x] = m;
    }
  return { width, height, mat };
}

const px = (out: Uint8Array, t: TerrainLike, x: number, y: number) => Array.from(out.subarray((y * t.width + x) * 4, (y * t.width + x) * 4 + 4));

describe('terrain painter', () => {
  const t = box();
  const out = new Uint8Array(t.width * t.height * 4);
  paintTerrain(t, BIRTHDAY_THEME, out);
  const [or, og, ob] = BIRTHDAY_THEME.outline;

  it('leaves air transparent and makes solid pixels opaque', () => {
    expect(px(out, t, 10, 10)[3]).toBe(0);
    for (let y = 40; y < 80; y++) expect(px(out, t, 30, y)[3]).toBe(255);
  });

  it('draws a dark outline on the surface row', () => {
    expect(px(out, t, 30, 40)).toEqual([or, og, ob, 255]);
    expect(px(out, t, 30, 41)).toEqual([or, og, ob, 255]);
  });

  it('puts frosting just under the outline on top surfaces', () => {
    const c = px(out, t, 30, 44).slice(0, 3);
    const frostings = [BIRTHDAY_THEME.frosting, BIRTHDAY_THEME.frostingShade, BIRTHDAY_THEME.drip].map((v) => [...v]);
    expect(frostings).toContainEqual(c);
  });

  it('does not frost deep soil', () => {
    const c = px(out, t, 30, 75).slice(0, 3);
    expect([[...BIRTHDAY_THEME.frosting], [...BIRTHDAY_THEME.frostingShade]]).not.toContainEqual(c);
  });

  it('paints rock with toffee stripes and no frosting', () => {
    const inside = new Set<string>();
    for (let y = 55; y < 65; y++) for (let x = 95; x < 105; x++) inside.add(px(out, t, x, y).slice(0, 3).join(','));
    expect(inside).toEqual(new Set([BIRTHDAY_THEME.rock.join(','), BIRTHDAY_THEME.rockStripe.join(',')]));
  });

  it('partial repaint of a rect matches the full paint exactly (margins are sufficient)', () => {
    const partial = new Uint8Array(out.length);
    paintTerrainRect(t, BIRTHDAY_THEME, partial, 20, 30, 70, 60);
    for (let y = 30; y <= 60; y++) for (let x = 20; x <= 70; x++) expect(px(partial, t, x, y)).toEqual(px(out, t, x, y));
    expect(px(partial, t, 5, 70)[3]).toBe(0); // untouched outside the rect
  });

  it('is deterministic', () => {
    const again = new Uint8Array(out.length);
    paintTerrain(t, BIRTHDAY_THEME, again);
    expect(again).toEqual(out);
    expect(noise2(3, 4)).toBe(noise2(3, 4));
  });

  it('paints a full 1920×696 map fast enough', () => {
    const W = 1920, H = 696;
    const mat = new Uint8Array(W * H);
    for (let i = W * 400; i < mat.length; i++) mat[i] = SOIL;
    const big = new Uint8Array(W * H * 4);
    const t0 = performance.now();
    paintTerrain({ width: W, height: H, mat }, BIRTHDAY_THEME, big);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
