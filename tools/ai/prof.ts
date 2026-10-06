import { createGame, step, type GameConfig } from '../../packages/sim/src/index.js';
import { PROPS, WEAPONS } from '../../packages/content/src/index.js';
import { evaluate, fork, predictLanding, shotScript } from '../../packages/ai/src/index.js';

const cfg: GameConfig = { seed: 100, mapgen: { generator: 'island', seed: 100 }, weapons: WEAPONS, props: PROPS, match: { teams: [{ name: 'A', size: 4 }, { name: 'B', size: 4 }], ruleset: { teamSize: 4 } } };
const s = createGame(cfg);
while (s.match!.phase !== 'turnActive') step(s, 0, []);
const me = s.characters.find((c) => c.id === s.activeCharacter)!;
let t = performance.now();
for (let i = 0; i < 50; i++) fork(s);
console.log('fork ms', ((performance.now() - t) / 50).toFixed(2), 'map', s.terrain!.width, s.terrain!.height);
for (const id of ['pepper_rocket', 'fizz_grenade', 'jawbreaker']) {
  const wi = s.weapons.findIndex((w) => w.id === id);
  const def = s.weapons[wi]!;
  t = performance.now();
  let n = 0, ticks = 0;
  for (let a = -900; a <= 900; a += 68) for (let p = 5; p <= def.chargeTicks; p += 5) {
    const l = predictLanding(s, me, wi, def, { facing: 1, aim: a, power: p, fuse: 3, dx: 0, target: null });
    n++;
    ticks += l?.ticks ?? 450;
  }
  const dt = performance.now() - t;
  console.log(id, 'predictions', n, 'ms each', (dt / n).toFixed(3), 'µs/tick', ((dt * 1000) / ticks).toFixed(2));
  t = performance.now();
  for (let i = 0; i < 10; i++) {
    const sc = shotScript(me, { weapon: wi, facing: 1, aim: 200, power: 30, fuse: 3, target: null }, { instant: false, chargeTicks: def.chargeTicks, shots: 1, endRetreatAfter: 25 }).script;
    const o = evaluate(s, sc, me.team);
    if (i === 0) console.log('  eval ticks', o.ticks, 'script', sc.length);
  }
  console.log('  playout ms', ((performance.now() - t) / 10).toFixed(1));
}
