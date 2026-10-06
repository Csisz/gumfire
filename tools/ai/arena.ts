/**
 * AI arena: pit AI levels against each other (or a team that does nothing) on generated maps
 * and print what happened. `node tools/bench/run.mjs tools/ai/arena.ts [games]`.
 */
import { createGame, step, type GameConfig, type GameState } from '../../packages/sim/src/index.js';
import { PROPS, WEAPONS } from '../../packages/content/src/index.js';
import { AiPlayer, type AiLevel } from '../../packages/ai/src/index.js';

function config(seed: number): GameConfig {
  return {
    seed,
    mapgen: { generator: seed % 3 === 2 ? 'cavern' : 'island', seed },
    weapons: WEAPONS,
    props: PROPS,
    match: { teams: [{ name: 'A', size: 4 }, { name: 'B', size: 4 }], ruleset: { teamSize: 4, turnSeconds: 45 } },
  };
}

function game(seed: number, a: AiLevel | null, b: AiLevel | null, maxTurns: number) {
  const s: GameState = createGame(config(seed));
  const ais = [a ? new AiPlayer(0, a) : null, b ? new AiPlayer(1, b) : null];
  let thinkMs = 0, plans = 0, worst = 0;
  const log: string[] = [];
  while (s.match!.phase !== 'matchOver' && s.match!.turn <= maxTurns) {
    const ai = ais.find((x) => x?.isMyTurn(s)) ?? null;
    const st = ai ? ai.control(s) : { input: 0 };
    if (ai?.thinking) {
      const t = performance.now();
      ai.think(Infinity);
      const dt = performance.now() - t;
      thinkMs += dt;
      worst = Math.max(worst, dt);
      plans++;
      log.push(`t${s.match!.turn} ${ai.level}: ${ai.lastPlan?.label} score ${ai.lastPlan?.score.toFixed(0)} (${dt.toFixed(0)} ms)`);
    }
    for (const x of ais) if (x && x !== ai) x.control(s);
    step(s, st.input, st.cmds ?? []);
  }
  const hp = (t: number) => s.characters.filter((c) => c.team === t && c.state !== 'dead').reduce((n, c) => n + c.hp, 0);
  return { s, hp: [hp(0), hp(1)], thinkMs, plans, worst, log };
}

const n = Number(process.argv[3] ?? 3);
const pairs: Array<[AiLevel | null, AiLevel | null]> = [['easy', null], ['normal', null], ['hard', null], ['hard', 'easy'], ['hard', 'normal'], ['normal', 'easy']];
for (const [a, b] of pairs) {
  const wins = [0, 0, 0];
  let think = 0, plans = 0, worst = 0;
  for (let i = 0; i < n; i++) {
    const g = game(100 + i, a, b, b ? 60 : 8);
    const m = g.s.match!;
    if (m.phase === 'matchOver' && m.result === 'win') wins[m.winner]!++;
    else wins[2]!++;
    think += g.thinkMs;
    plans += g.plans;
    worst = Math.max(worst, g.worst);
    if (i === 0) console.log(g.log.slice(0, 8).join('\n'));
    console.log(`  game ${i}: hp ${g.hp.join(' vs ')} turns ${m.turn} ${m.phase === 'matchOver' ? m.result + ':' + m.winner : 'unfinished'}`);
  }
  console.log(`${a} vs ${b ?? 'idle'}: wins ${wins[0]}–${wins[1]} (other ${wins[2]}), think avg ${(think / Math.max(1, plans)).toFixed(0)} ms, worst ${worst.toFixed(0)} ms\n`);
}
