import { describe, expect, it } from 'vitest';
import {
  Btn,
  CHAR,
  compileWeapons,
  createGame,
  charPx,
  degToAngle,
  hashState,
  step,
  type GameState,
  type InputFrame,
  type SimCommand,
  type SimEvent,
  type WeaponJson,
} from '../src/index.js';
import { rangeMap } from './helpers.js';
// The authored content is the fixture: one test per delivery / payload / modifier category.
import rocket from '../../content/weapons/pepper_rocket.json';
import grenade from '../../content/weapons/fizz_grenade.json';
import pin from '../../content/weapons/rolling_pin.json';
import acorn from '../../content/weapons/acorn_mortar.json';
import cookie from '../../content/weapons/cookie_roller.json';
import magnet from '../../content/weapons/magnet_bomb.json';
import sprinkle from '../../content/weapons/sprinkle_drop.json';
import frosting from '../../content/weapons/frosting_blaster.json';
import clip from '../../content/weapons/binder_clip.json';
import trowel from '../../content/weapons/boomerang_trowel.json';

const ALL = [rocket, grenade, pin, acorn, cookie, magnet, sprinkle, frosting, clip, trowel] as WeaponJson[];
const W = { rocket: 0, grenade: 1, pin: 2, acorn: 3, cookie: 4, magnet: 5, sprinkle: 6, frosting: 7, clip: 8, trowel: 9 } as const;
const FLOOR = 700;
const standY = FLOOR - CHAR.radius - 1;

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const ofType = <T extends SimEvent['type']>(ev: SimEvent[], type: T) => ev.filter((e) => e.type === type) as Ev<T>[];

/** Free play on the range; character 1 controlled. Wind 0 unless given. */
function range(xs: number[], weapon: number, wind = 0): GameState {
  const s = createGame({ seed: 8, map: rangeMap(), weapons: ALL, wind });
  step(s, 0, [...xs.map((x) => ({ type: 'debugSpawnCharacter' as const, x, y: standY, team: 0 })), { type: 'debugSelect', id: 1 }]);
  for (let i = 0; i < 30; i++) step(s, 0);
  step(s, 0, [{ type: 'selectWeapon', index: weapon }]);
  return s;
}
function run(s: GameState, frames: InputFrame[], ev: SimEvent[] = [], cmds: SimCommand[] = []): SimEvent[] {
  frames.forEach((f, i) => ev.push(...step(s, f, i === 0 ? cmds : [])));
  return ev;
}
const repeat = (f: InputFrame, n: number) => new Array<InputFrame>(n).fill(f);
function aim(s: GameState, deg: number): void {
  const c = s.characters[0]!;
  const target = degToAngle(deg);
  for (let i = 0; i < 200 && c.aim !== target; i++) {
    const before = c.aim;
    step(s, c.aim < target ? Btn.Up : Btn.Down);
    if (Math.abs(c.aim - target) >= Math.abs(before - target)) break;
  }
  step(s, 0);
}
const until = (s: GameState, ev: SimEvent[], done: (s: GameState) => boolean, max = 2000) => {
  for (let i = 0; i < max && !done(s); i++) ev.push(...step(s, 0));
  return ev;
};
const quiet = (s: GameState) => s.projectiles.length === 0 && s.fires.length === 0 && s.pendingExplosions.length === 0;

describe('compiler', () => {
  it('appends hidden sub-projectile defs and refuses to select them', () => {
    const defs = compileWeapons(ALL);
    expect(defs).toHaveLength(12);
    expect(defs.slice(10).every((d) => d.hidden)).toBe(true);
    const s = range([300], W.rocket);
    step(s, 0, [{ type: 'selectWeapon', index: 10 }]);
    expect(s.characters[0]!.weapon).toBe(W.rocket);
  });
});

describe('payload: cluster (Acorn Mortar)', () => {
  it('the acorn bursts into five bomblets that each explode', () => {
    const s = range([300], W.acorn);
    aim(s, 45);
    const ev = run(s, [...repeat(Btn.Fire, 40), 0]);
    until(s, ev, quiet);
    const impact = ofType(ev, 'ProjectileImpact');
    const spawned = ofType(ev, 'ProjectileSpawned');
    expect(spawned).toHaveLength(5);
    expect(new Set(spawned.map((e) => e.parent))).toEqual(new Set([impact[0]!.id]));
    expect(ofType(ev, 'Exploded')).toHaveLength(6);
    const parentX = impact[0]!.x;
    for (const e of ofType(ev, 'Exploded').slice(1)) expect(Math.abs(e.x - parentX)).toBeLessThan(260);
  });
});

describe('delivery: hitscan (Binder-Clip Launcher)', () => {
  it('a straight instant ray hits the first character in line', () => {
    const s = range([300, 420, 600], W.clip);
    const ev = run(s, [Btn.Fire, 0]);
    const shot = ofType(ev, 'HitscanFired')[0]!;
    expect(shot.hit).toBe('character');
    expect(Math.abs(shot.x1 - 420)).toBeLessThanOrEqual(CHAR.radius + 1);
    expect(ofType(ev, 'CharacterHit').map((h) => h.id)).toEqual([2]); // the one behind is untouched
  });

  it('a shot at head height hits: weapons test the drawn bean, not just the 9 px physics disc', () => {
    const s = range([300, 360], W.clip);
    aim(s, 14); // passes ~15 px above the target's centre
    const shot = ofType(run(s, [Btn.Fire, 0]), 'HitscanFired')[0]!;
    expect(shot.hit).toBe('character');
    const over = range([300, 360], W.clip);
    aim(over, 22); // ~24 px above the centre: clean miss over the head
    expect(ofType(run(over, [Btn.Fire, 0]), 'HitscanFired')[0]!.hit).not.toBe('character');
  });

  it('a shot into the ground blasts a hole; in a match it takes two shots to end the turn', () => {
    const s = range([300], W.clip);
    aim(s, -30);
    const ev = run(s, [Btn.Fire, 0]);
    expect(ofType(ev, 'HitscanFired')[0]!.hit).toBe('terrain');
    expect(ev.some((e) => e.type === 'TerrainChanged' && e.cause === 'explosion')).toBe(true);

    const m = createGame({ seed: 2, map: rangeMap(), weapons: ALL, match: { teams: [{ name: 'A', spawns: [{ x: 300, y: standY }] }, { name: 'B', spawns: [{ x: 1500, y: standY }] }], ruleset: { turnPrepSeconds: 0.2 } } });
    for (let i = 0; i < 200 && m.match!.phase !== 'turnActive'; i++) step(m, 0);
    step(m, 0, [{ type: 'selectWeapon', index: W.clip }]);
    run(m, [Btn.Fire, 0]);
    expect(m.match!).toMatchObject({ phase: 'turnActive', shotsFired: 1 });
    run(m, [Btn.Fire, 0]);
    expect(m.match!.phase).toBe('retreat');
  });
});

describe('delivery: strike (Sprinkle Drop)', () => {
  it('nothing without a target; with one, five drops fall around it', () => {
    const s = range([300], W.sprinkle);
    expect(ofType(run(s, [Btn.Fire, 0]), 'StrikeCalled')).toHaveLength(0);
    const ev = run(s, [0], [], [{ type: 'setTarget', x: 1000, y: 690 }]);
    expect(ofType(ev, 'TargetSet')).toEqual([expect.objectContaining({ x: 1000, y: 690 })]);
    run(s, [Btn.Fire, 0], ev);
    until(s, ev, quiet);
    expect(ofType(ev, 'StrikeCalled')).toHaveLength(1);
    const booms = ofType(ev, 'Exploded');
    expect(booms).toHaveLength(5);
    const mid = booms.reduce((a, e) => a + e.x, 0) / booms.length;
    expect(Math.abs(mid - 1000)).toBeLessThan(60);
    for (const e of booms) expect(e.y).toBeGreaterThan(650);
  });
});

describe('modifier: homing (Magnet Bomb)', () => {
  it('locks on to the target even against a strong wind', () => {
    const land = (target: boolean) => {
      const s = range([600], W.magnet, -100); // right of the 1 px wall
      if (target) step(s, 0, [{ type: 'setTarget', x: 1400, y: 690 }]);
      aim(s, 45);
      const ev = run(s, [...repeat(Btn.Fire, 30), 0]);
      until(s, ev, quiet);
      return ofType(ev, 'ProjectileImpact')[0];
    };
    expect(land(false)).toBeUndefined(); // no target, no throw
    const hit = land(true)!;
    expect(Math.abs(hit.x - 1400)).toBeLessThan(30);
  });
});

describe('behaviour: walker + remote trigger (Cookie Roller)', () => {
  it('lands, rolls along the ground, turns at a wall it cannot hop, and Space detonates it', () => {
    const s = range([300], W.cookie);
    const ev = run(s, [...repeat(Btn.Fire, 5), 0]);
    run(s, repeat(0, 40), ev);
    const p = s.projectiles[0]!;
    expect(p.walkDir).toBe(1);
    const x0 = p.x >> 8;
    run(s, repeat(0, 20), ev);
    expect((p.x >> 8) - x0).toBeGreaterThanOrEqual(30); // 2 px/tick
    expect(p.y >> 8).toBe(FLOOR - 7);
    run(s, repeat(0, 120), ev); // reaches the 100 px wall at x=500 and turns round
    expect(p.walkDir).toBe(-1);
    expect(p.x >> 8).toBeLessThan(500);
    run(s, [Btn.Fire, 0], ev);
    expect(ofType(ev, 'ProjectileImpact')).toEqual([expect.objectContaining({ hit: 'remote' })]);
  });

  it('its owner stands still while it rolls; in a match the retreat starts after the bang', () => {
    const m = createGame({ seed: 2, map: rangeMap(), weapons: ALL, match: { teams: [{ name: 'A', spawns: [{ x: 300, y: standY }] }, { name: 'B', spawns: [{ x: 1500, y: standY }] }], ruleset: { turnPrepSeconds: 0.2 } } });
    for (let i = 0; i < 200 && m.match!.phase !== 'turnActive'; i++) step(m, 0);
    const me = m.characters.find((c) => c.id === m.activeCharacter)!;
    step(m, 0, [{ type: 'selectWeapon', index: W.cookie }]);
    run(m, [...repeat(Btn.Fire, 5), 0]);
    const x = charPx(me);
    run(m, repeat(Btn.Left, 60));
    expect(charPx(me)).toBe(x);
    expect(m.match!.phase).toBe('turnActive');
    expect(m.match!.remoteWait).toBe(true);
    const ev = run(m, [Btn.Fire, 0, 0]);
    expect(ofType(ev, 'ProjectileImpact')[0]!.hit).toBe('remote');
    expect(m.match!.phase).toBe('retreat');
  });

  it('without a detonation it goes off when its fuse ends', () => {
    const s = range([300], W.cookie);
    const ev = run(s, [...repeat(Btn.Fire, 5), 0]);
    until(s, ev, quiet);
    const fired = ofType(ev, 'ProjectileFired')[0]!, boom = ofType(ev, 'ProjectileImpact')[0]!;
    expect(boom.hit).toBe('fuse');
    expect(boom.tick - fired.tick).toBe(400);
  });
});

describe('payload: fire (Frosting Blaster)', () => {
  it('flames fall, stick, burn the ground, hurt whoever stands in them and go out', () => {
    // find the charge that lands the blob 26–40 px from the Gumling at x=900 (outside the pop)
    for (let power = 15; power < 60; power++) {
      const t = range([600, 900], W.frosting);
      t.autoReveal = false;
      aim(t, 45);
      const ev = run(t, [...repeat(Btn.Fire, power), 0]);
      until(t, ev, (x) => x.projectiles.length === 0);
      const at = ofType(ev, 'ProjectileImpact')[0];
      if (at && Math.abs(at.x - 900) > 26 && Math.abs(at.x - 900) < 40) {
        until(t, ev, quiet, 600);
        expect(ofType(ev, 'FiresSpawned')).toEqual([expect.objectContaining({ count: 12 })]);
        expect(ev.some((e) => e.type === 'TerrainChanged' && e.cause === 'fire')).toBe(true);
        const burns = ofType(ev, 'CharacterHit').filter((h) => h.id === 2 && h.damage === 4);
        expect(burns.length).toBeGreaterThan(3); // several pulses, one per pulse (not per flame)
        const pulses = new Set(burns.map((b) => b.tick));
        expect(pulses.size).toBe(burns.length);
        expect(t.fires).toHaveLength(0);
        return;
      }
    }
    throw new Error('no charge landed the blob near the target');
  });
});

describe('behaviour: boomerang (Boomerang Trowel)', () => {
  it('strikes a character once on the way, comes back and is caught', () => {
    const s = range([600, 680], W.trowel);
    aim(s, 15);
    const ev = run(s, [...repeat(Btn.Fire, 25), 0]);
    until(s, ev, (x) => x.projectiles.length === 0, 600);
    expect(ofType(ev, 'ProjectileStruck').map((e) => e.characterId)).toEqual([2]);
    expect(ofType(ev, 'CharacterHit')).toEqual([expect.objectContaining({ id: 2, damage: 30 })]);
    expect(ofType(ev, 'ProjectileCaught')).toEqual([expect.objectContaining({ by: 1 })]);
    expect(ofType(ev, 'Exploded')).toHaveLength(0);
  });

  it('a wall in the way drops it', () => {
    const s = range([470], W.trowel);
    const ev = run(s, [...repeat(Btn.Fire, 25), 0]);
    until(s, ev, (x) => x.projectiles.length === 0, 600);
    expect(ofType(ev, 'ProjectileDropped')).toHaveLength(1);
  });
});

describe('determinism', () => {
  it('every weapon in one scripted session replays to the same hash', () => {
    const play = () => {
      const s = range([300, 900, 1400], W.rocket, 30);
      for (let w = 0; w < 10; w++) {
        step(s, 0, [{ type: 'selectWeapon', index: w }, { type: 'setTarget', x: 900 + w * 20, y: 690 }]);
        aim(s, 20 + w * 4);
        run(s, [...repeat(Btn.Fire, 30), 0, 0, Btn.Fire, 0]);
        until(s, [], quiet, 1200);
      }
      return hashState(s);
    };
    expect(play()).toBe(play());
  });
});
