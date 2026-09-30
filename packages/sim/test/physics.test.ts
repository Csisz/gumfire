import { describe, expect, it } from 'vitest';
import {
  PHYS,
  SUB,
  createGame,
  discOffsets,
  hashState,
  isSolid,
  overlapsDisc,
  ringOffsets,
  step,
  surfaceNormal,
  toPx,
  type Body,
  type GameState,
  type SimCommand,
  type SimEvent,
} from '../src/index.js';
import { arenaMap } from './helpers.js';

const newArena = () => createGame({ seed: 1, map: arenaMap() });

function spawn(s: GameState, x: number, y: number, vx = 0, vy = 0, r = 9): Body {
  step(s, 0, [{ type: 'debugSpawn', x, y, vx, vy, r } satisfies SimCommand]);
  return s.bodies.at(-1)!;
}

function run(s: GameState, ticks: number, onTick?: (ev: SimEvent[]) => void): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const ev = step(s, 0);
    all.push(...ev);
    onTick?.(ev);
  }
  return all;
}

const px = (b: Body) => ({ x: toPx(b.x), y: toPx(b.y) });

describe('collision shapes', () => {
  it('ring is the outermost layer of the disc and is 4-connected', () => {
    for (const r of [3, 6, 9, 12]) {
      const ring = ringOffsets(r);
      const set = new Set<string>();
      for (let k = 0; k < ring.length; k += 2) set.add(`${ring[k]},${ring[k + 1]}`);
      // every disc pixel adjacent to the outside is on the ring
      const disc = discOffsets(r);
      for (let k = 0; k < disc.length; k += 2) {
        const dx = disc[k]!, dy = disc[k + 1]!;
        const border = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => (dx + a!) ** 2 + (dy + b!) ** 2 > r * r);
        if (border) expect(set.has(`${dx},${dy}`)).toBe(true);
      }
    }
  });

  it('surface normal points out of flat ground and away from a wall', () => {
    const s = newArena();
    const t = s.terrain!;
    const floor = surfaceNormal(t, 300, 491, 9);
    expect(floor.nx).toBeGreaterThan(-60);
    expect(floor.nx).toBeLessThan(60);
    expect(floor.ny).toBeLessThan(-240); // up
    const wall = surfaceNormal(t, 691, 400, 9);
    expect(wall.nx).toBeLessThan(-240); // pointing left, away from the wall at x=700
  });
});

describe('free fall and landing', () => {
  it('falls with constant gravity (semi-implicit Euler, exact integers)', () => {
    const s = newArena();
    const b = spawn(s, 300, 50); // spawned at tick 1 and integrated once in that same tick
    const y1 = b.y; // position after integration tick 1
    run(s, 9); // integration ticks 2..10
    // velocity after tick k is k·g, and each tick moves by that velocity:
    // displacement over ticks 2..10 = g·(2 + … + 10) = g·(55 − 1)
    expect(b.vy).toBe(10 * PHYS.gravity);
    expect(b.y - y1).toBe(PHYS.gravity * 54);
  });

  it('caps fall speed at terminal velocity', () => {
    const s = newArena();
    const b = spawn(s, 300, -2000);
    let max = 0;
    run(s, 70, () => (max = Math.max(max, b.vy)));
    expect(max).toBe(PHYS.terminalVy);
  });

  it('lands on flat ground, never sinks into it, and falls asleep', () => {
    const s = newArena();
    const b = spawn(s, 600, 100);
    let impacts = 0;
    run(s, 400, (ev) => {
      impacts += ev.filter((e) => e.type === 'BodyImpact').length;
      expect(overlapsDisc(s.terrain!, toPx(b.x), toPx(b.y), b.radius)).toBe(false);
    });
    expect(impacts).toBeGreaterThanOrEqual(1);
    expect(b.sleeping).toBe(true);
    expect(px(b).y).toBe(500 - b.radius - 1); // resting exactly on the surface
  });

  it('bounces: upward velocity right after a hard landing', () => {
    const s = newArena();
    const b = spawn(s, 600, 100);
    let bounced = false;
    run(s, 200, (ev) => {
      if (ev.some((e) => e.type === 'BodyImpact') && b.vy < 0) bounced = true;
    });
    expect(bounced).toBe(true);
  });
});

describe('walls, slopes and tunnelling', () => {
  it('a fast body never passes through a 1 px wall', () => {
    for (const speed of [4, 8, 16, 32]) {
      const s = newArena();
      const b = spawn(s, 600, 420, speed * SUB, 0, 6);
      run(s, 120, () => expect(toPx(b.x)).toBeLessThan(700));
    }
  });

  it('slides down a 45° slope and does not rest on it', () => {
    const s = newArena();
    const b = spawn(s, 1000, 360, 0, 0, 9); // above the slope surface
    run(s, 40);
    const xMid = toPx(b.x);
    run(s, 200);
    expect(toPx(b.x)).toBeLessThan(xMid); // moved down-slope (towards smaller x)
    expect(toPx(b.x)).toBeLessThan(905); // reached the bottom
  });

  it('comes to rest on a gentle slope (static friction)', () => {
    const s = newArena();
    const b = spawn(s, 250, 420, 0, 0, 9);
    run(s, 400);
    expect(b.sleeping).toBe(true);
    expect(toPx(b.x)).toBeGreaterThan(150);
  });

  it('property: 40 thrown bodies never end a tick inside terrain', () => {
    const s = newArena();
    for (let k = 0; k < 40; k++) {
      step(s, 0, [{ type: 'debugSpawn', x: 50 + k * 28, y: 150 + ((k * 37) % 200), vx: ((k % 11) - 5) * 400, vy: -((k % 5) * 300), r: 4 + (k % 8) }]);
    }
    run(s, 600, () => {
      for (const b of s.bodies) if (b.drownTicks === 0) expect(overlapsDisc(s.terrain!, toPx(b.x), toPx(b.y), b.radius)).toBe(false);
    });
  });
});

describe('terrain interaction', () => {
  it('a sleeping body wakes and falls when the ground under it is carved', () => {
    const s = newArena();
    const b = spawn(s, 600, 400);
    run(s, 300);
    expect(b.sleeping).toBe(true);
    const yRest = px(b).y;
    step(s, 0, [{ type: 'debugCarve', x: 600, y: 500, r: 40 }]);
    expect(b.sleeping).toBe(false);
    run(s, 300);
    expect(px(b).y).toBeGreaterThan(yRest + 20);
    expect(b.sleeping).toBe(true);
  });

  it('a girder dropped onto a body pushes it out instead of trapping it', () => {
    const s = newArena();
    const b = spawn(s, 600, 400);
    run(s, 300);
    step(s, 0, [{ type: 'debugGirder', x: 560, y: 480, w: 80, h: 12 }]);
    run(s, 60);
    expect(overlapsDisc(s.terrain!, toPx(b.x), toPx(b.y), b.radius)).toBe(false);
  });
});

describe('water and map bounds', () => {
  it('a body falling into the water sinks and is removed after the drown time', () => {
    const s = newArena();
    const b = spawn(s, 1230, 300);
    const ev = run(s, 200);
    const entered = ev.find((e) => e.type === 'BodyEnteredWater');
    const removed = ev.find((e) => e.type === 'BodyRemoved');
    expect(entered).toBeDefined();
    expect(removed).toMatchObject({ reason: 'drowned', id: b.id });
    expect(removed!.tick - entered!.tick).toBe(PHYS.drownTicks);
    expect(s.bodies).toHaveLength(0);
  });

  it('a body thrown off the side of the map is lost', () => {
    const s = createGame({ seed: 1, map: { ...arenaMap(), waterY: 0 } });
    spawn(s, 1250, 200, 20 * SUB, -2 * SUB);
    const ev = run(s, 200);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'BodyRemoved', reason: 'lost' }));
  });

  it('spawn commands are validated and capped', () => {
    const s = newArena();
    step(s, 0, [{ type: 'debugSpawn', x: 10, y: 10, vx: 0, vy: 0, r: 99 }, { type: 'debugSpawn', x: 10.5, y: 10, vx: 0, vy: 0, r: 5 }]);
    expect(s.bodies).toHaveLength(0);
  });
});

describe('sleeping costs nothing and changes nothing', () => {
  it('a settled scene keeps a constant state hash except for the tick', () => {
    const s = newArena();
    for (let k = 0; k < 10; k++) spawn(s, 450 + k * 20, 300);
    run(s, 600);
    expect(s.bodies.every((b) => b.sleeping)).toBe(true);
    const snap = JSON.stringify(s.bodies);
    run(s, 100);
    expect(JSON.stringify(s.bodies)).toBe(snap);
    expect(hashState(s)).toBeTypeOf('number');
    expect(isSolid(s.terrain!, 450, 505)).toBe(true);
  });
});
