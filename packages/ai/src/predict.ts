import { SUB, TICKS_PER_SECOND, makeProjectile, stepProjectile, type Character, type GameState, type SimEvent, type WeaponDef } from '@gumfire/sim';

/**
 * Cheap shot prediction: fly one projectile with the sim's own projectile code over the
 * current terrain (read only — nothing is carved, nobody is hurt) and report where it goes
 * off. Used to rank thousands of aim × power choices before the few best are played out in a
 * full simulation (evaluate.ts).
 */
export interface Landing {
  x: number;
  y: number;
  /** Ticks until it went off. */
  ticks: number;
}

const scratch: SimEvent[] = [];

export function predictLanding(
  s: GameState,
  shooter: Character,
  weaponIndex: number,
  def: WeaponDef,
  shot: { facing: number; aim: number; power: number; fuse: number; dx: number; target: { x: number; y: number } | null },
  maxTicks = 450,
): Landing | null {
  return predictFuses(s, shooter, weaponIndex, def, shot, [shot.fuse], maxTicks)[0] ?? null;
}

/**
 * Like `predictLanding`, for several player fuse settings (seconds) at once: the flight does not
 * depend on the fuse, so one flight with the longest fuse gives where each shorter one goes off.
 */
export function predictFuses(
  s: GameState,
  shooter: Character,
  weaponIndex: number,
  def: WeaponDef,
  shot: { facing: number; aim: number; power: number; dx: number; target: { x: number; y: number } | null },
  fuses: readonly number[],
  maxTicks = 450,
): Array<Landing | null> {
  const t = s.terrain;
  if (!t) return fuses.map(() => null);
  const player = def.playerFuse && def.fuseTicks > 0;
  const longest = player ? Math.max(...fuses) : 0;
  const fake = {
    ...shooter,
    aim: shot.aim,
    facing: shot.facing,
    fuse: player ? longest : shooter.fuse,
    hasTarget: !!shot.target,
    targetX: shot.target ? Math.round(shot.target.x) : 0,
    targetY: shot.target ? Math.round(shot.target.y) : 0,
    body: { ...shooter.body, x: shooter.body.x + shot.dx * SUB },
  } as Character;
  const p = makeProjectile(-1, weaponIndex, def, fake, shot.power);
  const life = Math.min(Math.max(maxTicks, longest * TICKS_PER_SECOND + 2), def.maxLifeTicks > 0 ? def.maxLifeTicks : maxTicks);
  const res: Array<Landing | null | undefined> = fuses.map(() => undefined);
  let open = fuses.length;
  for (let i = 1; i <= life && open > 0; i++) {
    scratch.length = 0;
    const out = stepProjectile(p, def, t, s.characters, s.wind, s.waterY, s.tick + i, scratch, s.objects);
    if (out.kind === 'flying') {
      if (player) {
        // a shorter fuse would have gone off about here
        for (let k = 0; k < fuses.length; k++) {
          if (res[k] === undefined && i === fuses[k]! * TICKS_PER_SECOND) {
            res[k] = { x: pxOf(p.body ? p.body.x : p.x), y: pxOf(p.body ? p.body.y : p.y), ticks: i };
            open--;
          }
        }
      }
      continue;
    }
    const end = out.kind === 'explode' ? { x: out.x, y: out.y, ticks: i } : null; // splash, lost, gone: nothing
    for (let k = 0; k < fuses.length; k++) if (res[k] === undefined) res[k] = end;
    return res as Array<Landing | null>;
  }
  return res.map((r) => r ?? null);
}

const pxOf = (v: number) => v >> 8;

/** A Gumling as the scorer sees it. */
export interface Target {
  id: number;
  x: number;
  y: number;
  hp: number;
  enemy: boolean;
  self: boolean;
}

/**
 * Rough value of an explosion at (x, y): damage to enemies minus (more heavily) damage to
 * friends, plus a little for landing close to an enemy so misses still steer the search.
 */
export function explosionValue(x: number, y: number, radius: number, damage: number, targets: readonly Target[]): number {
  let v = 0, near = 1e9;
  for (const g of targets) {
    const d = Math.hypot(g.x - x, g.y - y);
    if (g.enemy) near = Math.min(near, d);
    const reach = radius + 9;
    if (d >= reach) continue;
    const dmg = Math.min(g.hp, damage * (1 - d / reach) + 4);
    const kill = dmg >= g.hp ? 25 : 0;
    v += g.enemy ? dmg + kill : -(dmg + kill) * (g.self ? 2 : 1.5);
  }
  return v + Math.max(0, 1 - near / 220) * 8;
}
