import { describe, expect, it } from 'vitest';
import { compileWeapons } from '@gumfire/sim';
import { WEAPONS } from '../src/index.js';

describe('content', () => {
  it('every authored weapon compiles to valid integer sim units', () => {
    const defs = compileWeapons(WEAPONS);
    const visible = defs.filter((d) => !d.hidden);
    expect(visible.map((d) => d.id)).toEqual([
      'pepper_rocket',
      'fizz_grenade',
      'rolling_pin',
      'acorn_mortar',
      'cookie_roller',
      'battery_shock',
      'sprinkle_drop',
      'frosting_blaster',
      'binder_clip',
      'boomerang_trowel',
    ]);
    expect(defs.filter((d) => d.hidden).map((d) => d.id)).toEqual(['acorn_mortar__bomblet', 'sprinkle_drop__drop']);
    for (const d of defs) {
      for (const [k, v] of Object.entries(d)) if (typeof v === 'number') expect(Number.isInteger(v), `${d.id}.${k}`).toBe(true);
      if (d.category === 'ballistic' && !d.hidden) expect(d.speedMax).toBeGreaterThan(d.speedMin);
    }
    const byId = Object.fromEntries(defs.map((d, i) => [d.id, { d, i }]));
    expect(byId.acorn_mortar!.d.clusterChild).toBe(byId.acorn_mortar__bomblet!.i);
    expect(byId.sprinkle_drop!.d.strikeChild).toBe(byId.sprinkle_drop__drop!.i);
    expect(byId.cookie_roller!.d).toMatchObject({ behavior: 'walker', remote: true, fuseTicks: 400 });
    expect(byId.battery_shock!.d).toMatchObject({ needsTarget: true, instant: false });
    expect(byId.sprinkle_drop!.d).toMatchObject({ needsTarget: true, instant: true });
    expect(byId.binder_clip!.d).toMatchObject({ category: 'hitscan', shotsPerTurn: 2 });
  });
});
