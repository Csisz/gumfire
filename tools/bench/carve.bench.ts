// Carve benchmark on bundled code (vitest's module transform slows cross-module calls ~10×,
// so perf budgets are measured here, not in unit tests). Run: pnpm bench:carve
import { Mat, carveCircle, terrainFromMaterials, seedRng, nextRange } from '../../packages/sim/src/index.js';

const W = 1920, H = 696;
const mat = new Uint8Array(W * H);
for (let i = W * 300; i < mat.length; i++) mat[i] = Mat.SOIL;
const results: Record<string, number> = {};
for (const r of [20, 48, 100]) {
  const t = terrainFromMaterials(W, H, mat);
  const pristine = { mat: t.mat.slice(), solid: t.chunkSolid.slice(), hash: t.chunkHash.slice() };
  const rng = seedRng(1);
  let total = 0;
  const N = 400;
  for (let k = 0; k < N + 100; k++) {
    // restore untimed, so every carve removes a full disc of soil
    t.mat.set(pristine.mat);
    t.chunkSolid.set(pristine.solid);
    t.chunkHash.set(pristine.hash);
    const x = nextRange(rng, 100, 1800), y = nextRange(rng, 320 + r, 690 - r);
    const t0 = performance.now();
    carveCircle(t, x, y, r);
    if (k >= 100) total += performance.now() - t0; // first 100 = JIT warm-up
  }
  results[`r${r}`] = (total / N) * 1000;
}
for (const [k, v] of Object.entries(results)) console.log(`carve ${k}: ${v.toFixed(0)} µs (fresh soil, every pixel changes)`);
const budget = 200;
if (results.r100! > budget * 2) {
  console.error(`r100 carve exceeds 2× the ${budget} µs budget`);
  process.exitCode = 1;
}
