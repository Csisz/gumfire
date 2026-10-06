/**
 * Weapon lab (M19): every attack weapon fired at a lone target on flat ground at several
 * distances, over a lattice of aims, charges and fuses — with the real sim. Independent of how
 * well the CPU plays: it shows what each weapon *can* do (best damage) and how forgiving it is
 * (share of shots that still do real damage). `node tools/bench/run.mjs tools/ai/weaponLab.ts`.
 */
import { CHAR, Mat, SUB, step, createGame, type GameConfig, type GameState } from '../../packages/sim/src/index.js';
import { PROPS, WEAPONS } from '../../packages/content/src/index.js';
import { fork, playScript, shotScript, type Script } from '../../packages/ai/src/index.js';

/** Play the shot and wait for everything to settle (next turn); damage to the foe and to me. */
function run(base: GameState, script: Script, meId: number): { enemyDamage: number; ownDamage: number } {
  const s = fork(base);
  const hp0 = new Map(s.characters.map((c) => [c.id, c.hp]));
  const turn = s.match!.turn;
  playScript(s, script);
  for (let i = 0; i < 1500 && s.match!.turn === turn && s.match!.phase !== 'matchOver'; i++) step(s, 0, []);
  let enemyDamage = 0, ownDamage = 0;
  for (const c of s.characters) {
    const hp1 = c.state === 'dead' || c.state === 'drowning' ? 0 : Math.max(0, c.hp - c.pendingDamage);
    const loss = hp0.get(c.id)! - hp1;
    if (c.id === meId) ownDamage += loss;
    else enemyDamage += loss;
  }
  return { enemyDamage, ownDamage };
}

const W = 1800, H = 640, GROUND = 420;
const mat = new Uint8Array(W * H);
for (let y = GROUND; y < H; y++) for (let x = 0; x < W; x++) mat[y * W + x] = Mat.SOIL;

function base(dist: number, wind: number): GameState {
  const cfg: GameConfig = {
    seed: 1,
    map: { width: W, height: H, waterY: H - 20, mat },
    weapons: WEAPONS,
    props: PROPS,
    wind,
    match: { teams: [{ name: 'A', size: 1 }, { name: 'B', size: 1 }], ruleset: { teamSize: 1, turnSeconds: 90, mines: 0, barrels: 0, crateChance: 0 } },
  };
  const s = createGame(cfg);
  for (let i = 0; i < 400 && s.match!.phase !== 'turnActive'; i++) step(s, 0, []);
  const me = s.characters.find((c) => c.id === s.activeCharacter)!;
  const foe = s.characters.find((c) => c.id !== me.id)!;
  me.body.x = 300 * SUB;
  me.body.y = (GROUND - 12) * SUB;
  foe.body.x = (300 + dist) * SUB;
  foe.body.y = (GROUND - 12) * SUB;
  me.facing = 1;
  for (const t of s.match!.teams) {
    t.ammo = t.ammo.map(() => -1);
    t.turns = 10;
  }
  s.wind = wind;
  for (let i = 0; i < 60; i++) step(s, 0, []);
  return s;
}

const DISTS = [16, 60, 180, 340, 520];
const report: string[] = [];
const t0 = performance.now();
for (let wi = 0; wi < WEAPONS.length; wi++) {
  const states = DISTS.map((d) => base(d, 0));
  const def = states[0]!.weapons[wi]!;
  if (def.category === 'utility' || def.category === 'deploy') continue;
  const cells: string[] = [];
  for (let di = 0; di < DISTS.length; di++) {
    const s = states[di]!;
    if (s.match!.phase !== 'turnActive') {
      cells.push('n/a');
      continue;
    }
    const me = s.characters.find((c) => c.id === s.activeCharacter)!;
    const foe = s.characters.find((c) => c.id !== me.id)!;
    const target = { x: foe.body.x >> 8, y: foe.body.y >> 8 };
    const aims: number[] = [];
    const step5 = CHAR.aimStep * 4; // 6°
    if (def.category === 'strike' || def.category === 'melee') aims.push(0);
    else for (let a = -step5 * 2; a <= CHAR.aimMax - step5; a += step5) aims.push(a);
    const powers = def.instant ? [1] : [0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 1].map((f) => Math.max(1, Math.round(def.chargeTicks * f)));
    const fuses = def.playerFuse ? [1, 2, 3, 4, 5] : [0];
    let best = 0, good = 0, tries = 0, self = 0;
    for (const aim of aims) {
      for (const power of powers) {
        let cellBest = 0, cellSelf = 0;
        for (const fuse of fuses) {
          const { script } = shotScript(me, { weapon: wi, facing: 1, aim, power, fuse, target }, { instant: def.instant, chargeTicks: def.chargeTicks, shots: def.shotsPerTurn, endRetreatAfter: 25 });
          const o = run(s, script, me.id);
          if (o.enemyDamage > cellBest) {
            cellBest = o.enemyDamage;
            cellSelf = o.ownDamage;
          }
        }
        tries++;
        if (cellBest >= 25) good++;
        if (cellBest > best) {
          best = cellBest;
          self = cellSelf;
        }
      }
    }
    cells.push(`${String(best).padStart(3)}${self ? '/' + self : ''} ${Math.round((100 * good) / tries)}%`.padEnd(12));
  }
  report.push(def.id.padEnd(18) + cells.map((c) => c.padStart(13)).join(''));
  console.log(report[report.length - 1]);
}
console.log(`\n${'weapon'.padEnd(18)}${DISTS.map((d) => (d + ' px').padStart(13)).join('')}   (best enemy dmg[/self] · share of shots ≥25)`);
console.log(`${((performance.now() - t0) / 1000).toFixed(0)} s`);
