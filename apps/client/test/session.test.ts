import { describe, expect, it } from 'vitest';
import { Btn, Mat } from '@gumfire/sim';
import { WEAPONS } from '@gumfire/content';
import { MatchSession } from '../src/session';

function flatMap() {
  const width = 800, height = 400;
  const mat = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) for (let y = 300; y < height; y++) mat[y * width + x] = Mat.SOIL;
  return { width, height, mat, waterY: 380 };
}

describe('MatchSession', () => {
  it('records every tick and command so the match replays exactly; stats follow the events', () => {
    const s = new MatchSession({
      seed: 5,
      map: flatMap(),
      weapons: WEAPONS,
      match: { teams: [{ name: 'Mint', spawns: [{ x: 200, y: 290 }] }, { name: 'Cherry', spawns: [{ x: 600, y: 290 }] }], ruleset: { turnSeconds: 3, turnPrepSeconds: 0.2 } },
    });
    for (let t = 0; t < 1500; t++) {
      if (t % 300 === 20) s.command({ type: 'selectWeapon', index: (t / 300) % 2 === 0 ? 1 : 0 });
      const k = t % 300;
      s.tick(k >= 30 && k < 60 ? Btn.Fire : k >= 70 && k < 80 ? Btn.Up : 0);
    }
    expect(s.inputs).toHaveLength(1500);
    expect(s.commands.length).toBeGreaterThan(0);
    expect(s.verify()).toEqual({ ok: true, ticks: 1500 });
    expect(s.stats[0]!.shots + s.stats[1]!.shots).toBeGreaterThan(1);
  });
});
