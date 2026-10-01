import { describe, expect, it } from 'vitest';
import {
  Btn,
  CHAR,
  createGame,
  hashState,
  overlapsDisc,
  step,
  type GameState,
  type InputFrame,
  type MatchConfig,
  type PropJson,
  type RulesetJson,
  type SimCommand,
  type SimEvent,
  type WeaponJson,
} from '../src/index.js';
import { rangeMap } from './helpers.js';
import rocket from '../../content/weapons/pepper_rocket.json';
import cookie from '../../content/weapons/cookie_roller.json';
import mine from '../../content/props/gum_mine.json';
import keg from '../../content/props/fizz_keg.json';
import health from '../../content/props/health_crate.json';
import weaponCrate from '../../content/props/weapon_crate.json';

const WEAPONS = [rocket, cookie] as WeaponJson[];
const PROPS = [mine, keg, health, weaponCrate] as PropJson[];
const FLOOR = 700;
const standY = FLOOR - CHAR.radius - 1;
const QUIET: RulesetJson = { turnPrepSeconds: 0.2, revealSeconds: 0.2, crateChance: 0 };

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const ofType = <T extends SimEvent['type']>(ev: SimEvent[], type: T) => ev.filter((e) => e.type === type) as Ev<T>[];

function game(a: number[], b: number[], extra: Partial<MatchConfig> = {}, ruleset: RulesetJson = {}, seed = 4): GameState {
  return createGame({
    seed,
    map: rangeMap(),
    weapons: WEAPONS,
    props: PROPS,
    match: {
      teams: [
        { name: 'A', spawns: a.map((x) => ({ x, y: standY })) },
        { name: 'B', spawns: b.map((x) => ({ x, y: standY })) },
      ],
      ruleset: { ...QUIET, ...ruleset },
      ...extra,
    },
  });
}
function run(s: GameState, n: number, frame: InputFrame | ((s: GameState) => InputFrame) = 0, ev: SimEvent[] = [], cmds: SimCommand[] = []): SimEvent[] {
  for (let i = 0; i < n; i++) ev.push(...step(s, typeof frame === 'function' ? frame(s) : frame, i === 0 ? cmds : []));
  return ev;
}
const toActive = (s: GameState, ev: SimEvent[] = []) => {
  for (let i = 0; i < 2000 && s.match!.phase !== 'turnActive'; i++) ev.push(...step(s, 0));
  return ev;
};
const groundY = (r: number) => FLOOR - r - 1;

describe('placement', () => {
  it('a match with props places mines and barrels on dry ground, away from the Gumlings', () => {
    const s = createGame({ seed: 12, map: rangeMap(), weapons: WEAPONS, props: PROPS, match: { teams: [{ name: 'A', size: 3 }, { name: 'B', size: 3 }], ruleset: QUIET } });
    const kinds = s.objects.map((o) => s.props[o.prop]!.kind);
    expect(kinds.filter((k) => k === 'mine')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'barrel')).toHaveLength(3);
    run(s, 100);
    for (const o of s.objects) {
      expect(overlapsDisc(s.terrain!, o.body.x >> 8, o.body.y >> 8, o.body.radius)).toBe(false);
      expect(o.body.sleeping).toBe(true);
      for (const c of s.characters) expect(Math.hypot((c.body.x - o.body.x) / 256, (c.body.y - o.body.y) / 256)).toBeGreaterThanOrEqual(40);
    }
    // no props → no objects (unit tests, sandbox free play)
    expect(createGame({ seed: 12, map: rangeMap(), match: { teams: [{ name: 'A', size: 1 }, { name: 'B', size: 1 }] } }).objects).toHaveLength(0);
  });
});

describe('mines', () => {
  it('arm when a Gumling comes close, then go off (or fizzle) exactly when the fuse ends', () => {
    let duds = 0, booms = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = game([300], [1500], { objects: [{ prop: 'gum_mine', x: 350, y: groundY(5) }] }, {}, seed);
      const ev: SimEvent[] = [];
      for (let i = 0; i < 4000 && !(s.match!.phase === 'turnActive' && s.activeCharacter === 1); i++) ev.push(...step(s, 0));
      run(s, 250, Btn.Right, ev);
      const armed = ofType(ev, 'MineArmed');
      expect(armed).toHaveLength(1);
      expect(armed[0]!.fuse).toBeGreaterThanOrEqual(25);
      expect(armed[0]!.fuse).toBeLessThanOrEqual(150);
      const end = ev.find((e) => e.type === 'ObjectDetonated' || e.type === 'MineDud')!;
      expect(end.tick).toBe(armed[0]!.tick + armed[0]!.fuse + 1);
      if (end.type === 'MineDud') duds++;
      else booms++;
    }
    expect(duds).toBeGreaterThan(0); // 10 % duds
    expect(booms).toBeGreaterThan(duds * 3);
  });
});

describe('barrels', () => {
  it('a chain of ten kegs goes off one after another, one tick apart, deterministically', () => {
    const objects = Array.from({ length: 10 }, (_, i) => ({ prop: 'fizz_keg', x: 700 + i * 40, y: groundY(9) }));
    const play = () => {
      const s = game([300], [2100], { objects });
      toActive(s);
      const ev = run(s, 400, 0, [], [{ type: 'debugExplode', x: 690, y: groundY(9), r: 30, damage: 20, knockback: 256 }]);
      return { s, ev };
    };
    const { s, ev } = play();
    const det = ofType(ev, 'ObjectDetonated');
    expect(det.map((d) => d.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let i = 1; i < det.length; i++) expect(det[i]!.tick).toBe(det[i - 1]!.tick + 1);
    expect(ofType(ev, 'FiresSpawned').length).toBe(0); // kegs spawn flames directly
    expect(s.objects).toHaveLength(0);
    expect(hashState(play().s)).toBe(hashState(s));
  });

  it('a rocket that hits a keg sets it off', () => {
    const s = game([300], [2100], { objects: [{ prop: 'fizz_keg', x: 420, y: groundY(9) }] });
    toActive(s);
    if (s.activeCharacter !== 1) {
      for (let i = 0; i < 3000 && !(s.match!.phase === 'turnActive' && s.activeCharacter === 1); i++) step(s, 0);
    }
    const ev = run(s, 62, Btn.Fire); // full power: a flat, fast shot
    run(s, 100, 0, ev);
    expect(ofType(ev, 'ProjectileImpact')[0]).toMatchObject({ hit: 'object' });
    expect(ofType(ev, 'ObjectDetonated')).toHaveLength(1);
  });
});

describe('crates', () => {
  it('drop at turn starts (seeded), float down and land on the ground or sink — never inside terrain', () => {
    let landed = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const s = createGame({ seed, map: rangeMap(), weapons: WEAPONS, props: PROPS, match: { teams: [{ name: 'A', size: 1 }, { name: 'B', size: 1 }], ruleset: { ...QUIET, crateChance: 1, mines: 0, barrels: 0 } } });
      const ev = run(s, 900);
      const dropped = ofType(ev, 'CrateDropped');
      expect(dropped.length).toBeGreaterThan(0);
      for (const l of ofType(ev, 'CrateLanded')) {
        landed++;
        expect(l.y).toBeLessThan(FLOOR);
        expect(overlapsDisc(s.terrain!, l.x, l.y, 8)).toBe(false);
      }
    }
    expect(landed).toBeGreaterThan(10);
  });

  it('a health crate heals whoever touches it; a weapon crate adds ammo to the team', () => {
    const s = game([300], [1500], {
      objects: [
        { prop: 'health_crate', x: 300, y: 600 },
        { prop: 'weapon_crate', x: 1500, y: 600 },
      ],
    });
    const ev = run(s, 400);
    const got = ofType(ev, 'CrateCollected');
    expect(got.map((g) => [g.by, g.kind])).toEqual([
      [1, 'health'],
      [2, 'weapon'],
    ]);
    expect(s.characters[0]!.hp).toBe(125);
    const w = got[1]!.weapon;
    expect(s.weapons[w]!.id).toBe('cookie_roller'); // the only limited weapon here
    expect(s.match!.teams[1]!.ammo[w]).toBe(2);
  });
});

describe('ammo', () => {
  it('a limited weapon runs out; it cannot be selected or fired at 0', () => {
    const s = game([300], [1500]);
    toActive(s);
    const me = s.characters.find((c) => c.id === s.activeCharacter)!;
    const team = s.match!.teams[me.team]!;
    expect(team.ammo).toEqual([-1, 1]);
    step(s, 0, [{ type: 'selectWeapon', index: 1 }]);
    const ev = run(s, 6, Btn.Fire);
    run(s, 1, 0, ev);
    expect(ofType(ev, 'AmmoChanged')).toEqual([expect.objectContaining({ weapon: 1, ammo: 0 })]);
    run(s, 1, Btn.Fire, ev); // detonate the cookie
    // that team's next turn: the cookie is gone
    for (let i = 0; i < 5000 && !(s.match!.phase === 'turnActive' && s.match!.activeTeam === team.id && s.match!.turn > 1); i++) step(s, 0);
    const now = s.characters.find((c) => c.id === s.activeCharacter)!;
    step(s, 0, [{ type: 'selectWeapon', index: 0 }]);
    step(s, 0, [{ type: 'selectWeapon', index: 1 }]);
    expect(now.weapon).toBe(0);
    now.weapon = 1; // even forced, it will not fire
    const more = run(s, 10, Btn.Fire);
    expect(ofType(more, 'ProjectileFired')).toHaveLength(0);
  });
});

describe('sudden death telegraph', () => {
  it('announces sudden death once, before the round clock runs out', () => {
    const s = game([300], [1500], {}, { roundSeconds: 40, suddenDeathWarnSeconds: 30, turnSeconds: 5 });
    const ev = run(s, 6000);
    const warn = ofType(ev, 'SuddenDeathSoon');
    const sd = ofType(ev, 'SuddenDeath');
    expect(warn).toEqual([expect.objectContaining({ seconds: 30 })]);
    expect(sd.length).toBe(1);
    expect(warn[0]!.tick).toBeLessThan(sd[0]!.tick);
  });
});
