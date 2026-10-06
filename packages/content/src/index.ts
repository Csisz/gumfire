import type { PropJson, WeaponJson } from '@gumfire/sim';
import pepperRocket from '../weapons/pepper_rocket.json' with { type: 'json' };
import fizzGrenade from '../weapons/fizz_grenade.json' with { type: 'json' };
import rollingPin from '../weapons/rolling_pin.json' with { type: 'json' };
import acornMortar from '../weapons/acorn_mortar.json' with { type: 'json' };
import cookieRoller from '../weapons/cookie_roller.json' with { type: 'json' };
import magnetBomb from '../weapons/magnet_bomb.json' with { type: 'json' };
import sprinkleDrop from '../weapons/sprinkle_drop.json' with { type: 'json' };
import frostingBlaster from '../weapons/frosting_blaster.json' with { type: 'json' };
import binderClip from '../weapons/binder_clip.json' with { type: 'json' };
import boomerangTrowel from '../weapons/boomerang_trowel.json' with { type: 'json' };
import popcornBomb from '../weapons/popcorn_bomb.json' with { type: 'json' };
import pomegranate from '../weapons/pomegranate.json' with { type: 'json' };
import jawbreaker from '../weapons/jawbreaker.json' with { type: 'json' };
import cherryBomb from '../weapons/cherry_bomb.json' with { type: 'json' };
import mouseTrap from '../weapons/mouse_trap.json' with { type: 'json' };
import toffeeBomb from '../weapons/toffee_bomb.json' with { type: 'json' };
import gumballScatter from '../weapons/gumball_scatter.json' with { type: 'json' };
import whiskUppercut from '../weapons/whisk_uppercut.json' with { type: 'json' };
import spatulaShove from '../weapons/spatula_shove.json' with { type: 'json' };
import fortuneCookie from '../weapons/fortune_cookie.json' with { type: 'json' };
import biscuitBridge from '../weapons/biscuit_bridge.json' with { type: 'json' };
import cocktailUmbrella from '../weapons/cocktail_umbrella.json' with { type: 'json' };
import sodaJetpack from '../weapons/soda_jetpack.json' with { type: 'json' };
import chopstickDrill from '../weapons/chopstick_drill.json' with { type: 'json' };
import candleTorch from '../weapons/candle_torch.json' with { type: 'json' };
import napTime from '../weapons/nap_time.json' with { type: 'json' };
import licoriceGrapple from '../weapons/licorice_grapple.json' with { type: 'json' };

/**
 * Game content as authored data (plan §6.2: `sim` never imports content; content is handed to
 * the sim through `GameConfig` and compiled there). Order matters: it is the weapon index (new items are appended so old
 * replays keep their indices; the client groups them into panel rows).
 */
export const WEAPONS: readonly WeaponJson[] = [
  pepperRocket,
  fizzGrenade,
  rollingPin,
  acornMortar,
  cookieRoller,
  magnetBomb,
  sprinkleDrop,
  frostingBlaster,
  binderClip,
  boomerangTrowel,
  popcornBomb,
  pomegranate,
  jawbreaker,
  cherryBomb,
  mouseTrap,
  toffeeBomb,
  gumballScatter,
  whiskUppercut,
  spatulaShove,
  fortuneCookie,
  biscuitBridge,
  cocktailUmbrella,
  sodaJetpack,
  chopstickDrill,
  candleTorch,
  napTime,
  licoriceGrapple,
] as WeaponJson[];

import gumMine from '../props/gum_mine.json' with { type: 'json' };
import fizzKeg from '../props/fizz_keg.json' with { type: 'json' };
import healthCrate from '../props/health_crate.json' with { type: 'json' };
import weaponCrate from '../props/weapon_crate.json' with { type: 'json' };
import utilityCrate from '../props/utility_crate.json' with { type: 'json' };
import mouseTrapProp from '../props/mouse_trap.json' with { type: 'json' };

/** Map objects (mines, barrels, crates), compiled by the sim like weapons. */
export const PROPS: readonly PropJson[] = [gumMine, fizzKeg, healthCrate, weaponCrate, utilityCrate, mouseTrapProp] as PropJson[];
