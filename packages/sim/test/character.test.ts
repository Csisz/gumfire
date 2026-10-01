import { describe, expect, it } from 'vitest';
import {
  Btn,
  CHAR,
  SUB,
  charPx,
  charPy,
  cloneState,
  createGame,
  fallDamage,
  hashState,
  overlapsDisc,
  step,
  toSub,
  type Character,
  type GameState,
  type InputFrame,
  type SimEvent,
} from '../src/index.js';
import { charArenaMap } from './helpers.js';

const R = CHAR.radius;
/** Pixel y of a character standing on a surface whose first solid row is `surface`. */
const standY = (surface: number) => surface - R - 1;

function setup(x: number, surfaceY: number): { s: GameState; c: Character } {
  const s = createGame({ seed: 4, map: charArenaMap() });
  step(s, 0, [{ type: 'debugSpawnCharacter', x, y: standY(surfaceY), team: 0 }, { type: 'debugSelect', id: 1 }]);
  const c = s.characters[0]!;
  for (let i = 0; i < 30 && c.state !== 'idle'; i++) step(s, 0);
  expect(c.state).toBe('idle');
  return { s, c };
}

function hold(s: GameState, frame: InputFrame, ticks: number, sink?: SimEvent[]): void {
  for (let i = 0; i < ticks; i++) {
    const ev = step(s, frame);
    sink?.push(...ev);
  }
}

describe('spawn and landing', () => {
  it('placement is fall-immune: a high drop on spawn does no damage, the next fall does', () => {
    const s = createGame({ seed: 1, map: charArenaMap() });
    step(s, 0, [{ type: 'debugSpawnCharacter', x: 780, y: 20, team: 0 }, { type: 'debugSelect', id: 1 }]);
    hold(s, 0, 120);
    const c = s.characters[0]!;
    expect(c.state).toBe('idle');
    expect(c.hp).toBe(100);
    expect(c.lastImpact).toBeGreaterThan(CHAR.fallThreshold);
    expect(c.fallImmune).toBe(false);
  });

  it('a spawned character drops onto the floor and stands on it without damage', () => {
    const s = createGame({ seed: 1, map: charArenaMap() });
    const ev: SimEvent[] = [];
    ev.push(...step(s, 0, [{ type: 'debugSpawnCharacter', x: 150, y: 450, team: 2 }]));
    hold(s, 0, 60, ev);
    const c = s.characters[0]!;
    expect(c.state).toBe('idle');
    expect(charPy(c)).toBe(standY(500));
    expect(c.hp).toBe(100);
    expect(ev.filter((e) => e.type === 'CharacterLanded')).toHaveLength(1);
  });
});

describe('walking', () => {
  it('walks exactly 1 px per tick on flat ground and turns to face the direction', () => {
    const { s, c } = setup(100, 500);
    const x0 = charPx(c);
    hold(s, Btn.Right, 50);
    expect(charPx(c) - x0).toBe(50);
    expect(c.facing).toBe(1);
    expect(charPy(c)).toBe(standY(500));
    hold(s, Btn.Left, 10);
    expect(charPx(c) - x0).toBe(40);
    expect(c.facing).toBe(-1);
    expect(c.state).toBe('walk');
    hold(s, 0, 1);
    expect(c.state).toBe('idle');
  });

  it('steps up 6 px but is blocked by a 10 px step', () => {
    const { s, c } = setup(270, 500);
    hold(s, Btn.Right, 200);
    expect(charPy(c)).toBe(standY(494)); // climbed the 6 px step
    // the 10 px step at x=400 stops it (vertical steps up to the 9 px radius are climbable)
    expect(charPx(c) + R).toBeLessThan(400);
    expect(c.facing).toBe(1);
  });

  it('never walks up a 200 px wall', () => {
    const { s, c } = setup(560, 500);
    hold(s, Btn.Right, 200);
    expect(charPx(c) + R).toBeLessThan(600);
    expect(charPy(c)).toBeGreaterThan(400);
  });

  it('holding both directions or neither does nothing', () => {
    const { s, c } = setup(100, 500);
    const x0 = charPx(c);
    hold(s, Btn.Left | Btn.Right, 30);
    hold(s, 0, 30);
    expect(charPx(c)).toBe(x0);
  });

  it('only the active character receives input', () => {
    const { s, c } = setup(100, 500);
    step(s, 0, [{ type: 'debugSpawnCharacter', x: 200, y: standY(500), team: 1 }]);
    hold(s, 0, 30);
    const other = s.characters[1]!;
    const x1 = charPx(other);
    hold(s, Btn.Right, 20);
    expect(charPx(other)).toBe(x1);
    expect(charPx(c)).toBeGreaterThan(100);
    step(s, 0, [{ type: 'debugSelect', id: other.id }]);
    hold(s, Btn.Left, 20);
    expect(charPx(other)).toBeLessThan(x1);
  });
});

describe('ledges and fall damage', () => {
  it('walks off a 200 px drop, falls and takes fall damage matching the formula', () => {
    const { s, c } = setup(0, 500);
    // teleport-free setup: spawn on the plateau instead
    const p = createGame({ seed: 4, map: charArenaMap() });
    step(p, 0, [{ type: 'debugSpawnCharacter', x: 780, y: standY(300), team: 0 }, { type: 'debugSelect', id: 1 }]);
    const ch = p.characters[0]!;
    hold(p, 0, 30);
    expect(ch.state).toBe('idle');
    const ev: SimEvent[] = [];
    hold(p, Btn.Right, 150, ev);
    const landed = ev.find((e) => e.type === 'CharacterLanded');
    expect(landed).toBeDefined();
    if (landed?.type !== 'CharacterLanded') throw new Error('no landing');
    expect(landed.damage).toBe(fallDamage(landed.impact));
    expect(landed.damage).toBeGreaterThan(5);
    expect(ch.hp).toBe(100 - landed.damage);
    expect(charPy(ch)).toBe(standY(500));
    void s;
    void c;
  });

  it('small drops do no damage (below 7.5 px/tick at impact)', () => {
    const { s, c } = setup(1080, 500);
    // walk left then right along the floor, then onto the 30 px ledge side: drop down 30 px
    const p = createGame({ seed: 4, map: charArenaMap() });
    step(p, 0, [{ type: 'debugSpawnCharacter', x: 1110, y: standY(470), team: 0 }, { type: 'debugSelect', id: 1 }]);
    const ch = p.characters[0]!;
    hold(p, 0, 30);
    const ev: SimEvent[] = [];
    hold(p, Btn.Left, 80, ev);
    const landed = ev.find((e) => e.type === 'CharacterLanded');
    expect(landed).toMatchObject({ damage: 0 });
    expect(ch.hp).toBe(100);
    void s;
    void c;
  });

  it('fallDamage follows floor((v − 7.5 px/tick) × 10)', () => {
    expect(fallDamage(toSub(7.5))).toBe(0);
    expect(fallDamage(toSub(8))).toBe(5);
    expect(fallDamage(toSub(12))).toBe(45);
  });

  it('a backflip on flat ground never hurts', () => {
    const { s, c } = setup(260, 500);
    hold(s, Btn.Jump, 1);
    hold(s, 0, 2);
    hold(s, Btn.Jump, 1);
    hold(s, 0, 150);
    expect(c.state).toBe('idle');
    expect(c.hp).toBe(100);
    expect(c.lastImpact).toBeGreaterThan(toSub(7));
  });
});

describe('jumping', () => {
  it('a forward jump crosses a 40 px gap: moves forward, leaves and lands on the ground', () => {
    const { s, c } = setup(100, 500);
    const x0 = charPx(c);
    const ev: SimEvent[] = [];
    hold(s, Btn.Right, 1, ev); // face right (walks 1 px)
    hold(s, Btn.Jump, 1, ev);
    hold(s, 0, 120, ev);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'CharacterJumped', kind: 'forward' }));
    expect(charPx(c) - x0).toBeGreaterThan(50);
    expect(c.state).toBe('idle');
    expect(c.hp).toBe(100);
  });

  it('double-tap makes a backflip: higher, backwards', () => {
    const { s, c } = setup(260, 500);
    hold(s, Btn.Right, 1);
    const x0 = charPx(c);
    const y0 = charPy(c);
    const ev: SimEvent[] = [];
    hold(s, Btn.Jump, 1, ev);
    hold(s, 0, 2, ev);
    hold(s, Btn.Jump, 1, ev); // second tap inside the crouch
    let apex = y0;
    for (let i = 0; i < 150; i++) {
      ev.push(...step(s, 0));
      apex = Math.min(apex, charPy(c));
    }
    expect(ev).toContainEqual(expect.objectContaining({ type: 'CharacterJumped', kind: 'backflip' }));
    expect(y0 - apex).toBeGreaterThanOrEqual(120); // plan: reaches ledges ≈ 125 px up
    expect(x0 - charPx(c)).toBeGreaterThan(90); // playtests: a real leap back, not a hop, not a long jump
    expect(c.facing).toBe(1); // a backflip keeps facing
  });

  it('a jump into a wall does not get stuck inside it', () => {
    const { s, c } = setup(585, 500);
    hold(s, Btn.Right, 1);
    hold(s, Btn.Jump, 1);
    for (let i = 0; i < 120; i++) {
      step(s, 0);
      expect(overlapsDisc(s.terrain!, charPx(c), charPy(c), R)).toBe(false);
    }
    expect(c.state).toBe('idle');
  });
});

describe('aim', () => {
  it('aims up/down in 1.5° steps, accelerates, and clamps at ±90°', () => {
    const { s, c } = setup(100, 500);
    hold(s, Btn.Up, 1);
    expect(c.aim).toBe(CHAR.aimStep);
    hold(s, Btn.Up, 200);
    expect(c.aim).toBe(CHAR.aimMax);
    hold(s, Btn.Down, 400);
    expect(c.aim).toBe(-CHAR.aimMax);
  });
});

describe('terrain and water', () => {
  it('falls when the ground under it is carved away, and lands lower', () => {
    const { s, c } = setup(150, 500);
    step(s, 0, [{ type: 'debugCarve', x: 150, y: 505, r: 30 }]);
    hold(s, 0, 100);
    expect(c.state).toBe('idle');
    expect(charPy(c)).toBeGreaterThan(standY(500) + 15);
  });

  it('a girder placed on it pops it out on top', () => {
    const { s, c } = setup(150, 500);
    step(s, 0, [{ type: 'debugGirder', x: 120, y: 480, w: 64, h: 12 }]);
    hold(s, 0, 40);
    expect(overlapsDisc(s.terrain!, charPx(c), charPy(c), R)).toBe(false);
    expect(charPy(c)).toBeLessThan(480);
  });

  it('walking into the pit drowns it', () => {
    const p = createGame({ seed: 4, map: charArenaMap() });
    step(p, 0, [{ type: 'debugSpawnCharacter', x: 980, y: standY(500), team: 0 }, { type: 'debugSelect', id: 1 }]);
    const ch = p.characters[0]!;
    hold(p, 0, 30);
    const ev: SimEvent[] = [];
    hold(p, Btn.Right, 60, ev);
    hold(p, 0, 150, ev);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'CharacterEnteredWater' }));
    expect(ev).toContainEqual(expect.objectContaining({ type: 'CharacterDied', reason: 'drowned' }));
    expect(ch.state).toBe('dead');
    // dead characters ignore input and cannot be selected
    step(p, 0, [{ type: 'debugSelect', id: 0 }]);
    step(p, 0, [{ type: 'debugSelect', id: ch.id }]);
    expect(p.activeCharacter).toBe(0);
  });

  it('cannot stand on a 70° ramp: slides off it', () => {
    const p = createGame({ seed: 4, map: charArenaMap() });
    step(p, 0, [{ type: 'debugSpawnCharacter', x: 548, y: 380, team: 0 }]);
    const ch = p.characters[0]!;
    hold(p, 0, 200);
    expect(ch.state).toBe('idle');
    expect(charPy(ch)).toBe(standY(500));
  });
});

describe('determinism with characters', () => {
  it('scripted walking and jumping replays identically and survives cloning', () => {
    // symmetric: walk right + jump right, walk left + jump left, aim; stays on the map
    const script = (t: number): InputFrame => {
      const k = t % 240;
      if (k < 40) return Btn.Right;
      if (k === 40 || k === 141) return Btn.Jump;
      if (k >= 101 && k < 141) return Btn.Left;
      if (k >= 201) return Btn.Up;
      return 0;
    };
    const run = () => {
      const s = createGame({ seed: 9, map: charArenaMap() });
      step(s, 0, [{ type: 'debugSpawnCharacter', x: 250, y: 450, team: 0 }, { type: 'debugSelect', id: 1 }]);
      for (let t = 0; t < 1200; t++) step(s, script(t));
      return s;
    };
    const a = run();
    const b = run();
    expect(hashState(a)).toBe(hashState(b));
    const c = cloneState(a);
    for (let t = 0; t < 300; t++) {
      step(a, script(t));
      step(c, script(t));
    }
    expect(hashState(c)).toBe(hashState(a));
    const ch = a.characters[0]!;
    expect(ch.state).not.toBe('dead');
    for (let t = 0; t < 100; t++) step(a, 0); // let any jump in flight finish
    expect(ch.state).toBe('idle');
    expect(ch.body.x % SUB).toBe(SUB / 2); // grounded: exactly on a pixel centre
  });
});
