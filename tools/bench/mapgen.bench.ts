// Map generator validation + timing on bundled code: N seeds per generator must all produce a
// playable map (generateMap throws otherwise) within the 300 ms budget. Run: pnpm validate:maps [N]
import { generateMap, type MapGenerator } from '../../packages/sim/src/index.js';

const N = Number(process.argv[3] ?? process.env.MAPS ?? 1000);
let failed = 0;
for (const generator of ['island', 'cavern'] as MapGenerator[]) {
  let worst = 0, total = 0, retries = 0;
  for (let seed = 1; seed <= N; seed++) {
    const t0 = performance.now();
    try {
      const m = generateMap({ generator, seed });
      retries += m.attempts - 1;
    } catch (e) {
      failed++;
      console.error(`${generator} seed ${seed}: ${(e as Error).message}`);
    }
    const ms = performance.now() - t0;
    total += ms;
    worst = Math.max(worst, ms);
  }
  console.log(`${generator}: ${N} seeds, avg ${(total / N).toFixed(1)} ms, worst ${worst.toFixed(1)} ms, regenerations ${retries}`);
  if (worst > 300) {
    console.error(`${generator}: worst map ${worst.toFixed(0)} ms exceeds the 300 ms budget`);
    failed++;
  }
}
if (failed) process.exit(1);
