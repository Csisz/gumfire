import type { WeaponJson } from '@gumfire/sim';
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

/**
 * Game content as authored data (plan §6.2: `sim` never imports content; content is handed to
 * the sim through `GameConfig` and compiled there). Order matters: it is the weapon index.
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
] as WeaponJson[];
