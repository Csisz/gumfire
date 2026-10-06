import { describe, expect, it } from 'vitest';
import {
  Btn,
  CHAR,
  Mat,
  createGame,
  hashState,
  step,
  type GameState,
  type InputFrame,
  type MapSpec,
  type SimCommand,
  type SimEvent,
  type WeaponJson,
} from '../src/index.js';
import rocket from '../../content/weapons/pepper_rocket.json';
import scatter from '../../content/weapons/gumball_scatter.json';
import jetpack from '../../content/weapons/soda_jetpack.json';
import grapple from '../../content/weapons/licorice_grapple.json';

const LIST = [rocket, scatter, jetpack, grapple] as WeaponJson[];
const W = { rocket: 0, scatter: 1, jetpack: 2, rope: 3 };
const FLOOR = 700;
const CEIL = 400; // underside of the ceiling slab
const standY = FLOOR - CHAR.radius - 1;

/** Range floor at 700 plus a ceiling slab (y 380..399, x 200..1400) and an optional square block. */
function ropeMap(block?: { x: number; y: number; size: number }): MapSpec {
  const width = 2400, height = 800;
  const mat = new Uint8Array(width * height);
  for (let x = 0; x < 2200; x++) for (let y = FLOOR; y < height; y++) mat[y * width + x] = Mat.SOIL;
  for (let x = 200; x <= 1400; x++) for (let y = CEIL - 20; y < CEIL; y++) mat[y * width + x] = Mat.SOIL;
  if (block) for (let x = block.x; x < block.x + block.size; x++) for (let y = block.y; y < block.y + block.size; y++) mat[y * width + x] = Mat.ROCK;
  return { width, height, mat, waterY: 780 };
}

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const ofType = <T extends SimEvent['type']>(ev: SimEvent[], type: T) => ev.filter((e) => e.type === type) as Ev<T>[];

function game(block?: { x: number; y: number; size: number }): GameState {
  return createGame({
    seed: 3,
    map: ropeMap(block),
    weapons: LIST,
    match: {
      teams: [
        { name: 'A', spawns: [{ x: 600, y: standY }] },
        { name: 'B', spawns: [{ x: 1900, y: standY }] },
      ],
      ruleset: { turnPrepSeconds: 0.2, revealSeconds: 0.2, crateChance: 0, mines: 0, barrels: 0, turnSeconds: 60 },
    },
  });
}
function run(s: GameState, n: number, frame: InputFrame = 0, ev: SimEvent[] = [], cmds: SimCommand[] = []): SimEvent[] {
  for (let i = 0; i < n; i++) ev.push(...step(s, frame, i === 0 ? cmds : []));
  return ev;
}
function turnOf(s: GameState, id: number): void {
  for (let i = 0; i < 20000 && !(s.match!.phase === 'turnActive' && s.activeCharacter === id); i++) step(s, 0);
  expect(s.activeCharacter).toBe(id);
}
const me = (s: GameState) => s.characters.find((c) => c.id === s.activeCharacter)!;
const tap = (s: GameState, btn: number = Btn.Fire, ev: SimEvent[] = []) => {
  run(s, 1, btn, ev);
  return run(s, 1, 0, ev);
};
const ammo = (s: GameState, i: number) => s.match!.teams[me(s).team]!.ammo[i];
const pxy = (s: GameState) => ({ x: me(s).body.x >> 8, y: me(s).body.y >> 8 });

/** Gumling 1 hanging from the ceiling straight above it. */
function hanging(block?: { x: number; y: number; size: number }): { s: GameState; ev: SimEvent[] } {
  const s = game(block);
  turnOf(s, 1);
  run(s, 1, 0, [], [{ type: 'selectWeapon', index: W.rope }]);
  me(s).aim = 1024; // straight up
  const ev = tap(s);
  run(s, 20, 0, ev);
  return { s, ev };
}

describe('Licorice Grapple', () => {
  it('shoots up, bites the ceiling, costs one ammo, and hangs', () => {
    const { s, ev } = hanging();
    const c = me(s);
    expect(ofType(ev, 'RopeAttached')[0]).toMatchObject({ x: 600, y: CEIL });
    expect(c.state).toBe('rope');
    expect(ammo(s, W.rope)).toBe(4);
    expect(c.ropeLen >> 8).toBe(standY - CEIL);
    expect(s.match!.phase).toBe('turnActive');
  });

  it('reels in with ↑ and out with ↓, within its limits', () => {
    const { s } = hanging();
    const c = me(s);
    const len0 = c.ropeLen;
    run(s, 50, Btn.Up);
    expect(len0 - c.ropeLen).toBe(50 * 2 * 256);
    run(s, 40);
    expect(pxy(s).y).toBeLessThan(standY - 80);
    run(s, 400, Btn.Up);
    expect(c.ropeLen).toBe(12 * 256); // shortest rope
    run(s, 400, Btn.Down);
    expect(c.ropeLen).toBeLessThanOrEqual(440 * 256);
  });

  it('swings with ← →, and a free swing never gains energy', () => {
    const { s } = hanging();
    const c = me(s);
    run(s, 60, Btn.Up); // lift off the floor
    run(s, 120, Btn.Right);
    expect(Math.abs((c.body.x >> 8) - 600)).toBeGreaterThan(40);
    // let it swing: the turning points must not climb higher and higher
    const tops: number[] = [];
    let prevVx = c.body.vx;
    for (let i = 0; i < 1500; i++) {
      step(s, 0);
      if (Math.sign(c.body.vx) !== Math.sign(prevVx) && prevVx !== 0) tops.push(c.body.y >> 8);
      prevVx = c.body.vx;
    }
    expect(tops.length).toBeGreaterThan(4);
    // smaller y = higher; each turning point at or below the first one (1 px tolerance)
    for (const y of tops.slice(1)) expect(y).toBeGreaterThanOrEqual(tops[0]! - 1);
  });

  it('Space lets go with the momentum; a mid-air re-shot costs a shot, not ammo; landing forfeits the rest', () => {
    const { s } = hanging();
    const c = me(s);
    run(s, 60, Btn.Up);
    run(s, 80, Btn.Right);
    const vx = c.body.vx;
    const ev = tap(s);
    expect(ofType(ev, 'RopeReleased')).toHaveLength(1);
    expect(c.state).toBe('air');
    expect(Math.sign(c.body.vx)).toBe(Math.sign(vx));
    c.aim = 1024;
    tap(s, Btn.Fire, ev);
    run(s, 15, 0, ev);
    expect(ofType(ev, 'RopeShot').at(-1)!.shotsLeft).toBe(4);
    expect(c.state).toBe('rope');
    expect(ammo(s, W.rope)).toBe(4); // still only the first use paid
    tap(s);
    run(s, 300, 0, ev);
    expect(['idle', 'landing']).toContain(c.state);
    expect(c.ropeOn).toBe(false);
    expect(c.ropeShots).toBe(0);
  });

  it('a miss retracts and costs nothing', () => {
    const s = game();
    turnOf(s, 1);
    run(s, 1, 0, [], [{ type: 'selectWeapon', index: W.rope }]);
    me(s).aim = 0;
    me(s).facing = 1; // flat, along open floor air: nothing within 440 px
    const ev = tap(s);
    run(s, 20, 0, ev);
    expect(ofType(ev, 'RopeMissed')).toHaveLength(1);
    expect(ammo(s, W.rope)).toBe(5);
    expect(me(s).state).not.toBe('rope');
  });

  it('wraps round a square block and unwraps when swinging back', () => {
    // a rock block left of the line between the pivot (600, 399) and the Gumling below it
    const { s } = hanging({ x: 540, y: 470, size: 24 });
    const c = me(s);
    run(s, 40, Btn.Up);
    const ev: SimEvent[] = [];
    c.body.vx = -10 * 256; // a hard push to the left
    run(s, 60, 0, ev);
    const wrap = ofType(ev, 'RopeWrapped');
    expect(wrap.length).toBeGreaterThan(0);
    expect(c.ropePivots.length).toBeGreaterThanOrEqual(6);
    // the new pivot hugs the block's corner
    const w = wrap[0]!;
    expect(w.x).toBeGreaterThanOrEqual(530);
    expect(w.x).toBeLessThanOrEqual(570);
    expect(w.y).toBeGreaterThanOrEqual(460);
    expect(w.y).toBeLessThanOrEqual(500);
    // total rope (live + wrapped) is conserved by a wrap
    c.body.vx = 12 * 256;
    c.body.vy = 0;
    run(s, 80, 0, ev);
    expect(ofType(ev, 'RopeUnwrapped').length).toBeGreaterThan(0);
  });

  it('fires a weapon from the rope: ↑ ↓ aim, Space charges, the longer retreat starts', () => {
    const { s } = hanging();
    const c = me(s);
    run(s, 60, Btn.Up);
    run(s, 1, 0, [], [{ type: 'selectWeapon', index: W.rocket }]);
    expect(c.weapon).toBe(W.rocket);
    const len = c.ropeLen;
    run(s, 10, Btn.Down); // aims now, does not reel
    expect(c.ropeLen).toBe(len);
    const ev = run(s, 30, Btn.Fire);
    run(s, 1, 0, ev);
    expect(ofType(ev, 'ProjectileFired')).toHaveLength(1);
    expect(s.match!.phase).toBe('retreat');
    expect(s.match!.retreatTicksLeft).toBeGreaterThan(240); // 5 s, not 3 s
    expect(c.state).toBe('rope'); // still hanging
    // Fire is masked in the retreat; Enter lets go
    tap(s, Btn.Jump);
    expect(c.state).toBe('air');
  });

  it('fires a gun from the jetpack; Enter stops the jetpack', () => {
    const s = game();
    turnOf(s, 1);
    run(s, 1, 0, [], [{ type: 'selectWeapon', index: W.jetpack }]);
    tap(s);
    run(s, 30, Btn.Up);
    run(s, 1, 0, [], [{ type: 'selectWeapon', index: W.scatter }]);
    const c = me(s);
    expect(c.jet).toBe(true);
    const ev = tap(s);
    expect(ofType(ev, 'HitscanFired')).toHaveLength(10);
    expect(s.match!.phase).toBe('retreat');
    tap(s, Btn.Jump, ev);
    expect(c.jet).toBe(false);
  });

  it('golden trajectory: fixed rope inputs give the same state every time', () => {
    const play = () => {
      const { s } = hanging({ x: 540, y: 470, size: 24 });
      for (let t = 0; t < 300; t++) step(s, t < 50 ? Btn.Up : t < 140 ? Btn.Left : t < 200 ? Btn.Right | Btn.Down : 0);
      return { h: hashState(s), at: pxy(s) };
    };
    const a = play();
    expect(play()).toEqual(a);
    expect(a.h.toString(16)).toMatchInlineSnapshot(`"5215befd"`);
  });
});
