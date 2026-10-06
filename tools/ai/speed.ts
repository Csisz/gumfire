import { createGame, step, type GameConfig } from '../../packages/sim/src/index.js';
import { PROPS, WEAPONS } from '../../packages/content/src/index.js';
import { AiPlayer, fork } from '../../packages/ai/src/index.js';
const cfg: GameConfig = { seed: 7, mapgen: { generator: 'island', seed: 7 }, weapons: WEAPONS, props: PROPS, match: { teams: [{ name: 'A', size: 4 }, { name: 'B', size: 4 }], ruleset: { teamSize: 4 } } };
const s = createGame(cfg);
const ais = [new AiPlayer(0, 'normal'), new AiPlayer(1, 'normal')];
const inputs: number[] = []; const cmds: Array<{ tick: number; cmd: unknown }> = [];
while (s.match!.phase !== 'matchOver' && s.tick < 60000) {
  const ai = ais.find((a) => a.isMyTurn(s));
  const st = ai ? ai.control(s) : { input: 0 };
  ai?.think(Infinity);
  for (const c of st.cmds ?? []) cmds.push({ tick: s.tick + 1, cmd: c });
  inputs.push(st.input);
  step(s, st.input, st.cmds ?? []);
}
console.log('ticks', s.tick, 'turns', s.match!.turn);
const t = performance.now();
const r = createGame(cfg);
let ci = 0;
const forks: number[] = [];
for (let i = 0; i < inputs.length; i++) {
  const batch = [];
  while (ci < cmds.length && cmds[ci]!.tick === r.tick + 1) batch.push(cmds[ci++]!.cmd);
  const ev = step(r, inputs[i]!, batch as never);
  if (ev.some((e) => e.type === 'TurnStarted')) { const f0 = performance.now(); fork(r); forks.push(performance.now() - f0); }
}
const dt = performance.now() - t;
console.log('replay ms', dt.toFixed(0), 'ticks/s', ((inputs.length / dt) * 1000).toFixed(0), 'fork ms avg', (forks.reduce((a, b) => a + b, 0) / forks.length).toFixed(2));
