import { describe, expect, it } from 'vitest';
import {
  ANGLE_STEPS,
  Hasher,
  QUARTER_TURN,
  SUB,
  TRIG_ONE,
  atan2A,
  chance,
  cosA,
  createStreams,
  degToAngle,
  fdiv,
  fmul,
  hashHex,
  hashString,
  ilength,
  isqrt,
  nextInt,
  nextRange,
  nextU32,
  secondsToTicks,
  seedRng,
  sinA,
  toPx,
  toSub,
  vecFromAngle,
} from '../src/index.js';

describe('units', () => {
  it('converts px ↔ subpixels with floor semantics', () => {
    expect(toSub(1)).toBe(SUB);
    expect(toSub(1.5)).toBe(384);
    expect(toPx(255)).toBe(0);
    expect(toPx(-1)).toBe(-1);
  });
  it('fixed-point multiply/divide', () => {
    expect(fmul(toSub(2), toSub(3))).toBe(toSub(6));
    expect(fmul(toSub(-2), toSub(0.5))).toBe(toSub(-1));
    expect(fdiv(toSub(6), toSub(3))).toBe(toSub(2));
    expect(() => fdiv(1, 0)).toThrow();
  });
  it('seconds → ticks at 50 Hz', () => {
    expect(secondsToTicks(1)).toBe(50);
    expect(secondsToTicks(45)).toBe(2250);
  });
});

describe('integer trig', () => {
  it('has exact cardinal values', () => {
    expect(sinA(0)).toBe(0);
    expect(sinA(QUARTER_TURN)).toBe(TRIG_ONE);
    expect(cosA(0)).toBe(TRIG_ONE);
    expect(cosA(ANGLE_STEPS / 2)).toBe(-TRIG_ONE);
    expect(sinA(ANGLE_STEPS * 3 + 1024)).toBe(TRIG_ONE); // wraps
  });
  it('sin² + cos² ≈ 1 everywhere', () => {
    for (let a = 0; a < ANGLE_STEPS; a++) {
      const m = (sinA(a) ** 2 + cosA(a) ** 2) / TRIG_ONE ** 2;
      expect(Math.abs(m - 1)).toBeLessThan(1e-4);
    }
  });
  it('atan2A inverts vecFromAngle within 1 unit for all angles', () => {
    for (let a = 0; a < ANGLE_STEPS; a++) {
      const v = vecFromAngle(a, 1 << 20);
      const back = atan2A(v.y, v.x);
      const diff = Math.min((back - a + ANGLE_STEPS) % ANGLE_STEPS, (a - back + ANGLE_STEPS) % ANGLE_STEPS);
      expect(diff).toBeLessThanOrEqual(1);
    }
    expect(atan2A(0, 0)).toBe(0);
  });
  it('degToAngle', () => {
    expect(degToAngle(90)).toBe(1024);
    expect(degToAngle(45)).toBe(512);
  });
  it('isqrt is the exact floor sqrt', () => {
    for (let n = 0; n < 5000; n++) {
      const r = isqrt(n);
      expect(r * r).toBeLessThanOrEqual(n);
      expect((r + 1) * (r + 1)).toBeGreaterThan(n);
    }
    const big = Number.MAX_SAFE_INTEGER;
    const r = isqrt(big);
    expect(r * r <= big && (r + 1) * (r + 1) > big).toBe(true);
    expect(ilength(3, 4)).toBe(5);
    expect(() => isqrt(-1)).toThrow();
    expect(() => isqrt(1.5)).toThrow();
  });
});

describe('hash', () => {
  it('matches known FNV-1a vectors', () => {
    // FNV-1a 32 of "" = 0x811c9dc5; of "a" (single byte 0x61) = 0xe40c292c
    expect(new Hasher().digest()).toBe(0x811c9dc5);
    expect(new Hasher().u8(0x61).digest()).toBe(0xe40c292c);
  });
  it('is order-sensitive and handles large/negative ints', () => {
    expect(new Hasher().u32(1).u32(2).digest()).not.toBe(new Hasher().u32(2).u32(1).digest());
    expect(new Hasher().int(-1).digest()).not.toBe(new Hasher().int(1).digest());
    expect(new Hasher().int(2 ** 40).digest()).not.toBe(new Hasher().int(0).digest());
    expect(() => new Hasher().int(0.5)).toThrow();
    expect(hashHex(hashString('gumfire'))).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('rng', () => {
  it('is reproducible from a seed', () => {
    const a = seedRng(42);
    const b = seedRng(42);
    for (let i = 0; i < 1000; i++) expect(nextU32(a)).toBe(nextU32(b));
  });
  it('matches the xoshiro128** reference output for state {1,2,3,4}', () => {
    const r = { s0: 1, s1: 2, s2: 3, s3: 4 };
    const seq = Array.from({ length: 6 }, () => nextU32(r));
    expect(seq).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492]);
  });
  it('produces a stable seeded sequence (guards against accidental seeding changes)', () => {
    const r = seedRng(12345);
    expect(Array.from({ length: 3 }, () => nextU32(r))).toMatchInlineSnapshot(`
      [
        518667457,
        440444462,
        4232892992,
      ]
    `);
  });
  it('nextInt is in range and roughly uniform', () => {
    const r = seedRng(7);
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) counts[nextInt(r, 10)]++;
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(500);
    for (let i = 0; i < 1000; i++) {
      const v = nextRange(r, -5, 5);
      expect(v >= -5 && v <= 5 && Number.isInteger(v)).toBe(true);
    }
    expect(() => nextInt(r, 0)).toThrow();
  });
  it('chance approximates its probability', () => {
    const r = seedRng(99);
    let hits = 0;
    for (let i = 0; i < 20_000; i++) if (chance(r, 1, 4)) hits++;
    expect(Math.abs(hits - 5000)).toBeLessThan(300);
  });
  it('streams are independent: consuming one does not shift another', () => {
    const s1 = createStreams(1);
    const s2 = createStreams(1);
    for (let i = 0; i < 100; i++) nextU32(s1.crates);
    expect(nextU32(s1.wind)).toBe(nextU32(s2.wind));
    expect(s1.wind).not.toEqual(s1.crates);
  });
});
