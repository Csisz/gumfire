import { describe, expect, it } from 'vitest';
import { compileWeapons } from '@gumfire/sim';
import { WEAPONS } from '../src/index.js';

describe('content', () => {
  it('every authored weapon compiles to valid sim units', () => {
    const defs = compileWeapons(WEAPONS);
    expect(defs.map((d) => d.id)).toContain('pepper_rocket');
    for (const d of defs) {
      expect(d.speedMax).toBeGreaterThan(d.speedMin);
      expect(Number.isInteger(d.speedMax)).toBe(true);
    }
  });
});
