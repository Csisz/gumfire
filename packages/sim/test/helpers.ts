import { Mat, type MapSpec } from '../src/index.js';

/**
 * Physics test arena, 1280×640, water at y=620:
 * - flat floor: soil from y=500 down (x 0..1279)
 * - 1 px wall: x=700, y 300..499
 * - 45° slope: rises from (900, 499) to (1100, 299), solid below the line
 * - gentle slope (~10°): from (100, 499) up to (400, 446)
 * - pit into the water: x 1180..1279 has no floor
 */
export function arenaMap(): MapSpec {
  const width = 1280, height = 640;
  const mat = new Uint8Array(width * height);
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) mat[y * width + x] = Mat.SOIL;
  };
  for (let x = 0; x < 1180; x++) for (let y = 500; y < height; y++) set(x, y);
  for (let y = 300; y < 500; y++) set(700, y);
  for (let x = 900; x <= 1100; x++) for (let y = 499 - (x - 900); y < 500; y++) set(x, y);
  for (let x = 100; x <= 400; x++) {
    const top = Math.round(499 - ((x - 100) * 53) / 300);
    for (let y = top; y < 500; y++) set(x, y);
  }
  return { width, height, mat, waterY: 620 };
}

/**
 * Character test arena, 1280×640, water at y=620. Ground surface = first solid row.
 * - x    0..299: floor, surface y=500
 * - x  300..399: step up 6 px  (surface 494) — walkable
 * - x  400..499: step up 10 more (surface 484) — too high: a round body climbs vertical
 *   steps up to its radius (9 px), not more
 * - x  500..599: floor 500
 * - x  600..799: plateau, surface 300 (a 200 px wall on its left, a 200 px drop on its right)
 * - x  800..999: floor 500
 * - x 1000..1059: pit down to the water (no floor)
 * - x 1060..1279: floor 500, with a low ledge x 1100..1279 at surface 470 (30 px)
 * - a steep 70° ramp x 520..560 rising to the right from 500 to ~390
 */
export function charArenaMap(): MapSpec {
  const width = 1280, height = 640;
  const mat = new Uint8Array(width * height);
  const fill = (x0: number, x1: number, top: number) => {
    for (let x = x0; x <= x1; x++) for (let y = top; y < height; y++) mat[y * width + x] = Mat.SOIL;
  };
  fill(0, 299, 500);
  fill(300, 399, 494);
  fill(400, 499, 484);
  fill(500, 599, 500);
  fill(600, 799, 300);
  fill(800, 999, 500);
  fill(1060, 1279, 500);
  fill(1100, 1279, 470);
  for (let x = 520; x <= 560; x++) fill(x, x, Math.round(500 - (x - 520) * 2.75));
  return { width, height, mat, waterY: 620 };
}
