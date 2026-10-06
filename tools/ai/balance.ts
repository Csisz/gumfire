/**
 * Balance report (M19): CPU-vs-CPU matches on generated maps, with per-weapon statistics —
 * how often each weapon was chosen, how much damage the turn did to enemies and to its own
 * side, kills, and how matches went (length, first-mover advantage, crates).
 * `node tools/bench/run.mjs tools/ai/balance.ts [games] [level]`.
 */
import { createGame, step, type GameConfig, type GameState, type SimEvent } from '../../packages/sim/src/index.js';
import { PROPS, WEAPONS } from '../../packages/content/src/index.js';
import { AiPlayer, type AiLevel } from '../../packages/ai/src/index.js';

interface WStat {
  used: number;
  enemyDmg: number;
  selfDmg: number;
  kills: number;
  hits: number;
}

const stats = new Map<string, WStat>();
const stat = (id: string) => {
  let s = stats.get(id);
  if (!s) stats.set(id, (s = { used: 0, enemyDmg: 0, selfDmg: 0, kills: 0, hits: 0 }));
  return s;
};

function config(seed: number): GameConfig {
  const gen = seed % 3 === 2 ? 'cavern' : 'island';
  return {
    seed,
    mapgen: { generator: gen, seed },
    weapons: WEAPONS,
    props: PROPS,
    match: { teams: [{ name: 'A', size: 4 }, { name: 'B', size: 4 }], ruleset: { teamSize: 4, turnSeconds: 45, roundTurns: 64 } },
  };
}

const crates = { health: 0, weapon: 0, utility: 0, collected: 0 };
const deaths = { hp: 0, drowned: 0, lost: 0 };

function game(seed: number, a: AiLevel, b: AiLevel, maxTurns: number) {
  const s: GameState = createGame(config(seed));
  const ais = [new AiPlayer(0, a), new AiPlayer(1, b)];
  let turnWeapon = '';
  let turnTeam = -1;
  let turnHit = false;
  const teamOf = (id: number) => s.characters.find((c) => c.id === id)?.team ?? -1;
  while (s.match!.phase !== 'matchOver' && s.match!.turn <= maxTurns) {
    const ai = ais.find((x) => x.isMyTurn(s)) ?? null;
    const st = ai ? ai.control(s) : { input: 0 };
    if (ai?.thinking) ai.think(Infinity);
    for (const x of ais) if (x !== ai) x.control(s);
    const ev: SimEvent[] = step(s, st.input, st.cmds ?? []);
    for (const e of ev) {
      switch (e.type) {
        case 'TurnStarted':
          turnTeam = e.team;
          turnWeapon = '(none)';
          turnHit = false;
          break;
        case 'ProjectileFired':
        case 'HitscanFired':
        case 'MeleeSwing':
        case 'StrikeCalled':
        case 'UtilityUsed':
          if (turnWeapon === '(none)') {
            turnWeapon = WEAPONS[e.weapon]!.id;
            stat(turnWeapon).used++;
          }
          break;
        case 'ObjectDeployed':
          if (turnWeapon === '(none)') {
            turnWeapon = e.prop;
            stat(turnWeapon).used++;
          }
          break;
        case 'CharacterHit': {
          const w = stat(turnWeapon);
          if (teamOf(e.id) === turnTeam) w.selfDmg += e.damage;
          else {
            w.enemyDmg += e.damage;
            if (!turnHit) w.hits++;
            turnHit = true;
          }
          break;
        }
        case 'CharacterDied':
          deaths[e.reason]++;
          if (teamOf(e.id) !== turnTeam) stat(turnWeapon).kills++;
          break;
        case 'CrateDropped':
          crates[e.kind]++;
          break;
        case 'CrateCollected':
          crates.collected++;
          break;
      }
    }
  }
  return s;
}

const n = Number(process.argv[3] ?? 6);
const first = Number(process.argv[6] ?? 300);
const level = (process.argv[4] ?? 'normal') as AiLevel;
const wins = [0, 0, 0];
let turns = 0, ticks = 0;
for (let i = 0; i < n; i++) {
  const s = game(first + i, level, level, Number(process.argv[5] ?? 300));
  const m = s.match!;
  if (m.phase === 'matchOver' && m.result === 'win') wins[m.winner]!++;
  else wins[2]!++;
  turns += m.turn;
  ticks += s.tick;
  { const hp = [0, 1].map((t) => s.characters.filter((c) => c.team === t && c.state !== 'dead').reduce((k, c) => k + c.hp, 0)); process.stdout.write(`game ${i}: ${m.phase === 'matchOver' ? m.result + ':' + m.winner : 'unfinished'} turns ${m.turn} hp ${hp.join('/')} ${(s.tick / 3600).toFixed(1)} min\n`); }
}
console.log(`\n${level} vs ${level}, ${n} games: first team ${wins[0]}, second ${wins[1]}, other ${wins[2]}; avg ${(turns / n).toFixed(1)} turns, ${(ticks / n / 60 / 60).toFixed(1)} min`);
console.log(`deaths: ${JSON.stringify(deaths)}  crates: ${JSON.stringify(crates)}\n`);
const rows = [...stats.entries()].sort((x, y) => y[1].used - x[1].used);
console.log('weapon'.padEnd(18) + 'used'.padStart(6) + 'enemy/use'.padStart(11) + 'self/use'.padStart(10) + 'kills'.padStart(7) + 'hit%'.padStart(7));
for (const [id, w] of rows) {
  console.log(
    id.padEnd(18) +
      String(w.used).padStart(6) +
      (w.used ? (w.enemyDmg / w.used).toFixed(1) : '-').padStart(11) +
      (w.used ? (w.selfDmg / w.used).toFixed(1) : '-').padStart(10) +
      String(w.kills).padStart(7) +
      (w.used ? Math.round((100 * w.hits) / w.used) + '%' : '-').padStart(7),
  );
}
