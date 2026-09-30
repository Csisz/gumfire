// Physics benchmark on bundled code: 60 bodies thrown into the physics arena at once.
// Plan budget (§8.6): 60 bodies < 0.5 ms per tick. Run: pnpm bench:physics
import { createGame, step, type SimCommand } from '../../packages/sim/src/index.js';
import { arenaMap } from '../../packages/sim/test/helpers.js';

function scenario() {
  const s = createGame({ seed: 7, map: arenaMap() });
  const cmds: SimCommand[] = [];
  for (let k = 0; k < 60; k++) {
    cmds.push({ type: 'debugSpawn', x: 40 + k * 19, y: 80 + ((k * 53) % 250), vx: ((k % 9) - 4) * 500, vy: -((k % 6) * 250), r: 5 + (k % 7) });
  }
  // commands are capped at 32 per tick, so spawn over two ticks
  step(s, 0, cmds.slice(0, 32));
  step(s, 0, cmds.slice(32));
  return s;
}

// warm up the JIT on a throwaway run
{
  const w = scenario();
  for (let i = 0; i < 400; i++) step(w, 0);
}

const s = scenario();
const times: number[] = [];
let awakeTicks = 0;
for (let i = 0; i < 600; i++) {
  const awake = s.bodies.filter((b) => !b.sleeping && b.drownTicks === 0).length;
  const t0 = performance.now();
  step(s, 0);
  const dt = performance.now() - t0;
  if (awake >= 30) {
    times.push(dt);
    awakeTicks++;
  }
}
times.sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
const p95 = times[Math.floor(times.length * 0.95)]!;
console.log(`physics: ${awakeTicks} ticks with ≥30 of 60 bodies awake — mean ${(mean * 1000).toFixed(0)} µs, p95 ${(p95 * 1000).toFixed(0)} µs per tick`);
console.log(`after 600 ticks: ${s.bodies.length} bodies left, ${s.bodies.filter((b) => b.sleeping).length} asleep`);
if (p95 > 1.0) {
  console.error('p95 exceeds 2× the 0.5 ms budget');
  process.exitCode = 1;
}
