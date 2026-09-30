import { describe, expect, it } from 'vitest';
import {
  Btn,
  CHAR,
  SUB,
  WeaponDefinitionError,
  charPx,
  compileWeapon,
  compileWeapons,
  countSolid,
  createGame,
  degToAngle,
  launchSpeed,
  launchVector,
  rollWind,
  seedRng,
  step,
  toSub,
  type GameState,
  type InputFrame,
  type SimEvent,
  type WeaponJson,
} from '../src/index.js';
import { ROCKET_JSON, rangeMap } from './helpers.js';

const standY = (surface: number) => surface - CHAR.radius - 1;

function range(opts: { x?: number; wind?: number; weapons?: WeaponJson[]; map?: ReturnType<typeof rangeMap> } = {}): GameState {
  const s = createGame({ seed: 3, map: opts.map ?? rangeMap(), weapons: opts.weapons ?? [ROCKET_JSON], wind: opts.wind ?? 0 });
  step(s, 0, [{ type: 'debugSpawnCharacter', x: opts.x ?? 300, y: standY(700), team: 0 }, { type: 'debugSelect', id: 1 }]);
  for (let i = 0; i < 30; i++) step(s, 0);
  expect(s.characters[0]!.state).toBe('idle');
  return s;
}

function run(s: GameState, frames: InputFrame[], ev: SimEvent[] = []): SimEvent[] {
  for (const f of frames) ev.push(...step(s, f));
  return ev;
}
const repeat = (f: InputFrame, n: number) => new Array<InputFrame>(n).fill(f);

/** Aim to `deg` (from 0, in 1.5° steps), then charge `ticks` and release. */
function aimAndFire(s: GameState, deg: number, ticks: number): SimEvent[] {
  const c = s.characters[0]!;
  const ev: SimEvent[] = [];
  const target = degToAngle(deg);
  for (let i = 0; i < 400 && c.aim !== target; i++) {
    const before = c.aim;
    run(s, [c.aim < target ? Btn.Up : Btn.Down], ev);
    if (Math.abs(c.aim - target) >= Math.abs(before - target)) break;
  }
  run(s, [0], ev);
  run(s, repeat(Btn.Fire, ticks), ev);
  run(s, [0], ev);
  return ev;
}

function flyUntilDone(s: GameState, ev: SimEvent[], max = 600): SimEvent[] {
  for (let i = 0; i < max && (s.projectiles.length > 0 || i < 2); i++) ev.push(...step(s, 0));
  return ev;
}

const exploded = (ev: SimEvent[]) => ev.find((e) => e.type === 'Exploded') as Extract<SimEvent, { type: 'Exploded' }> | undefined;

describe('weapon definitions', () => {
  it('compiles authored units to integer sim units', () => {
    const d = compileWeapon(ROCKET_JSON);
    expect(d.speedMin).toBe(toSub(1.5));
    expect(d.speedMax).toBe(toSub(16));
    expect(d.windFactor).toBe(256);
    expect(d.ammo).toBe(-1);
    expect(launchSpeed(d, 0)).toBe(d.speedMin);
    expect(launchSpeed(d, d.chargeTicks)).toBe(d.speedMax);
    expect(launchSpeed(d, 30)).toBe(d.speedMin + Math.trunc((d.speedMax - d.speedMin) / 2));
  });

  it('rejects invalid or unsupported definitions with a clear error', () => {
    const bad = (patch: (w: WeaponJson) => void) => {
      const w = structuredClone(ROCKET_JSON) as WeaponJson;
      patch(w);
      return () => compileWeapon(w);
    };
    expect(bad((w) => (w.id = 'Bad Id'))).toThrow(WeaponDefinitionError);
    expect(bad((w) => (w.launch.speedMax = 99))).toThrow(/speedMax/);
    expect(bad((w) => (w.launch.speedMax = 1))).toThrow(/speedMax/); // below speedMin
    expect(bad((w) => (w.launch.chargeTicks = 0.5))).toThrow(/chargeTicks/);
    expect(bad((w) => (w.projectile.triggers = []))).toThrow(/impact/);
    expect(() => compileWeapons([ROCKET_JSON, ROCKET_JSON])).toThrow(/duplicate/);
  });

  it('the weapon set is part of the state hash', () => {
    const a = createGame({ seed: 1, weapons: [ROCKET_JSON] });
    const w2 = { ...ROCKET_JSON, projectile: { ...ROCKET_JSON.projectile, radius: 3 } };
    const b = createGame({ seed: 1, weapons: [w2] });
    expect(a.weaponsHash).not.toBe(b.weaponsHash);
  });
});

describe('aiming and launch', () => {
  it('launch vector follows aim and mirrors with facing', () => {
    const v0 = launchVector(0, 1, 1000);
    expect(v0).toEqual({ vx: 1000, vy: 0 });
    const up = launchVector(degToAngle(90), 1, 1000);
    expect(Math.abs(up.vx)).toBeLessThanOrEqual(1);
    expect(up.vy).toBe(-1000);
    const r45 = launchVector(degToAngle(45), 1, 1000);
    const l45 = launchVector(degToAngle(45), -1, 1000);
    expect(r45.vx).toBe(-l45.vx);
    expect(r45.vy).toBe(l45.vy);
    expect(Math.abs(r45.vx + r45.vy)).toBeLessThanOrEqual(1); // 45°: equal parts, y negative (up)
    const down = launchVector(-degToAngle(30), 1, 1000);
    expect(down.vy).toBeGreaterThan(0);
  });

  it('holding Fire charges; release fires with the charge; the character cannot walk meanwhile', () => {
    const s = range();
    const c = s.characters[0]!;
    const x0 = charPx(c);
    const ev = run(s, [...repeat(Btn.Fire | Btn.Right, 20), 0]);
    expect(charPx(c)).toBe(x0);
    const fired = ev.find((e) => e.type === 'ProjectileFired');
    expect(fired).toMatchObject({ power: 20, owner: 1 });
    expect(s.projectiles).toHaveLength(1);
  });

  it('a full charge fires by itself at maximum speed', () => {
    const s = range();
    const ev = run(s, repeat(Btn.Fire, 80));
    const fired = ev.filter((e) => e.type === 'ProjectileFired');
    expect(fired).toHaveLength(1); // exactly one shot although Fire stays held
    expect(fired[0]).toMatchObject({ power: 60, speed: toSub(16) });
  });
});

describe('flight', () => {
  it('a 45° full-power shot on flat ground lands near the ideal range v²/g', () => {
    const s = range({ x: 200, map: { ...rangeMap(), mat: rangeMap().mat } });
    const ev = flyUntilDone(s, aimAndFire(s, 45, 60));
    const boom = exploded(ev)!;
    const ideal = (16 * 16) / 0.2; // 1280 px
    expect(boom.hit).toBe('terrain');
    expect(Math.abs(boom.x - 200 - ideal)).toBeLessThan(ideal * 0.03);
  });

  it('wind pushes the shot: +100 right, −100 left, symmetric; even wind 1 is felt', () => {
    const land = (wind: number) => {
      const s = range({ x: 200, wind });
      return exploded(flyUntilDone(s, aimAndFire(s, 45, 40)))!.x;
    };
    const calm = land(0), right = land(100), left = land(-100), breeze = land(1);
    expect(right).toBeGreaterThan(calm + 50);
    expect(left).toBeLessThan(calm - 50);
    expect(Math.abs(right - calm - (calm - left))).toBeLessThanOrEqual(8);
    expect(breeze).toBeGreaterThan(calm); // the remainder accumulator keeps weak wind exact
  });

  it('a projectile with windFactor 0 ignores the wind', () => {
    const heavy: WeaponJson = { ...ROCKET_JSON, id: 'heavy', projectile: { ...ROCKET_JSON.projectile, windFactor: 0 } };
    const land = (wind: number) => {
      const s = range({ x: 200, wind, weapons: [heavy] });
      return exploded(flyUntilDone(s, aimAndFire(s, 45, 40)))!.x;
    };
    expect(land(100)).toBe(land(0));
  });
});

describe('impact and outcomes', () => {
  it('impact carves a crater of the payload radius at the impact point', () => {
    const s = range({ x: 600 }); // right of the thin wall
    const before = countSolid(s.terrain!);
    const ev = flyUntilDone(s, aimAndFire(s, 45, 30));
    const boom = exploded(ev)!;
    expect(boom.radius).toBe(48);
    expect(countSolid(s.terrain!)).toBeLessThan(before - 1000);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'TerrainChanged', cause: 'explosion' }));
    expect(s.terrain!.mat[(boom.y + 5) * 2400 + boom.x]).toBe(0);
    expect(boom.x).toBeGreaterThan(900);
  });

  it('a direct hit on another character explodes on contact', () => {
    const s = range({ x: 200 });
    step(s, 0, [{ type: 'debugSpawnCharacter', x: 320, y: standY(700), team: 1 }]);
    run(s, repeat(0, 30));
    const ev = flyUntilDone(s, aimAndFire(s, 0, 60));
    const boom = exploded(ev)!;
    expect(boom).toMatchObject({ hit: 'character', characterId: 2 });
    expect(Math.abs(boom.x - 320)).toBeLessThanOrEqual(CHAR.radius + 3);
  });

  it('the shooter is safe at launch but a shot straight up comes back down on it', () => {
    const s = range({ x: 300 });
    const ev = flyUntilDone(s, aimAndFire(s, 90, 10));
    const boom = exploded(ev)!;
    expect(boom).toMatchObject({ hit: 'character', characterId: 1 });
  });

  it('firing point-blank into a wall explodes immediately', () => {
    const s = range({ x: 488 }); // right edge of the body at 497, wall at x=500; muzzle at +14 is inside it
    const ev = flyUntilDone(s, aimAndFire(s, 0, 1), 5);
    const boom = exploded(ev)!;
    expect(boom.hit).toBe('terrain');
    expect(Math.abs(boom.x - 502)).toBeLessThanOrEqual(3);
  });

  it('the 1 px wall stops even a full-speed rocket', () => {
    const s = range({ x: 300 });
    const boom = exploded(flyUntilDone(s, aimAndFire(s, 3, 60)))!;
    expect(boom.x).toBeLessThanOrEqual(501);
  });

  it('shots into the water splash without exploding; shots off the map are lost', () => {
    const s = range({ x: 2100 });
    const ev = flyUntilDone(s, aimAndFire(s, 30, 20));
    expect(ev.some((e) => e.type === 'ProjectileSplashed')).toBe(true);
    expect(exploded(ev)).toBeUndefined();
    const s2 = range({ x: 2100 });
    const ev2 = flyUntilDone(s2, aimAndFire(s2, 60, 60));
    expect(ev2.some((e) => e.type === 'ProjectileLost' || e.type === 'ProjectileSplashed')).toBe(true);
  });

  it('a projectile that flies too long is force-triggered', () => {
    const short: WeaponJson = { ...ROCKET_JSON, id: 'short', projectile: { ...ROCKET_JSON.projectile, maxLifeTicks: 5 } };
    const s = range({ x: 300, weapons: [short] });
    const ev = flyUntilDone(s, aimAndFire(s, 60, 30));
    expect(exploded(ev)).toMatchObject({ hit: 'timeout' });
  });
});

describe('wind', () => {
  it('rolls stay in range, move at most ±40 per turn, and are seeded', () => {
    const r = seedRng(5);
    let w = 0;
    let sum = 0;
    for (let i = 0; i < 5000; i++) {
      const n = rollWind(r, w);
      expect(Math.abs(n - w)).toBeLessThanOrEqual(40);
      expect(n).toBeGreaterThanOrEqual(-100);
      expect(n).toBeLessThanOrEqual(100);
      w = n;
      sum += n;
    }
    expect(Math.abs(sum / 5000)).toBeLessThan(20); // no drift to one side
    const a = seedRng(9), b = seedRng(9);
    expect(rollWind(a, 10)).toBe(rollWind(b, 10));
  });

  it('wind commands change the wind and emit an event', () => {
    const s = range();
    const ev = run(s, [0]);
    ev.push(...step(s, 0, [{ type: 'debugSetWind', wind: -35 }]));
    expect(s.wind).toBe(-35);
    ev.push(...step(s, 0, [{ type: 'debugRollWind' }]));
    expect(ev.filter((e) => e.type === 'WindChanged').length).toBeGreaterThanOrEqual(1);
    expect(step(s, 0, [{ type: 'debugSetWind', wind: 500 }])).toEqual([]);
  });

  it('selectWeapon switches the active character weapon', () => {
    const w2: WeaponJson = { ...ROCKET_JSON, id: 'rocket_b' };
    const s = range({ weapons: [ROCKET_JSON, w2] });
    step(s, 0, [{ type: 'selectWeapon', index: 1 }]);
    expect(s.characters[0]!.weapon).toBe(1);
    step(s, 0, [{ type: 'selectWeapon', index: 7 }]);
    expect(s.characters[0]!.weapon).toBe(1);
    expect(SUB).toBe(256);
  });
});
