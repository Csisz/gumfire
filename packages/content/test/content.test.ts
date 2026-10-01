import { describe, expect, it } from 'vitest';
import { compileProps, compileWeapons } from '@gumfire/sim';
import { PROPS, WEAPONS } from '../src/index.js';

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
      'magnet_bomb',
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
    expect(byId.magnet_bomb!.d).toMatchObject({ needsTarget: true, instant: false });
    expect(byId.sprinkle_drop!.d).toMatchObject({ needsTarget: true, instant: true });
    expect(byId.binder_clip!.d).toMatchObject({ category: 'hitscan', shotsPerTurn: 2 });
  });

  it('every prop compiles; one of each kind the match needs', () => {
    const props = compileProps(PROPS);
    expect(props.map((p) => [p.id, p.kind])).toEqual([
      ['gum_mine', 'mine'],
      ['fizz_keg', 'barrel'],
      ['health_crate', 'crate'],
      ['weapon_crate', 'crate'],
    ]);
    for (const p of props) for (const [k, v] of Object.entries(p)) if (typeof v === 'number') expect(Number.isInteger(v), `${p.id}.${k}`).toBe(true);
    expect(props[2]!.heal).toBe(25);
    expect(props[3]!.ammo).toBe(1);
  });
});
