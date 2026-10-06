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
      'popcorn_bomb',
      'pomegranate',
      'jawbreaker',
      'cherry_bomb',
      'mouse_trap',
      'toffee_bomb',
      'gumball_scatter',
      'whisk_uppercut',
      'spatula_shove',
      'fortune_cookie',
      'biscuit_bridge',
      'cocktail_umbrella',
      'soda_jetpack',
      'chopstick_drill',
      'candle_torch',
      'nap_time',
      'licorice_grapple',
    ]);
    expect(defs.filter((d) => d.hidden).map((d) => d.id)).toEqual(['acorn_mortar__bomblet', 'sprinkle_drop__drop', 'popcorn_bomb__bomblet', 'pomegranate__bomblet']);
    for (const d of defs) {
      for (const [k, v] of Object.entries(d)) if (typeof v === 'number') expect(Number.isInteger(v), `${d.id}.${k}`).toBe(true);
      if (d.category === 'ballistic' && !d.hidden && !d.instant) expect(d.speedMax).toBeGreaterThan(d.speedMin);
    }
    const byId = Object.fromEntries(defs.map((d, i) => [d.id, { d, i }]));
    expect(byId.acorn_mortar!.d.clusterChild).toBe(byId.acorn_mortar__bomblet!.i);
    expect(byId.sprinkle_drop!.d.strikeChild).toBe(byId.sprinkle_drop__drop!.i);
    expect(byId.cookie_roller!.d).toMatchObject({ behavior: 'walker', remote: true, fuseTicks: 400 });
    expect(byId.magnet_bomb!.d).toMatchObject({ needsTarget: true, instant: false });
    expect(byId.sprinkle_drop!.d).toMatchObject({ needsTarget: true, instant: true });
    expect(byId.binder_clip!.d).toMatchObject({ category: 'hitscan', shotsPerTurn: 2 });
    // M12: every utility kind exists once; utilities that keep the turn going do not end it
    const utils = defs.filter((d) => d.category === 'utility');
    expect(utils.map((d) => d.utility).sort()).toEqual(['drill', 'girder', 'jetpack', 'parachute', 'rope', 'skip', 'teleport', 'torch']);
    for (const d of utils) expect(d.endsTurn).toBe(d.utility === 'teleport');
    expect(byId.pomegranate!.d.ammo).toBe(0); // crate only
    expect(byId.sprinkle_drop!.d.delayTurns).toBe(2);
    expect(byId.toffee_bomb!.d).toMatchObject({ sticky: true, bounceLow: 0 });
    expect(byId.jawbreaker!.d.bounceLimit).toBe(3);
    expect(byId.gumball_scatter!.d.pellets).toBe(10);
    expect(byId.licorice_grapple!.d).toMatchObject({ ropeLength: 440, ropeShots: 5, ropeMaxSpeed: 14 * 256 });
    // from the rope: thrown, dropped and gun weapons; not melee, strikes or tools
    expect(defs.filter((d) => d.usableFromRope && !d.hidden).every((d) => ['ballistic', 'hitscan', 'deploy'].includes(d.category))).toBe(true);
    expect(byId.cherry_bomb!.d.usableFromRope).toBe(true);
    expect(byId.rolling_pin!.d.usableFromRope).toBe(false);
    // a deploy weapon names a prop that exists
    const props = compileProps(PROPS);
    for (const d of defs.filter((x) => x.category === 'deploy')) expect(props.some((p) => p.id === d.deployProp)).toBe(true);
  });

  it('every prop compiles; one of each kind the match needs', () => {
    const props = compileProps(PROPS);
    expect(props.map((p) => [p.id, p.kind])).toEqual([
      ['gum_mine', 'mine'],
      ['fizz_keg', 'barrel'],
      ['health_crate', 'crate'],
      ['weapon_crate', 'crate'],
      ['utility_crate', 'crate'],
      ['mouse_trap', 'mine'],
    ]);
    for (const p of props) for (const [k, v] of Object.entries(p)) if (typeof v === 'number') expect(Number.isInteger(v), `${p.id}.${k}`).toBe(true);
    expect(props[2]!.heal).toBe(25);
    expect(props[3]!.ammo).toBe(1);
    expect(props[4]).toMatchObject({ ammo: 1, utility: true });
    expect(props[5]!.armDelay).toBe(100);
  });
});
