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
