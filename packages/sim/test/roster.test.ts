import { describe, expect, it } from 'vitest';
import {
  Btn,
  CHAR,
  Mat,
  createGame,
  hashState,
  isSolid,
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
import sprinkle from '../../content/weapons/sprinkle_drop.json';
import jawbreaker from '../../content/weapons/jawbreaker.json';
import cherry from '../../content/weapons/cherry_bomb.json';
import mouseTrap from '../../content/weapons/mouse_trap.json';
import toffee from '../../content/weapons/toffee_bomb.json';
import scatter from '../../content/weapons/gumball_scatter.json';
import whisk from '../../content/weapons/whisk_uppercut.json';
import spatula from '../../content/weapons/spatula_shove.json';
import cookie from '../../content/weapons/fortune_cookie.json';
import bridge from '../../content/weapons/biscuit_bridge.json';
import umbrella from '../../content/weapons/cocktail_umbrella.json';
import jetpack from '../../content/weapons/soda_jetpack.json';
import drill from '../../content/weapons/chopstick_drill.json';
import torch from '../../content/weapons/candle_torch.json';
import nap from '../../content/weapons/nap_time.json';
import trapProp from '../../content/props/mouse_trap.json';
import utilityCrate from '../../content/props/utility_crate.json';

const LIST = [rocket, sprinkle, jawbreaker, cherry, mouseTrap, toffee, scatter, whisk, spatula, cookie, bridge, umbrella, jetpack, drill, torch, nap] as WeaponJson[];
const W = Object.fromEntries(LIST.map((w, i) => [w.id, i])) as Record<string, number>;
const PROPS = [trapProp, utilityCrate] as PropJson[];
const FLOOR = 700;
const standY = FLOOR - CHAR.radius - 1;
const QUIET: RulesetJson = { turnPrepSeconds: 0.2, revealSeconds: 0.2, crateChance: 0, mines: 0, barrels: 0, turnSeconds: 30 };

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const ofType = <T extends SimEvent['type']>(ev: SimEvent[], type: T) => ev.filter((e) => e.type === type) as Ev<T>[];

function game(a: Array<{ x: number; y?: number }>, b: Array<{ x: number; y?: number }>, extra: Partial<MatchConfig> = {}, ruleset: RulesetJson = {}): GameState {
  return createGame({
    seed: 9,
    map: rangeMap(),
    weapons: LIST,
    props: PROPS,
    match: {
      teams: [
        { name: 'A', spawns: a.map((p) => ({ x: p.x, y: p.y ?? standY })) },
        { name: 'B', spawns: b.map((p) => ({ x: p.x, y: p.y ?? standY })) },
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
/** Run until it is character `id`'s active turn (the team order is seeded). */
function turnOf(s: GameState, id: number, ev: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < 20000 && !(s.match!.phase === 'turnActive' && s.activeCharacter === id); i++) ev.push(...step(s, 0));
  expect(s.activeCharacter).toBe(id);
  return ev;
}
const me = (s: GameState) => s.characters.find((c) => c.id === s.activeCharacter)!;
const select = (s: GameState, id: string) => run(s, 1, 0, [], [{ type: 'selectWeapon', index: W[id]! }]);
/** Press Fire for one tick, then let go. */
const tap = (s: GameState, ev: SimEvent[] = []) => {
  run(s, 1, Btn.Fire, ev);
  return run(s, 1, 0, ev);
};
const ammo = (s: GameState, id: string) => s.match!.teams[me(s).team]!.ammo[W[id]!];

describe('teleport (Fortune Cookie)', () => {
  it('moves the Gumling to a free spot and ends the turn; a buried spot is refused for free', () => {
    const s = game([{ x: 300 }], [{ x: 1500 }]);
    turnOf(s, 1);
    select(s, 'fortune_cookie');
    run(s, 1, 0, [], [{ type: 'setTarget', x: 900, y: 750 }]); // inside the ground
    let ev = tap(s);
    expect(ofType(ev, 'UtilityFailed')).toEqual([expect.objectContaining({ reason: 'blocked' })]);
    expect(ammo(s, 'fortune_cookie')).toBe(2);
    run(s, 1, 0, [], [{ type: 'setTarget', x: 900, y: 600 }]);
    ev = tap(s);
    expect(ofType(ev, 'UtilityUsed')).toEqual([expect.objectContaining({ kind: 'teleport', x: 900, y: 600 })]);
    expect(ammo(s, 'fortune_cookie')).toBe(1);
    expect(s.match!.phase).toBe('retreat');
    run(s, 80, 0, ev);
    expect(me(s).body.x >> 8).toBe(900);
    expect(me(s).body.y >> 8).toBe(standY);
    expect(ofType(ev, 'CharacterHit')).toHaveLength(0); // no fall damage after a teleport
  });
});

describe('girder (Biscuit Bridge)', () => {
  it('places a beam tilted by the aim; the turn goes on; refuses far, wet or occupied spots', () => {
    const s = game([{ x: 300 }], [{ x: 1500 }]);
    turnOf(s, 1);
    select(s, 'biscuit_bridge');
    run(s, 1, 0, [], [{ type: 'setTarget', x: 400, y: 640 }]);
    let ev = tap(s);
    const g = ofType(ev, 'GirderPlaced')[0]!;
    expect(g).toMatchObject({ x0: 368, y0: 640, x1: 432, y1: 640 });
    expect(s.terrain!.mat[640 * s.terrain!.width + 400]).toBe(Mat.GIRDER);
    expect(s.match!.phase).toBe('turnActive');
    expect(s.match!.shotsFired).toBe(0);
    expect(ammo(s, 'biscuit_bridge')).toBe(2);
    // aim up 45°: a rising beam
    me(s).aim = 512;
    run(s, 1, 0, [], [{ type: 'setTarget', x: 250, y: 600 }]);
    ev = tap(s);
    const g2 = ofType(ev, 'GirderPlaced')[0]!;
    expect(g2.x1 - g2.x0).toBe(g2.y0 - g2.y1); // 45°, rising to the right
    expect(Math.abs(g2.x1 - g2.x0)).toBeGreaterThan(40);
    // too far, and right through a Gumling
    run(s, 1, 0, [], [{ type: 'setTarget', x: 900, y: 600 }]);
    expect(ofType(tap(s), 'UtilityFailed')[0]!.reason).toBe('range');
    me(s).aim = 0;
    run(s, 1, 0, [], [{ type: 'setTarget', x: 300, y: standY }]);
    expect(ofType(tap(s), 'UtilityFailed')[0]!.reason).toBe('blocked');
    expect(ammo(s, 'biscuit_bridge')).toBe(1);
    // and the turn is still ours: a weapon can follow
    select(s, 'pepper_rocket');
    expect(me(s).weapon).toBe(W.pepper_rocket);
  });
});

describe('parachute (Cocktail Umbrella)', () => {
  it('opens while falling: slow, wind-blown descent and no fall damage', () => {
    const drop = (open: boolean) => {
      // everyone starts high in the air; whoever's turn it is opens the umbrella
      const s = game([{ x: 300, y: 40 }], [{ x: 1500, y: 40 }], {}, { turnPrepSeconds: 0 });
      for (let i = 0; i < 50 && s.match!.phase !== 'turnActive'; i++) step(s, 0);
      run(s, 1, 0, [], [{ type: 'debugSetWind', wind: 60 }]);
      const c = me(s);
      c.fallImmune = false;
      expect(c.state).toBe('air');
      select(s, 'cocktail_umbrella');
      const ev = open ? tap(s) : [];
      let maxVy = 0;
      for (let i = 0; i < 1500 && c.state === 'air'; i++) {
        ev.push(...step(s, 0));
        if (open) maxVy = Math.max(maxVy, c.body.vy);
      }
      return { c, ev, maxVy };
    };
    const open = drop(true), closed = drop(false);
    expect(ofType(open.ev, 'GearChanged')[0]).toMatchObject({ gear: 'chute', on: true });
    expect(open.maxVy).toBeLessThanOrEqual(Math.round(1.2 * 256));
    const x0 = open.c.team === 0 ? 300 : 1500;
    expect((open.c.body.x >> 8) - x0).toBeGreaterThan(30); // drifted with the wind
    expect(open.c.pendingDamage).toBe(0);
    expect(open.c.chute).toBe(false); // closed on landing
    expect(closed.c.pendingDamage).toBeGreaterThan(0);
  });
});

describe('jetpack (Soda Jetpack)', () => {
  it('lifts off, climbs with ↑, steers, and stops on Fire', () => {
    const s = game([{ x: 300 }], [{ x: 1500 }]);
    turnOf(s, 1);
    select(s, 'soda_jetpack');
    const ev = tap(s);
    const c = me(s);
    expect(c.jet).toBe(true);
    expect(ammo(s, 'soda_jetpack')).toBe(0);
    run(s, 60, Btn.Up | Btn.Right, ev);
    expect(c.body.y >> 8).toBeLessThan(standY - 60);
    expect(c.body.x >> 8).toBeGreaterThan(330);
    const fuel = c.jetFuel;
    expect(fuel).toBeLessThan(250);
    tap(s, ev);
    expect(c.jet).toBe(false);
    run(s, 400, 0, ev);
    expect(c.state).not.toBe('air');
    expect(s.match!.phase).toBe('turnActive'); // the turn goes on
  });

  it('stays on after a landing; ↑ lifts off again (M13.1 playtest)', () => {
    const s = game([{ x: 300 }], [{ x: 1500 }]);
    turnOf(s, 1);
    select(s, 'soda_jetpack');
    const ev = tap(s);
    const c = me(s);
    run(s, 80, 0, ev); // no thrust: it drops back onto the floor
    expect(c.state).not.toBe('air');
    expect(c.jet).toBe(true);
    run(s, 40, Btn.Up, ev);
    expect(c.state).toBe('air');
    expect(c.body.y >> 8).toBeLessThan(standY - 30);
  });

  it('runs dry after its fuel and the Gumling falls', () => {
    const s = game([{ x: 300 }], [{ x: 1500 }]);
    turnOf(s, 1);
    select(s, 'soda_jetpack');
    const ev = tap(s);
    run(s, 300, Btn.Up, ev);
    expect(me(s).jet).toBe(false);
    expect(ofType(ev, 'GearChanged').filter((e) => e.gear === 'jet').map((e) => e.on)).toEqual([true, false]);
  });
});

describe('drill and torch', () => {
  it('the drill digs straight down until Fire is pressed again', () => {
    const s = game([{ x: 300 }], [{ x: 1500 }]);
    turnOf(s, 1);
    select(s, 'chopstick_drill');
    const ev = tap(s);
    const c = me(s);
    expect(c.state).toBe('tool');
    run(s, 80, 0, ev);
    const y = c.body.y >> 8;
    expect(y).toBeGreaterThan(standY + 50);
    expect(c.body.x >> 8).toBe(300);
    expect(isSolid(s.terrain!, 300, FLOOR + 20)).toBe(false); // a shaft
    tap(s, ev);
    expect(c.state).toBe('air');
    run(s, 100, 0, ev);
    expect(['idle', 'landing']).toContain(c.state);
    expect(c.pendingDamage).toBe(0);
    expect(s.match!.phase).toBe('turnActive');
  });

  it('the torch burns a flat tunnel ahead and singes whoever is in the way once', () => {
    const s = game([{ x: 300 }], [{ x: 380 }]);
    turnOf(s, 1);
    select(s, 'candle_torch');
    const c = me(s);
    c.facing = 1;
    c.aim = 0;
    const ev = tap(s);
    run(s, 300, 0, ev);
    expect(c.state).not.toBe('tool');
    expect(c.body.x >> 8).toBeGreaterThan(400);
    expect(ofType(ev, 'CharacterHit').filter((e) => e.id === 2).map((e) => e.damage)).toEqual([15]);
  });
});

describe('skip and delays', () => {
  it('Nap Time ends the turn at once', () => {
    const s = game([{ x: 300 }], [{ x: 1500 }]);
    turnOf(s, 1);
    select(s, 'nap_time');
    const ev = tap(s);
    expect(ofType(ev, 'ControlEnded')).toEqual([expect.objectContaining({ reason: 'skip' })]);
  });

  it('a delayed weapon stays locked for the team’s first turns', () => {
    const s = game([{ x: 300 }], [{ x: 1500 }]);
    const tries: boolean[] = [];
    for (let turn = 0; turn < 3; turn++) {
      turnOf(s, 1);
      select(s, 'sprinkle_drop');
      tries.push(me(s).weapon === W.sprinkle_drop);
      select(s, 'nap_time');
      tap(s);
    }
    expect(tries).toEqual([false, false, true]);
  });
});

describe('new projectiles', () => {
  it('Jawbreaker goes off on its third hard bounce', () => {
    const s = game([{ x: 300 }], [{ x: 1500 }]);
    turnOf(s, 1);
    select(s, 'jawbreaker');
    me(s).aim = 512; // a high lob: it comes down hard
    const ev = run(s, 62, Btn.Fire);
    run(s, 300, 0, ev);
    expect(ofType(ev, 'ProjectileImpact')[0]).toMatchObject({ hit: 'bounces' });
  });

  it('Sticky Toffee sticks to a wall and stays there until its fuse', () => {
    const s = game([{ x: 440 }], [{ x: 1500 }]);
    turnOf(s, 1);
    select(s, 'toffee_bomb');
    const c = me(s);
    c.facing = 1;
    c.aim = 0;
    run(s, 1, 0, [], [{ type: 'debugSetWind', wind: 0 }]);
    const ev = run(s, 62, Btn.Fire);
    run(s, 30, 0, ev);
    const p = s.projectiles[0]!;
    expect(p.stuck).toBe(true);
    const at = { x: p.x, y: p.y };
    run(s, 60, 0, ev);
    expect({ x: p.x, y: p.y }).toEqual(at);
    run(s, 200, 0, ev);
    const hit = ofType(ev, 'ProjectileImpact')[0]!;
    expect(hit.hit).toBe('fuse');
    expect(hit.x).toBeGreaterThanOrEqual(490);
    expect(hit.x).toBeLessThan(500);
    expect(hit.y).toBeLessThan(FLOOR - 4); // on the wall, not on the floor
  });

  it('Cherry Bomb drops at the feet and goes off after 5 s', () => {
    const s = game([{ x: 300 }], [{ x: 1500 }]);
    turnOf(s, 1);
    select(s, 'cherry_bomb');
    // locked on the team's first turn (delay 1)
    expect(me(s).weapon).not.toBe(W.cherry_bomb);
    select(s, 'nap_time');
    tap(s);
    turnOf(s, 1);
    select(s, 'cherry_bomb');
    const fired = tap(s);
    const shot = ofType(fired, 'ProjectileFired')[0]!;
    expect(Math.abs(shot.x - 300)).toBeLessThanOrEqual(1);
    const ev = run(s, 300);
    const imp = ofType(ev, 'ProjectileImpact')[0]!;
    expect(imp.tick - shot.tick).toBe(250);
    expect(Math.abs(imp.x - 300)).toBeLessThan(6);
  });

  it('Gumball Scatter fires ten pellets; point-blank it hurts', () => {
    const s = game([{ x: 300 }], [{ x: 340 }]);
    turnOf(s, 1);
    select(s, 'gumball_scatter');
    me(s).facing = 1;
    me(s).aim = 0;
    const ev = tap(s);
    run(s, 2, 0, ev);
    expect(ofType(ev, 'HitscanFired')).toHaveLength(10);
    const dmg = ofType(ev, 'CharacterHit').filter((e) => e.id === 2).reduce((a, e) => a + e.damage, 0);
    expect(dmg).toBeGreaterThanOrEqual(20);
  });
});

describe('melee variants', () => {
  it('Whisk Uppercut sends the target up and lifts the attacker; Spatula Shove pushes without damage', () => {
    const s = game([{ x: 300 }], [{ x: 315 }]);
    turnOf(s, 1);
    select(s, 'whisk_uppercut');
    me(s).facing = 1;
    me(s).aim = -900; // ignored: the uppercut swings its own way
    const ev = tap(s);
    const t = s.characters.find((c) => c.id === 2)!;
    expect(ofType(ev, 'MeleeSwing')[0]!.hits).toEqual([2]);
    expect(t.state).toBe('air');
    expect(-t.body.vy).toBeGreaterThan(Math.abs(t.body.vx) * 2);
    expect(me(s).state).toBe('air');

    const s2 = game([{ x: 300 }], [{ x: 315 }]);
    turnOf(s2, 1);
    select(s2, 'spatula_shove');
    me(s2).facing = 1;
    const ev2 = tap(s2);
    const t2 = s2.characters.find((c) => c.id === 2)!;
    expect(ofType(ev2, 'CharacterHit')).toHaveLength(0);
    expect(t2.body.vx).toBeGreaterThan(Math.abs(t2.body.vy));
  });
});

describe('deployables and crates', () => {
  it('a Mouse Trap is placed in front and only goes live after 2 s', () => {
    const s = game([{ x: 300 }], [{ x: 1500 }]);
    turnOf(s, 1);
    select(s, 'mouse_trap');
    me(s).facing = 1;
    const ev = tap(s);
    const dep = ofType(ev, 'ObjectDeployed')[0]!;
    expect(dep).toMatchObject({ prop: 'mouse_trap', by: 1 });
    const o = s.objects.find((x) => x.id === dep.id)!;
    expect(o.body.x >> 8).toBeGreaterThan(310);
    run(s, 400, 0, ev); // its owner stays right next to it
    const armed = ofType(ev, 'MineArmed')[0]!;
    expect(armed.tick - dep.tick).toBeGreaterThanOrEqual(100);
  });

  it('a toolbox crate gives the team a utility', () => {
    const s = game([{ x: 300 }], [{ x: 1500 }], { objects: [{ prop: 'utility_crate', x: 300, y: 600 }] });
    const ev = run(s, 300);
    const got = ofType(ev, 'CrateCollected')[0]!;
    expect(got.kind).toBe('utility');
    expect(s.weapons[got.weapon]!.category).toBe('utility');
  });

  it('the whole roster is deterministic', () => {
    const play = () => {
      const s = game([{ x: 300 }, { x: 700 }], [{ x: 1500 }, { x: 1800 }]);
      const frames = (t: number): InputFrame => ((t * 7919) % 13 === 0 ? Btn.Fire : (t >> 5) % 3 === 0 ? Btn.Right | Btn.Up : 0);
      for (let t = 0; t < 4000; t++) {
        const cmds: SimCommand[] = t % 211 === 0 ? [{ type: 'selectWeapon', index: (t / 211) % LIST.length }] : t % 211 === 3 ? [{ type: 'setTarget', x: 300 + ((t * 37) % 1500), y: 400 }] : [];
        step(s, frames(t), cmds);
      }
      return hashState(s);
    };
    expect(play()).toBe(play());
  });
});
