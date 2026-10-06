import { describe, expect, it } from 'vitest';
import { Btn, CHAR, createGame, hashState, runReplay, step, type GameConfig, type GameState, type InputFrame, type TimedCommand } from '@gumfire/sim';
import { PROPS, WEAPONS } from '@gumfire/content';
import { AiPlayer, aimSteps, planTurn, type AiLevel } from '../src/index';

function config(seed: number, turnSeconds = 30): GameConfig {
  return {
    seed,
    mapgen: { generator: 'island', seed },
    weapons: WEAPONS,
    props: PROPS,
    match: { teams: [{ name: 'A', size: 3 }, { name: 'B', size: 3 }], ruleset: { teamSize: 3, turnSeconds, mines: 0, barrels: 0, crateChance: 0 } },
  };
}

/** Run a match where `ais[team]` plays each team (null = a player who never touches the keys). */
function play(cfg: GameConfig, ais: Array<AiPlayer | null>, maxTurns: number) {
  const s = createGame(cfg);
  const inputs: InputFrame[] = [];
  const commands: TimedCommand[] = [];
  const t0 = Date.now();
  while (s.match!.phase !== 'matchOver' && s.match!.turn <= maxTurns) {
    let input = 0;
    for (const ai of ais) {
      if (!ai || !ai.isMyTurn(s)) continue;
      const st = ai.control(s);
      ai.think(Infinity);
      input = st.input;
      for (const c of st.cmds ?? []) commands.push({ tick: s.tick + 1, cmd: c });
      step(s, input, st.cmds ?? []);
      inputs.push(input);
      input = -1;
      break;
    }
    if (input === -1) continue;
    for (const ai of ais) ai?.control(s);
    step(s, 0, []);
    inputs.push(0);
  }
  return { s, inputs, commands, ms: Date.now() - t0 };
}

const teamHp = (s: GameState, team: number) => s.characters.filter((c) => c.team === team && c.state !== 'dead').reduce((a, c) => a + c.hp, 0);

describe('ai: scripts', () => {
  it('aim frames reach the aim the sim computes', () => {
    for (const [from, to] of [[0, 400], [0, -900], [170, 171 + 17 * 20], [-1024, 1024], [500, 500 - 17 * 3]] as const) {
      const r = aimSteps(from, to);
      // replay through a real character
      const s = createGame({ ...config(3), match: { teams: [{ name: 'A', size: 1 }, { name: 'B', size: 1 }], ruleset: { teamSize: 1, mines: 0, barrels: 0, crateChance: 0 } } });
      while (s.match!.phase !== 'turnActive') step(s, 0, []);
      const c = s.characters.find((x) => x.id === s.activeCharacter)!;
      c.aim = from;
      for (const st of r.steps) step(s, st.input, []);
      expect(c.aim).toBe(r.aim);
      expect(Math.abs(r.aim - Math.max(-CHAR.aimMax, Math.min(CHAR.aimMax, to)))).toBeLessThanOrEqual(CHAR.aimStep);
    }
    expect(Btn.Up).toBeGreaterThan(0);
  });
});

describe('ai: playing', () => {
  for (const level of ['easy', 'normal', 'hard'] as AiLevel[]) {
    it(`${level} AI hurts a team that does nothing`, () => {
      const r = play(config(11), [new AiPlayer(0, level), null], 6);
      const dealt = 300 - teamHp(r.s, 1);
      const own = 300 - teamHp(r.s, 0);
      expect(dealt).toBeGreaterThan(level === 'easy' ? 20 : 60);
      expect(own).toBeLessThan(dealt);
    }, 120_000);
  }

  it('with alliances the AI spares its allies', () => {
    const cfg: GameConfig = {
      ...config(17),
      match: { teams: [{ name: 'A1', size: 2, side: 0 }, { name: 'B1', size: 2, side: 1 }, { name: 'A2', size: 2, side: 0 }, { name: 'B2', size: 2, side: 1 }], ruleset: { teamSize: 2, turnSeconds: 30, mines: 0, barrels: 0, crateChance: 0 } },
    };
    const r = play(cfg, [new AiPlayer(0, 'normal'), null, new AiPlayer(2, 'normal'), null], 8);
    const sideHp = (side: number) => r.s.characters.filter((c) => r.s.match!.teams[c.team]!.side === side && c.state !== 'dead').reduce((a, c) => a + c.hp, 0);
    expect(400 - sideHp(1)).toBeGreaterThan(40);
    expect(400 - sideHp(0)).toBeLessThan(400 - sideHp(1));
  }, 120_000);

  it('AI turns replay exactly from the recorded inputs', () => {
    const cfg = config(5);
    const r = play(cfg, [new AiPlayer(0, 'normal'), new AiPlayer(1, 'easy')], 4);
    const rep = runReplay({ config: cfg, inputs: r.inputs, commands: r.commands });
    expect(rep.finalHash).toBe(hashState(r.s));
  }, 120_000);
});

describe('ai: planning elsewhere', () => {
  it('plays a plan made by a remote planner (the client uses a worker)', async () => {
    const cfg = config(21);
    const s = createGame(cfg);
    const ai = new AiPlayer(0, 'easy', 0);
    let calls = 0;
    ai.remote = (state, level) => {
      calls++;
      const g = planTurn(state, level);
      let r = g.next();
      while (!r.done) r = g.next();
      return Promise.resolve(r.value);
    };
    while (!ai.isMyTurn(s) || s.match!.phase !== 'turnActive') step(s, 0, []);
    const turn = s.match!.turn;
    ai.control(s);
    expect(ai.thinking).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(ai.thinking).toBe(false);
    let fired = false;
    for (let i = 0; i < 2000 && s.match!.turn === turn; i++) {
      const st = ai.control(s);
      const ev = step(s, st.input, st.cmds ?? []);
      if (ev.some((e) => e.type === 'ProjectileFired' || e.type === 'MeleeSwing')) fired = true;
    }
    expect(calls).toBe(1);
    expect(fired).toBe(true);
  }, 60_000);
});
