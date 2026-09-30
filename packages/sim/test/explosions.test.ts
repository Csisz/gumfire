import { describe, expect, it } from 'vitest';
import {
  Btn,
  CHAR,
  DEATH_BLAST,
  SETTLE_TICKS,
  SUB,
  blastEffect,
  charPx,
  createGame,
  degToAngle,
  hashState,
  revealDamage,
  step,
  type Explosion,
  type GameState,
  type InputFrame,
  type SimCommand,
  type SimEvent,
} from '../src/index.js';
import { ROCKET_JSON, rangeMap } from './helpers.js';

const standY = (surface: number) => surface - CHAR.radius - 1;
const FLOOR = 700;

/** Range map with characters standing at the given x positions (ids 1..n). */
function stage(xs: number[], seed = 5): GameState {
  const s = createGame({ seed, map: rangeMap(), weapons: [ROCKET_JSON], wind: 0 });
  step(s, 0, xs.map((x) => ({ type: 'debugSpawnCharacter', x, y: standY(FLOOR), team: 0 }) as SimCommand));
  for (let i = 0; i < 30; i++) step(s, 0);
  for (const c of s.characters) expect(c.state).toBe('idle');
  return s;
}

function run(s: GameState, n: number, frame: InputFrame = 0, ev: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < n; i++) ev.push(...step(s, frame));
  return ev;
}

const boom = (x: number, y: number, r: number, damage: number, knockback = 256): SimCommand => ({
  type: 'debugExplode', x, y, r, damage, knockback,
});

const ofType = <T extends SimEvent['type']>(ev: SimEvent[], type: T) =>
  ev.filter((e) => e.type === type) as Extract<SimEvent, { type: T }>[];

const ex = (radius: number, damage: number, knockback = 256): Explosion => ({
  x: 100, y: 100, radius, damage, knockback, carve: false, cause: 'weapon', source: 0,
});
/** Disc centre `dx`, `dy` px from the blast centre, in subpixels. */
const at = (dx: number, dy: number) => [(100 + dx) * SUB + SUB / 2, (100 + dy) * SUB + SUB / 2] as const;

describe('blast falloff and impulse (pure)', () => {
  it('full damage at the centre, linear falloff to the edge, nothing beyond', () => {
    const e = ex(48, 50);
    expect(blastEffect(e, ...at(0, 0), 9).damage).toBe(50);
    expect(blastEffect(e, ...at(9, 0), 9).damage).toBe(50); // blast touches the disc's centre side
    expect(blastEffect(e, ...at(9 + 24, 0), 9).damage).toBe(25); // edge half-way out
    expect(blastEffect(e, ...at(9 + 48, 0), 9).phi).toBe(0);
    expect(blastEffect(e, ...at(9 + 60, 0), 9)).toEqual({ phi: 0, damage: 0, jx: 0, jy: 0 });
    // monotone
    let prev = 51;
    for (let d = 0; d <= 60; d++) {
      const dmg = blastEffect(e, ...at(d, 0), 9).damage;
      expect(dmg).toBeLessThanOrEqual(prev);
      prev = dmg;
    }
  });

  it('pushes away from the blast with an upward bias; point-blank ≈ 8 px/tick for D50 K1', () => {
    const e = ex(48, 50);
    const right = blastEffect(e, ...at(20, 0), 9);
    expect(right.jx).toBeGreaterThan(0);
    expect(right.jy).toBeLessThan(0); // lifted even though level with the blast
    expect(right.jx).toBeGreaterThan(-right.jy);
    const left = blastEffect(e, ...at(-20, 0), 9);
    expect(left.jx).toBe(-right.jx);
    expect(left.jy).toBe(right.jy);
    const centre = blastEffect(e, ...at(0, 0), 9);
    expect(centre.jx).toBe(0);
    expect(-centre.jy / SUB).toBeGreaterThan(7.5);
    expect(-centre.jy / SUB).toBeLessThan(8.5);
    // knockback scales the push, not the damage
    const strong = blastEffect(ex(48, 50, 512), ...at(20, 0), 9);
    expect(strong.damage).toBe(right.damage);
    expect(Math.abs(strong.jx - 2 * right.jx)).toBeLessThanOrEqual(2);
  });
});

describe('explosions in the world', () => {
  it('damage is pending while things move and revealed after the world settles', () => {
    const s = stage([300]);
    const c = s.characters[0]!;
    const ev = run(s, 1, 0, step(s, 0, [boom(330, 695, 48, 50)]));
    const hit = ofType(ev, 'CharacterHit');
    expect(hit).toHaveLength(1);
    expect(hit[0]!.damage).toBeGreaterThan(10);
    expect(c.hp).toBe(100); // not yet
    expect(c.pendingDamage).toBe(hit[0]!.damage);
    expect(c.state).toBe('air');

    const later: SimEvent[] = [];
    let lastMotion = s.tick;
    for (let i = 0; i < 400 && c.pendingDamage > 0; i++) {
      later.push(...step(s, 0));
      if (c.state === 'air' || c.state === 'landing') lastMotion = s.tick;
    }
    expect(charPx(c)).toBeLessThan(300 - 10); // thrown left, away from the blast
    const dmg = ofType(later, 'CharacterDamaged');
    expect(dmg).toHaveLength(1);
    expect(dmg[0]).toMatchObject({ id: 1, amount: hit[0]!.damage, hp: 100 - hit[0]!.damage });
    expect(dmg[0]!.tick).toBeGreaterThanOrEqual(lastMotion + SETTLE_TICKS);
    expect(ofType(later, 'DamageRevealed')).toEqual([expect.objectContaining({ total: hit[0]!.damage })]);
    // the blast throw never adds fall damage on top
    expect(ofType(later, 'CharacterHit')).toHaveLength(0);
  });

  it('hits from several blasts add up and are revealed as one number', () => {
    const s = stage([300]);
    const ev = run(s, 300, 0, step(s, 0, [boom(280, 690, 30, 20, 0), boom(320, 690, 30, 20, 0)]));
    const hits = ofType(ev, 'CharacterHit');
    expect(hits).toHaveLength(2);
    const total = hits[0]!.damage + hits[1]!.damage;
    expect(ofType(ev, 'CharacterDamaged')).toEqual([expect.objectContaining({ amount: total })]);
    expect(s.characters[0]!.hp).toBe(100 - total);
  });

  it('reveal can be held back (turn system) and triggered explicitly', () => {
    const s = stage([300]);
    s.autoReveal = false;
    run(s, 300, 0, step(s, 0, [boom(300, 670, 30, 30, 0)]));
    const c = s.characters[0]!;
    expect(c.pendingDamage).toBeGreaterThan(0);
    expect(c.hp).toBe(100);
    const ev: SimEvent[] = [];
    revealDamage(s, ev);
    expect(c.hp).toBe(100 - ofType(ev, 'CharacterDamaged')[0]!.amount);
    expect(c.pendingDamage).toBe(0);
  });

  it('reaching 0 hp kills with a death blast that can chain into a neighbour', () => {
    const s = stage([300, 316]);
    const [a, b] = s.characters as [GameState['characters'][0], GameState['characters'][0]];
    a.hp = 1;
    b.hp = 5;
    const ev = run(s, 600, 0, step(s, 0, [boom(285, 670, 20, 50, 0)]));
    expect(ofType(ev, 'CharacterHit').filter((h) => h.id === 2)[0]?.tick).toBeGreaterThan(0);
    const died = ofType(ev, 'CharacterDied');
    expect(died.map((d) => [d.id, d.reason])).toEqual([[1, 'hp'], [2, 'hp']]);
    expect(died[1]!.tick).toBeGreaterThan(died[0]!.tick);
    const deaths = ofType(ev, 'Exploded').filter((e) => e.cause === 'death');
    expect(deaths.map((d) => d.source)).toEqual([1, 2]);
    expect(deaths[0]).toMatchObject({ radius: DEATH_BLAST.radius, damage: DEATH_BLAST.damage });
    expect(a.state).toBe('dead');
    expect(b.state).toBe('dead');
  });

  it('a blast into the water drowns the target; its pending damage is never shown', () => {
    const s = stage([2185]);
    const ev = run(s, 400, 0, step(s, 0, [boom(2165, 695, 40, 30, 512)]));
    expect(ofType(ev, 'CharacterHit')).toHaveLength(1);
    expect(ofType(ev, 'CharacterDied')).toEqual([expect.objectContaining({ id: 1, reason: 'drowned' })]);
    expect(ofType(ev, 'CharacterDamaged')).toHaveLength(0);
  });

  it('loose bodies are pushed too', () => {
    const s = stage([100]);
    step(s, 0, [{ type: 'debugSpawn', x: 600, y: 690, vx: 0, vy: 0, r: 6 }]);
    run(s, 100);
    const ball = s.bodies[0]!;
    expect(ball.sleeping).toBe(true);
    const x0 = ball.x;
    run(s, 5, 0, step(s, 0, [boom(585, 690, 40, 30)]));
    expect(ball.x).toBeGreaterThan(x0 + 5 * SUB);
  });
});

describe('weapons deal damage', () => {
  function fire(s: GameState, deg: number, ticks: number): SimEvent[] {
    const c = s.characters[0]!;
    const ev: SimEvent[] = [];
    const target = degToAngle(deg);
    for (let i = 0; i < 200 && c.aim !== target; i++) {
      const before = c.aim;
      ev.push(...step(s, c.aim < target ? Btn.Up : Btn.Down));
      if (Math.abs(c.aim - target) >= Math.abs(before - target)) break;
    }
    ev.push(...step(s, 0));
    for (let i = 0; i < ticks; i++) ev.push(...step(s, Btn.Fire));
    ev.push(...step(s, 0));
    return run(s, 500, 0, ev);
  }

  it('a direct Pepper Rocket hit costs the target close to full damage; the shooter is unhurt', () => {
    const s = stage([200, 320]);
    step(s, 0, [{ type: 'debugSelect', id: 1 }]);
    fire(s, 0, 60);
    const [shooter, target] = s.characters;
    expect(shooter!.hp).toBe(100);
    expect(target!.hp).toBeLessThanOrEqual(100 - 40);
    expect(target!.hp).toBeGreaterThan(0);
  });

  it('firing point-blank into a wall hurts the shooter', () => {
    const s = stage([488]);
    step(s, 0, [{ type: 'debugSelect', id: 1 }]);
    const ev = fire(s, 0, 1);
    expect(ofType(ev, 'CharacterHit')[0]).toMatchObject({ id: 1 });
    expect(s.characters[0]!.hp).toBeLessThan(100);
  });

  it('explosion outcomes are deterministic', () => {
    const play = () => {
      const s = stage([300, 316, 340], 9);
      s.characters[1]!.hp = 5;
      run(s, 400, 0, step(s, 0, [boom(310, 690, 48, 50)]));
      return hashState(s);
    };
    expect(play()).toBe(play());
  });
});
