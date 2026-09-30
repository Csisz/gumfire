import type { WeaponJson } from '@gumfire/sim';
import pepperRocket from '../weapons/pepper_rocket.json' with { type: 'json' };

/**
 * Game content as authored data (plan §6.2: `sim` never imports content; content is handed to
 * the sim through `GameConfig` and compiled there). Order matters: it is the weapon index.
 */
export const WEAPONS: readonly WeaponJson[] = [pepperRocket as WeaponJson];
