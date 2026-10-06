import { describe, expect, it } from 'vitest';
import {
  Btn,
  CHAR,
  RulesetError,
  compileRuleset,
  createGame,
  charPx,
  hashState,
  isSolid,
  step,
  type GameState,
  type InputFrame,
  type RulesetJson,
  type SimCommand,
  type SimEvent,
  type TeamConfig,
  type WeaponJson,
} from '../src/index.js';
import { ROCKET_JSON, rangeMap } from './helpers.js';

const FLOOR = 700;
const standY = FLOOR - CHAR.radius - 1;
const spawn = (...xs: number[]) => xs.map((x) => ({ x, y: standY }));

/** Fast defaults so tests stay short: 2 s turns, 1 s retreat, short prep/reveal. */
const QUICK: RulesetJson = { turnSeconds: 2, retreatSeconds: 1, turnPrepSeconds: 0.2, revealSeconds: 0.2 };

function game(teams: TeamConfig[], ruleset: RulesetJson = {}, seed = 11, weapons: WeaponJson[] = [ROCKET_JSON]): GameState {
  return createGame({ seed, map: rangeMap(), weapons, match: { teams, ruleset: { ...QUICK, ...ruleset } } });
}

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const ofType = <T extends SimEvent['type']>(ev: SimEvent[], type: T) => ev.filter((e) => e.type === type) as Ev<T>[];

/** Step with `input` until `until(state, eventsThisTick)` holds (or `max` ticks). */
function runUntil(
  s: GameState,
  until: (s: GameState, ev: SimEvent[]) => boolean,
  opts: { input?: InputFrame | ((s: GameState) => InputFrame); max?: number; log?: SimEvent[]; cmds?: SimCommand[] } = {},
): SimEvent[] {
  const log = opts.log ?? [];
  for (let i = 0; i < (opts.max ?? 3000); i++) {
    const inp = typeof opts.input === 'function' ? opts.input(s) : (opts.input ?? 0);
    const ev = step(s, inp, i === 0 ? (opts.cmds ?? []) : []);
    log.push(...ev);
    if (until(s, ev)) return log;
  }
  throw new Error(`condition not reached; phase=${s.match?.phase} turn=${s.match?.turn}`);
}
const phaseIs = (p: string) => (s: GameState) => s.match!.phase === p;
const active = (s: GameState) => s.characters.find((c) => c.id === s.activeCharacter)!;

describe('ruleset', () => {
  it('compiles seconds to ticks with plan defaults and rejects bad values', () => {
    const r = compileRuleset();
    expect(r).toMatchObject({ hp: 100, teamSize: 4, turnTicks: 45 * 50, retreatTicks: 150, roundTicks: 15 * 60 * 50, suddenDeath: 'both', waterRise: 20 });
    expect(compileRuleset({ turnSeconds: 1.5 }).turnTicks).toBe(75);
    expect(() => compileRuleset({ hp: 0 })).toThrow(RulesetError);
    expect(() => compileRuleset({ suddenDeath: 'lava' as never })).toThrow(/suddenDeath/);
    expect(() => compileRuleset({ turnSeconds: Number.NaN })).toThrow(/turnSeconds/);
  });
});

describe('match setup', () => {
  it('creates the teams, interleaves ids, applies the ruleset hp and hands reveals to the turn system', () => {
    const s = game([{ name: 'Sour', spawns: spawn(300, 400) }, { name: 'Sweet', spawns: spawn(1200, 1300) }], { hp: 150 });
    const m = s.match!;
    expect(m.teams.map((t) => [t.name, t.characterIds])).toEqual([['Sour', [1, 3]], ['Sweet', [2, 4]]]);
    expect(s.characters.map((c) => [c.id, c.team, c.hp])).toEqual([[1, 0, 150], [2, 1, 150], [3, 0, 150], [4, 1, 150]]);
    expect([...m.order].sort()).toEqual([0, 1]);
    expect(s.autoReveal).toBe(false);
    expect(() => game([{ name: 'solo', size: 2 }])).toThrow(/2..6 teams/);
  });

  it('random placement: on dry ground, spaced out, seeded', () => {
    const teams = [{ name: 'A', size: 4 }, { name: 'B', size: 4 }, { name: 'C', size: 4 }];
    const a = game(teams, {}, 5), b = game(teams, {}, 5), c = game(teams, {}, 6);
    const pos = (s: GameState) => s.characters.map((ch) => [charPx(ch), ch.body.y >> 8]);
    expect(pos(a)).toEqual(pos(b));
    expect(pos(a)).not.toEqual(pos(c));
    const t = a.terrain!;
    for (const [x, y] of pos(a) as [number, number][]) {
      expect(isSolid(t, x, y + CHAR.radius + 1)).toBe(true); // standing on the floor
      expect(y).toBeLessThan(780 - 60);
      expect(x).toBeLessThan(2200); // not over the pit
    }
    const p = pos(a) as [number, number][];
    for (let i = 0; i < p.length; i++)
      for (let j = i + 1; j < p.length; j++) expect(Math.hypot(p[i]![0] - p[j]![0], p[i]![1] - p[j]![1])).toBeGreaterThanOrEqual(40);
  });
});

describe('turn flow', () => {
  it('prep → active → timeout → settle → next team; teams alternate, rosters rotate', () => {
    const s = game([{ name: 'A', spawns: spawn(300, 400) }, { name: 'B', spawns: spawn(1200, 1300) }]);
    const log = runUntil(s, (st) => st.match!.turn === 5);
    const starts = ofType(log, 'TurnStarted');
    const first = s.match!.order[0]!;
    const other = 1 - first;
    const roster = (team: number) => s.match!.teams[team]!.characterIds;
    expect(starts.map((e) => [e.team, e.id])).toEqual([
      [first, roster(first)[0]],
      [other, roster(other)[0]],
      [first, roster(first)[1]],
      [other, roster(other)[1]],
      [first, roster(first)[0]],
    ]);
    expect(ofType(log, 'ControlEnded').map((e) => e.reason)).toEqual(['timeout', 'timeout', 'timeout', 'timeout']);
    // phase order of one turn
    const phases = ofType(log, 'TurnPhaseChanged').filter((e) => e.turn === 2).map((e) => e.phase);
    expect(phases).toEqual(['turnActive', 'settling', 'turnPrep']);
    // a timed-out turn lasts exactly the turn time
    const act = ofType(log, 'TurnPhaseChanged').filter((e) => e.turn === 1);
    expect(act[1]!.tick - act[0]!.tick).toBe(100);
  });

  it('only the active character moves, and only once the turn is active', () => {
    const s = game([{ name: 'A', spawns: spawn(300) }, { name: 'B', spawns: spawn(1200) }]);
    const x0 = s.characters.map(charPx);
    runUntil(s, phaseIs('turnActive'), { input: Btn.Right });
    expect(s.characters.map(charPx)).toEqual(x0); // prep: nobody walks
    for (let i = 0; i < 30; i++) step(s, Btn.Right);
    const moved = s.characters.map((c, i) => charPx(c) - x0[i]!);
    const a = s.activeCharacter;
    expect(moved[a - 1]).toBeGreaterThan(20);
    expect(moved[2 - a]).toBe(0);
  });

  it('a turn-ending shot starts the retreat: walk on, no second shot, End Turn ends it early', () => {
    const s = game([{ name: 'A', spawns: spawn(300) }, { name: 'B', spawns: spawn(1500) }]);
    runUntil(s, phaseIs('turnActive'));
    const me = s.activeCharacter;
    const log = runUntil(s, phaseIs('retreat'), { input: Btn.Fire }); // full charge fires by itself
    expect(ofType(log, 'RetreatStarted')).toEqual([expect.objectContaining({ id: me, ticks: 50 })]);
    const x = charPx(active(s));
    const more: SimEvent[] = [];
    for (let i = 0; i < 20; i++) more.push(...step(s, i % 2 ? Btn.Fire | Btn.Right : Btn.Right));
    expect(ofType(more, 'ProjectileFired')).toHaveLength(0);
    expect(charPx(active(s))).toBeGreaterThan(x + 10);
    const end = runUntil(s, phaseIs('settling'), { input: (st) => (st.tick % 2 ? Btn.EndTurn : 0) });
    expect(ofType(end, 'ControlEnded')).toEqual([expect.objectContaining({ id: me, reason: 'endTurn' })]);
    expect(s.match!.phaseTicks).toBe(0);
  });

  it('weapon selection is refused after the shot', () => {
    const heavy: WeaponJson = { ...ROCKET_JSON, id: 'heavy', projectile: { ...ROCKET_JSON.projectile, windFactor: 0 } };
    const s = game([{ name: 'A', spawns: spawn(300) }, { name: 'B', spawns: spawn(1500) }], {}, 11, [ROCKET_JSON, heavy]);
    runUntil(s, phaseIs('turnActive'));
    step(s, 0, [{ type: 'selectWeapon', index: 1 }]);
    expect(active(s).weapon).toBe(1);
    runUntil(s, phaseIs('retreat'), { input: Btn.Fire });
    step(s, 0, [{ type: 'selectWeapon', index: 0 }]);
    expect(active(s).weapon).toBe(1);
  });

  it('the retreat overlaps the flight; damage is revealed after everything settles, then the next turn', () => {
    // A long lob from x=300 lands near the enemy at ~1580 after the 1 s retreat is over
    const s = game([{ name: 'A', spawns: spawn(300) }, { name: 'B', spawns: spawn(1580) }]);
    runUntil(s, phaseIs('turnActive'));
    const shooterTeam = s.match!.activeTeam;
    if (active(s).id !== 1) {
      // B plays first: let its turn time out, then A shoots
      runUntil(s, (st) => st.match!.phase === 'turnActive' && st.activeCharacter === 1);
    }
    expect(s.match!.activeTeam === shooterTeam || s.activeCharacter === 1).toBe(true);
    step(s, 0, [{ type: 'debugSetWind', wind: 0 }]); // every turn rerolls the wind
    for (let i = 0; i < 21; i++) step(s, Btn.Up); // 12×1.5° + 9×3° = 45°
    const log = runUntil(s, (st) => st.match!.phase === 'turnPrep', { input: Btn.Fire });
    const tick = (type: SimEvent['type']) => log.find((e) => e.type === type)!.tick;
    expect(tick('RetreatStarted')).toBeLessThan(tick('ControlEnded'));
    expect(tick('ControlEnded')).toBeLessThan(tick('Exploded')); // still flying when the retreat ends
    const hits = ofType(log, 'CharacterHit').filter((h) => h.id === 2);
    expect(hits.length).toBeGreaterThan(0);
    const dmg = ofType(log, 'CharacterDamaged');
    expect(dmg[0]!.tick).toBeGreaterThan(tick('Exploded'));
    expect(ofType(log, 'TurnPhaseChanged').map((e) => e.phase)).toEqual(['retreat', 'settling', 'damageReveal', 'turnPrep']);
    expect(s.characters[1]!.hp).toBe(100 - hits.reduce((a, h) => a + h.damage, 0));
  });

  it('control ends at once when the active character hurts itself', () => {
    // point-blank into the 1 px wall at x=500
    const s = game([{ name: 'A', spawns: spawn(488) }, { name: 'B', spawns: spawn(1500) }]);
    runUntil(s, (st) => st.match!.phase === 'turnActive' && st.activeCharacter === 1);
    const log = runUntil(s, phaseIs('settling'), { input: (st) => (st.match!.phase === 'turnActive' && st.tick % 2 ? Btn.Fire : 0) });
    expect(ofType(log, 'ControlEnded')).toEqual([expect.objectContaining({ id: 1, reason: 'damage' })]);
  });

  it('walking into the water ends control and costs the character', () => {
    const s = game([{ name: 'A', spawns: spawn(2185, 300) }, { name: 'B', spawns: spawn(1500) }]);
    runUntil(s, (st) => st.match!.phase === 'turnActive' && st.activeCharacter === 1);
    const log = runUntil(s, phaseIs('turnPrep'), { input: Btn.Right });
    expect(ofType(log, 'ControlEnded')).toEqual([expect.objectContaining({ id: 1, reason: 'water' })]);
    expect(ofType(log, 'CharacterDied')).toEqual([expect.objectContaining({ id: 1, reason: 'drowned' })]);
    expect(s.match!.result).toBe('none'); // the team has another character
  });

  it('dead characters are skipped in the rotation', () => {
    const s = game([{ name: 'A', spawns: spawn(300, 400, 500) }, { name: 'B', spawns: spawn(1200) }]);
    s.characters.find((c) => c.id === 3)!.state = 'dead'; // A's second character
    const log = runUntil(s, (st) => st.match!.turn === 5);
    const aTurns = ofType(log, 'TurnStarted').filter((e) => e.team === 0).map((e) => e.id);
    expect(aTurns).not.toContain(3);
    expect(aTurns.slice(0, 2)).toEqual([1, 4]);
  });

  it('free character select lets the player switch before shooting; sequential ignores it', () => {
    const free = game([{ name: 'A', spawns: spawn(300, 400) }, { name: 'B', spawns: spawn(1200, 1300) }], { characterSelect: 'free' });
    runUntil(free, phaseIs('turnActive'));
    const before = free.activeCharacter;
    step(free, 0, [{ type: 'nextCharacter' }]);
    expect(free.activeCharacter).not.toBe(before);
    expect(free.characters.find((c) => c.id === free.activeCharacter)!.team).toBe(free.match!.activeTeam);
    const seq = game([{ name: 'A', spawns: spawn(300, 400) }, { name: 'B', spawns: spawn(1200, 1300) }]);
    runUntil(seq, phaseIs('turnActive'));
    const cur = seq.activeCharacter;
    step(seq, 0, [{ type: 'nextCharacter' }, { type: 'debugSelect', id: cur === 1 ? 2 : 1 }]);
    expect(seq.activeCharacter).toBe(cur);
  });
});

describe('victory, draw, sudden death', () => {
  it('the last team standing wins', () => {
    const s = game([{ name: 'A', spawns: spawn(300) }, { name: 'B', spawns: spawn(340) }]);
    runUntil(s, phaseIs('turnActive'));
    const victim = s.characters.find((c) => c.id !== s.activeCharacter)!;
    victim.hp = 5;
    const log = runUntil(s, phaseIs('matchOver'), { cmds: [{ type: 'debugExplode', x: charPx(victim) + 20, y: standY, r: 30, damage: 30, knockback: 0 }] });
    const shooter = s.characters.find((c) => c.id !== victim.id)!;
    expect(ofType(log, 'MatchEnded')).toEqual([expect.objectContaining({ result: 'win', winner: shooter.team })]);
    expect(s.match!.winner).toBe(shooter.team);
    expect(s.activeCharacter).toBe(0);
    // the match stays over; nobody is controlled any more
    const x = charPx(shooter);
    for (let i = 0; i < 100; i++) step(s, Btn.Right);
    expect(s.match!.phase).toBe('matchOver');
    expect(charPx(shooter)).toBe(x);
  });

  it('everybody dying in the same resolution is a draw', () => {
    const s = game([{ name: 'A', spawns: spawn(300) }, { name: 'B', spawns: spawn(330) }]);
    runUntil(s, phaseIs('turnActive'));
    for (const c of s.characters) c.hp = 5;
    const log = runUntil(s, phaseIs('matchOver'), { cmds: [{ type: 'debugExplode', x: 315, y: standY, r: 40, damage: 40, knockback: 0 }] });
    expect(ofType(log, 'MatchEnded')).toEqual([expect.objectContaining({ result: 'draw', winner: -1 })]);
  });

  it('round time counts only during turns; at zero sudden death drops hp to 1 and raises the water each turn', () => {
    const s = game([{ name: 'A', spawns: spawn(300) }, { name: 'B', spawns: spawn(1200) }], { roundSeconds: 3 });
    const log = runUntil(s, (st) => st.match!.turn === 4);
    // turns 1 and 2 time out after 2 s each: the round clock (3 s) runs out during turn 2
    expect(ofType(log, 'SuddenDeath')).toEqual([expect.objectContaining({ mode: 'both' })]);
    const sd = ofType(log, 'SuddenDeath')[0]!;
    expect(ofType(log, 'TurnStarted').filter((e) => e.tick < sd.tick)).toHaveLength(2);
    for (const c of s.characters) expect(c.hp).toBe(1);
    expect(ofType(log, 'WaterRose').map((e) => e.y)).toEqual([760, 740]);
    expect(s.waterY).toBe(740);
  });

  it('a turn limit starts sudden death too, even with round time left (M19)', () => {
    const s = game([{ name: 'A', spawns: spawn(300) }, { name: 'B', spawns: spawn(1200) }], { roundSeconds: 900, roundTurns: 3 });
    const log = runUntil(s, (st) => st.match!.turn === 5);
    const sd = ofType(log, 'SuddenDeath')[0]!;
    expect(sd).toBeDefined();
    // turns 1, 2, 3 were played before it
    expect(ofType(log, 'TurnStarted').filter((e) => e.tick < sd.tick)).toHaveLength(3);
    for (const c of s.characters) expect(c.hp).toBe(1);
    expect(s.match!.roundTicksLeft).toBeGreaterThan(0);
  });

  it("sudden death 'roundEnds' gives the win to the team with more hp", () => {
    const s = game([{ name: 'A', spawns: spawn(300) }, { name: 'B', spawns: spawn(1200) }], { roundSeconds: 1, suddenDeath: 'roundEnds' });
    s.characters[1]!.hp = 60;
    const log = runUntil(s, phaseIs('matchOver'));
    expect(ofType(log, 'MatchEnded')).toEqual([expect.objectContaining({ result: 'win', winner: 0 })]);
  });

  it('alliances: sides alternate turns and allies win together', () => {
    const s = game(
      [
        { name: 'A1', side: 0, spawns: spawn(200) },
        { name: 'A2', side: 0, spawns: spawn(500) },
        { name: 'B1', side: 1, spawns: spawn(800) },
        { name: 'B2', side: 1, spawns: spawn(1100) },
      ],
      {},
      5,
    );
    const m = s.match!;
    expect(m.teams.map((t) => t.side)).toEqual([0, 0, 1, 1]);
    // the rotation alternates sides
    const sides = m.order.map((id) => m.teams[id]!.side);
    for (let i = 1; i < sides.length; i++) expect(sides[i]).not.toBe(sides[i - 1]);
    // knock out side 1: side 0 wins even though two of its teams are still standing
    runUntil(s, phaseIs('turnActive'));
    for (const c of s.characters) if (m.teams[c.team]!.side === 1) c.hp = 5;
    const xs = s.characters.filter((c) => m.teams[c.team]!.side === 1).map((c) => charPx(c));
    const log = runUntil(s, phaseIs('matchOver'), { cmds: xs.map((x) => ({ type: 'debugExplode' as const, x, y: standY, r: 30, damage: 30, knockback: 0 })) });
    const end = ofType(log, 'MatchEnded')[0]!;
    expect(end.result).toBe('win');
    expect(m.teams[end.winner]!.side).toBe(0);
  });

  it('alliances: one side only is not a match; bad sides are rejected', () => {
    expect(() => game([{ name: 'A', side: 2, spawns: spawn(300) }, { name: 'B', side: 2, spawns: spawn(600) }])).toThrow(/two sides/);
    expect(() => game([{ name: 'A', side: 9, spawns: spawn(300) }, { name: 'B', spawns: spawn(600) }])).toThrow(/side/);
  });

  it('a whole scripted match is deterministic', () => {
    const play = () => {
      const s = game([{ name: 'A', size: 3 }, { name: 'B', size: 3 }], { roundSeconds: 20 }, 99);
      for (let i = 0; i < 4000 && s.match!.phase !== 'matchOver'; i++) {
        const k = i % 180;
        step(s, k < 20 ? Btn.Up : k < 60 ? Btn.Fire : k < 90 ? Btn.Left : 0);
      }
      return hashState(s);
    };
    expect(play()).toBe(play());
  });
});
