import { describe, expect, it } from 'vitest';
import { compileWeapons } from '@gumfire/sim';
import { WEAPONS } from '../src/index.js';

describe('content', () => {
  it('every authored weapon compiles to valid sim units', () => {
    const defs = compileWeapons(WEAPONS);
    expect(defs.map((d) => d.id)).toEqual(['pepper_rocket', 'fizz_grenade', 'rolling_pin']);
    for (const d of defs) {
      for (const v of Object.values(d)) if (typeof v === 'number') expect(Number.isInteger(v)).toBe(true);
      if (d.category === 'ballistic') expect(d.speedMax).toBeGreaterThan(d.speedMin);
      else expect(d.meleeReach).toBeGreaterThan(0);
    }
    const grenade = defs[1]!;
    expect(grenade).toMatchObject({ impact: false, fuseTicks: 150, playerFuse: true, windFactor: 0 });
    expect(grenade.bounceHigh).toBeGreaterThan(grenade.bounceLow);
  });
});
