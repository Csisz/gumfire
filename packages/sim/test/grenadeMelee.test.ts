import { describe, expect, it } from 'vitest';
import {
  Btn,
  CHAR,
  SUB,
  WeaponDefinitionError,
  charPx,
  compileWeapon,
  createGame,
  degToAngle,
  step,
  type GameState,
  type InputFrame,
  type SimEvent,
  type WeaponJson,
} from '../src/index.js';
import { GRENADE_JSON, PIN_JSON, ROCKET_JSON, rangeMap } from './helpers.js';

const FLOOR = 700;
const standY = FLOOR - CHAR.radius - 1;
const GRENADE = 1, PIN = 2;

/** Free-play range with characters at the given x; character 1 is controlled. */
function range(xs: number[], wind = 0): GameState {
  const s = createGame({ seed: 4, map: rangeMap(), weapons: [ROCKET_JSON, GRENADE_JSON, PIN_JSON], wind });
  step(s, 0, [...xs.map((x) => ({ type: 'debugSpawnCharacter' as const, x, y: standY, team: 0 })), { type: 'debugSelect', id: 1 }]);
  for (let i = 0; i < 30; i++) step(s, 0);
  return s;
}
function run(s: GameState, frames: InputFrame[], ev: SimEvent[] = []): SimEvent[] {
  for (const f of frames) ev.push(...step(s, f));
  return ev;
}
const repeat = (f: InputFrame, n: number) => new Array<InputFrame>(n).fill(f);
type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const ofType = <T extends SimEvent['type']>(ev: SimEvent[], type: T) => ev.filter((e) => e.type === type) as Ev<T>[];

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
function throwGrenade(s: GameState, deg: number, charge: number, setup: InputFrame[] = []): SimEvent[] {
  step(s, 0, [{ type: 'selectWeapon', index: GRENADE }]);
  const ev = run(s, setup);
  aim(s, deg);
  run(s, [...repeat(Btn.Fire, charge), 0], ev);
  return ev;
}
const flyOut = (s: GameState, ev: SimEvent[], max = 600) => {
  for (let i = 0; i < max && s.projectiles.length > 0; i++) ev.push(...step(s, 0));
  return ev;
};

describe('weapon definitions (M8 blocks)', () => {
  it('validates melee and fuse blocks', () => {
    expect(() => compileWeapon({ ...PIN_JSON, melee: undefined })).toThrow(/melee/);
    expect(() => compileWeapon({ ...PIN_JSON, input: { mode: 'aimCharge' } })).toThrow(/instant/);
    const noBounce = { ...GRENADE_JSON, projectile: { ...GRENADE_JSON.projectile!, bounce: undefined } } as WeaponJson;
    expect(() => compileWeapon(noBounce)).toThrow(/bounce/);
    expect(() => compileWeapon({ ...ROCKET_JSON, category: 'strike' as never })).toThrow(WeaponDefinitionError);
    const pin = compileWeapon(PIN_JSON);
    expect(pin).toMatchObject({ category: 'melee', instant: true, meleeReach: 18, meleeDamage: 30, meleeImpulse: 10 * SUB });
    expect(pin.meleeArcCos).toBeGreaterThan(150); // cos 50° ≈ 0.64
    expect(pin.meleeArcCos).toBeLessThan(180);
  });
});

describe('Fizz Grenade', () => {
  it('goes off exactly when the fuse runs out; keys 1–5 set the fuse', () => {
    for (const [key, secs] of [[0, 3], [Btn.Fuse1, 1], [Btn.Fuse5, 5]] as const) {
      const s = range([300]);
      const setup = key ? [key, 0] : [];
      const ev = flyOut(s, throwGrenade(s, 45, 20, setup));
      const fired = ofType(ev, 'ProjectileFired')[0]!;
      const boom = ofType(ev, 'ProjectileImpact')[0]!;
      expect(boom.hit).toBe('fuse');
      expect(boom.tick - fired.tick).toBe(secs * 50);
      if (key) expect(ofType(ev, 'FuseChanged')[0]).toMatchObject({ fuse: secs });
    }
  });

  it('bounces off the ground and comes to rest before a long fuse ends', () => {
    const s = range([300]);
    const ev = throwGrenade(s, 45, 30, [Btn.Fuse5, 0]);
    run(s, repeat(0, 200), ev);
    expect(ofType(ev, 'ProjectileBounced').length).toBeGreaterThan(1);
    expect(s.projectiles).toHaveLength(1);
    expect(s.projectiles[0]!.body!.sleeping).toBe(true);
    expect(s.projectiles[0]!.y >> 8).toBe(FLOOR - 5); // radius 4, resting on the floor
    flyOut(s, ev);
    expect(ofType(ev, 'Exploded')).toHaveLength(1);
  });

  it('high bounce bounces higher than low bounce', () => {
    const peakAfterFirstBounce = (bouncy: boolean) => {
      const s = range([300]);
      const ev = throwGrenade(s, 60, 40, bouncy ? [Btn.Alt, 0] : []);
      let bounced = false, peak = FLOOR;
      for (let i = 0; i < 140 && s.projectiles.length; i++) {
        const e = step(s, 0);
        if (e.some((x) => x.type === 'ProjectileBounced')) bounced = true;
        if (bounced) peak = Math.min(peak, s.projectiles[0]!.y >> 8);
      }
      expect(ofType(ev, 'FuseChanged').length).toBe(bouncy ? 1 : 0);
      return FLOOR - peak;
    };
    expect(peakAfterFirstBounce(true)).toBeGreaterThan(peakAfterFirstBounce(false) * 2);
  });

  it('ignores the wind and rolls past characters', () => {
    const landX = (wind: number) => {
      const s = range([300], wind);
      const ev = flyOut(s, throwGrenade(s, 45, 30));
      return ofType(ev, 'ProjectileImpact')[0]!.x;
    };
    expect(landX(100)).toBe(landX(-100));
    const s = range([300, 330]);
    const ev = flyOut(s, throwGrenade(s, 0, 5)); // low and slow straight at the neighbour
    expect(ofType(ev, 'ProjectileImpact')[0]!.hit).toBe('fuse');
  });

  it('fizzles in the water', () => {
    const s = range([2150]);
    const ev = flyOut(s, throwGrenade(s, 30, 30));
    expect(ofType(ev, 'ProjectileSplashed')).toHaveLength(1);
    expect(ofType(ev, 'Exploded')).toHaveLength(0);
  });

  it('a resting grenade is pushed by a nearby blast', () => {
    const s = range([300]);
    const ev = throwGrenade(s, 45, 20, [Btn.Fuse5, 0]);
    run(s, repeat(0, 150), ev);
    const g = s.projectiles[0]!;
    expect(g.body!.sleeping).toBe(true);
    step(s, 0, [{ type: 'debugExplode', x: (g.x >> 8) - 20, y: FLOOR - 4, r: 30, damage: 10, knockback: 256 }]);
    expect(g.body!.sleeping).toBe(false);
    expect(g.body!.vx).toBeGreaterThan(0); // pushed away from the blast
    expect(g.body!.vy).toBeLessThan(0);
  });
});

describe('Rolling Pin', () => {
  function swing(s: GameState, deg = 0): SimEvent[] {
    step(s, 0, [{ type: 'selectWeapon', index: PIN }]);
    aim(s, deg);
    return run(s, [Btn.Fire, 0]);
  }

  it('one press swings (no charge): the target in front takes damage and flies along the aim', () => {
    const s = range([300, 320]);
    const ev = swing(s);
    const [me, target] = s.characters as [GameState['characters'][0], GameState['characters'][0]];
    expect(me.state).not.toBe('charging');
    expect(ofType(ev, 'MeleeSwing')).toEqual([expect.objectContaining({ id: 1, hits: [2] })]);
    expect(ofType(ev, 'CharacterHit')).toEqual([expect.objectContaining({ id: 2, damage: 30 })]);
    expect(target.state).toBe('air');
    expect(target.body.vx).toBeGreaterThan(9 * SUB);
    expect(target.body.vy).toBeLessThan(0);
    expect(target.fallImmune).toBe(true);
    run(s, repeat(0, 200));
    expect(charPx(target)).toBeGreaterThan(420); // flew most of the way to the wall at x=500
  });

  it('misses targets behind or out of reach; aiming up launches upward', () => {
    const behind = range([300, 282]);
    expect(ofType(swing(behind), 'MeleeSwing')[0]!.hits).toEqual([]);
    const far = range([300, 330]);
    expect(ofType(swing(far), 'MeleeSwing')[0]!.hits).toEqual([]);
    const up = range([300, 318]);
    swing(up, 45);
    const t = up.characters[1]!;
    expect(-t.body.vy).toBeGreaterThan(t.body.vx);
  });

  it('in a match the swing ends the turn like a shot', () => {
    const s = createGame({
      seed: 3,
      map: rangeMap(),
      weapons: [ROCKET_JSON, GRENADE_JSON, PIN_JSON],
      match: { teams: [{ name: 'A', spawns: [{ x: 300, y: standY }] }, { name: 'B', spawns: [{ x: 318, y: standY }] }], ruleset: { turnPrepSeconds: 0.2 } },
    });
    for (let i = 0; i < 400 && s.match!.phase !== 'turnActive'; i++) step(s, 0);
    const me = s.characters.find((c) => c.id === s.activeCharacter)!;
    if (me.id === 2) me.facing = -1;
    step(s, 0, [{ type: 'selectWeapon', index: PIN }]);
    const ev = run(s, [Btn.Fire, 0]);
    expect(ofType(ev, 'MeleeSwing')[0]!.hits).toHaveLength(1);
    expect(s.match!.phase).toBe('retreat');
  });
});
