import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '../src/fixedStepLoop.js';

describe('FixedStepLoop', () => {
  it('runs no steps on the first frame', () => {
    const l = new FixedStepLoop(20);
    expect(l.advance(1000)).toEqual({ steps: 0, alpha: 0, dropped: false });
  });

  it('produces exactly 50 ticks per simulated second at 60 fps', () => {
    const l = new FixedStepLoop(20);
    l.advance(0);
    let total = 0;
    for (let f = 1; f <= 60; f++) total += l.advance((f * 1000) / 60).steps;
    expect(total).toBe(50);
  });

  it('produces 50 ticks per second at 144 fps and at 30 fps', () => {
    for (const fps of [144, 30]) {
      const l = new FixedStepLoop(20);
      l.advance(0);
      let total = 0;
      for (let f = 1; f <= fps * 4; f++) total += l.advance((f * 1000) / fps).steps;
      expect(total).toBe(200);
    }
  });

  it('reports interpolation alpha in [0, 1)', () => {
    const l = new FixedStepLoop(20);
    l.advance(0);
    const r = l.advance(30);
    expect(r.steps).toBe(1);
    expect(r.alpha).toBeCloseTo(0.5);
  });

  it('caps steps after a long stall and drops the backlog', () => {
    const l = new FixedStepLoop(20, 5);
    l.advance(0);
    const r = l.advance(5000);
    expect(r).toEqual({ steps: 5, alpha: 1, dropped: true });
    expect(l.advance(5020).steps).toBe(1);
  });

  it('reset forgets paused time', () => {
    const l = new FixedStepLoop(20);
    l.advance(0);
    l.reset();
    expect(l.advance(10_000).steps).toBe(0);
    expect(l.advance(10_040).steps).toBe(2);
  });
});
