import type { SimEvent } from '../core/events.js';
import { Btn, isDown, pressed, type InputFrame } from '../core/input.js';
import { SUB, toSub } from '../core/units.js';
import { degToAngle } from '../core/trig.js';
import { isSupported, overlapsDisc } from '../physics/collision.js';
import { findFreeSpot, makeBody, stepBody, type Body } from '../physics/body.js';
import type { TerrainState } from '../terrain/terrain.js';
import type { WeaponDef } from '../weapons/definition.js';

/**
 * Character controller (plan §10). A character is a disc of radius 9 px.
 * - On the ground it moves *kinematically*: whole-pixel steps that follow the surface up or
 *   down by at most `maxStep` px — the deliberate, precise walk that defines the genre.
 * - In the air it is a physics body (jumps, falls, knockback later) until it lands on a
 *   surface gentle enough to stand on.
 * Positions are subpixels; on the ground they sit exactly on the pixel centre.
 */

export type CharState = 'idle' | 'walk' | 'jumpPrep' | 'charging' | 'air' | 'landing' | 'drowning' | 'dead';

export interface Character {
  id: number;
  team: number;
  /** Physics state; `body.id` equals the character id. */
  body: Body;
  state: CharState;
  /** Ticks spent in the current state. */
  stateTicks: number;
  /** −1 = facing left, 1 = facing right. */
  facing: number;
  /** Aim angle in angle units relative to horizontal-forward, positive = up, ±1024 = ±90°. */
  aim: number;
  /** Ticks the aim key has been held (for acceleration). */
  aimHeld: number;
  hp: number;
  /** 0 = none, 1 = forward jump, 2 = backflip (queued during jumpPrep). */
  jumpKind: number;
  /** Fall speed (subpixels/tick) at the moment the last airborne phase ended, for debugging. */
  lastImpact: number;
  /**
   * The next landing deals no fall damage. Set when placed on the map; explosions will set it
   * too (M6: a blast's damage already includes the throw — classic, documented behaviour).
   */
  fallImmune: boolean;
  /** Selected weapon (index into `state.weapons`). */
  weapon: number;
  /** Charge accumulated while holding Fire, in ticks (0..chargeTicks). */
  power: number;
  /** Damage taken but not yet revealed (applied to hp once the world settles — ADR-006). */
  pendingDamage: number;
  /** Fuse for player-set fused weapons, seconds 1..5 (keys 1–5). */
  fuse: number;
  /** Bouncy (high restitution) rather than soft throws for bouncing weapons (Alt toggles). */
  bounceHigh: boolean;
  /** Target point for targeted weapons (setTarget command), whole px. */
  hasTarget: boolean;
  targetX: number;
  targetY: number;
}

export const CHAR = {
  radius: 9,
  hp: 100,
  /** Largest step up or down while walking, px (plan §10.2). */
  maxStep: 6,
  /** Ticks per walked pixel (1 = 50 px/s). */
  walkTicksPerPx: 1,
  /** Crouch before the jump leaves the ground; a second Jump press inside it makes a backflip. */
  jumpPrepTicks: 10,
  landingTicks: 8,
  forwardJump: { vx: toSub(2.5), vy: -toSub(4.5) },
  backflip: { vx: -toSub(1.5), vy: -toSub(7.2) }, // playtests: −1.1 too short, −2.3 too far → ≈ 108 px back
  /** Horizontal speed when walking off a ledge. */
  walkOffVx: toSub(0.6),
  /** Steepest surface a character can land and stand on: normal within 60° of up (cos 60° = 0.5). */
  standMaxSlopeCos: SUB / 2,
  /**
   * Fall damage: floor((vImpact − threshold) × perPx) for vImpact > threshold (plan §9.5).
   * Tuned at M4 from the plan's 5.5/8: a backflip lands at 7.2 px/tick and must never hurt on
   * flat ground, so the threshold sits just above it (≈ 140 px of free fall). Terminal speed
   * (12 px/tick) deals 45; a 200 px ledge ≈ 14.
   */
  fallThreshold: toSub(7.5),
  fallDamagePerPx: 10,
  aimStep: degToAngle(1.5),
  aimStepFast: degToAngle(3),
  aimFastAfter: 12,
  aimMax: degToAngle(90),
  restitution: 70, // ×256 — characters barely bounce
  friction: 200,
} as const;

export const MAX_CHARACTERS = 48;

/**
 * Hit shape for weapons (M9 playtest: shots aimed at a Gumling's head flew over it). The
 * physics body stays a 9 px disc; weapons test a capsule that matches the drawn bean: a segment
 * from the centre up to `up` px above it, thickened by `radius`.
 */
export const HITBOX = { up: 7, radius: 10 } as const;

/** Nearest point (subpixels) of a character's hit capsule to (x, y) subpixels. */
export function hitboxNearest(c: Character, x: number, y: number): { x: number; y: number } {
  const top = c.body.y - HITBOX.up * SUB;
  return { x: c.body.x, y: Math.max(top, Math.min(c.body.y, y)) };
}

/** Does a disc of radius `r` px at (x, y) subpixels touch the character's hit capsule? */
export function touchesHitbox(c: Character, x: number, y: number, r: number): boolean {
  const n = hitboxNearest(c, x, y);
  const dx = (x - n.x) >> 4, dy = (y - n.y) >> 4; // 1/16 px precision keeps the squares small
  const rr = (HITBOX.radius + r) * 16;
  return dx * dx + dy * dy <= rr * rr;
}
const FUSE_BUTTONS = [Btn.Fuse1, Btn.Fuse2, Btn.Fuse3, Btn.Fuse4, Btn.Fuse5] as const;

export function makeCharacter(id: number, team: number, px: number, py: number): Character {
  return {
    id,
    team,
    body: makeBody(id, px * SUB + SUB / 2, py * SUB + SUB / 2, 0, 0, { radius: CHAR.radius, restitution: CHAR.restitution, friction: CHAR.friction }),
    state: 'air',
    stateTicks: 0,
    facing: 1,
    aim: 0,
    aimHeld: 0,
    hp: CHAR.hp,
    jumpKind: 0,
    lastImpact: 0,
    fallImmune: true,
    weapon: 0,
    power: 0,
    pendingDamage: 0,
    fuse: 3,
    bounceHigh: false,
    hasTarget: false,
    targetX: 0,
    targetY: 0,
  };
}

export const charPx = (c: Character) => c.body.x >> 8;
export const charPy = (c: Character) => c.body.y >> 8;

function setState(c: Character, s: CharState): void {
  c.state = s;
  c.stateTicks = 0;
}

function placeAt(c: Character, px: number, py: number): void {
  c.body.x = px * SUB + SUB / 2;
  c.body.y = py * SUB + SUB / 2;
  c.body.vx = 0;
  c.body.vy = 0;
}

const grounded = (s: CharState) => s === 'idle' || s === 'walk' || s === 'jumpPrep' || s === 'charging' || s === 'landing';

/** Fall damage for a landing with this normal impact speed (subpixels/tick). */
export function fallDamage(impact: number): number {
  if (impact <= CHAR.fallThreshold) return 0;
  return Math.floor(((impact - CHAR.fallThreshold) * CHAR.fallDamagePerPx) / SUB);
}

/**
 * One walked pixel in direction `dir`. Searches the target column from `maxStep` px up to
 * `maxStep` px down for a spot where the disc is free and supported (plan §10.2).
 * Returns 'moved', 'blocked' (wall / too steep) or 'ledge' (nothing to stand on: fall).
 */
export function walkStep(t: TerrainState, c: Character, dir: number): 'moved' | 'blocked' | 'ledge' {
  const px = charPx(c), py = charPy(c), r = c.body.radius, nx = px + dir;
  for (let dy = -CHAR.maxStep; dy <= CHAR.maxStep; dy++) {
    if (!overlapsDisc(t, nx, py + dy, r) && isSupported(t, nx, py + dy, r)) {
      placeAt(c, nx, py + dy);
      return 'moved';
    }
  }
  if (!overlapsDisc(t, nx, py, r)) {
    placeAt(c, nx, py);
    return 'ledge';
  }
  return 'blocked';
}

function startFall(c: Character, vx: number, vy: number): void {
  c.body.vx = vx;
  c.body.vy = vy;
  c.body.sleeping = false;
  c.body.stillTicks = 0;
  setState(c, 'air');
}

/**
 * Advance one character one tick. `input`/`prevInput` apply only when `controlled`.
 * Order: survival checks → state logic (ground or air) → water/bounds.
 * Returns the charge (in ticks) when the character fires this tick, otherwise −1; the caller
 * spawns the projectile (the controller does not own the projectile list).
 */
export function stepCharacter(
  c: Character,
  t: TerrainState,
  waterY: number,
  tick: number,
  controlled: boolean,
  input: InputFrame,
  prevInput: InputFrame,
  events: SimEvent[],
  weapon: WeaponDef | null = null,
): number {
  if (c.state === 'dead') return -1;
  c.stateTicks++;

  // ---- drowning: the body sinks; the character dies when it is gone
  if (c.state === 'drowning') {
    const res = stepBody(c.body, t, waterY, tick, []);
    if (res.removed) die(c, tick, 'drowned', events);
    return -1;
  }

  // ---- aim, fuse and bounce settings work in every living state for the controlled character
  if (controlled) {
    for (let k = 0; k < FUSE_BUTTONS.length; k++) {
      if (pressed(prevInput, input, FUSE_BUTTONS[k]!) && c.fuse !== k + 1) {
        c.fuse = k + 1;
        events.push({ type: 'FuseChanged', tick, id: c.id, fuse: c.fuse, bounceHigh: c.bounceHigh });
      }
    }
    if (pressed(prevInput, input, Btn.Alt)) {
      c.bounceHigh = !c.bounceHigh;
      events.push({ type: 'FuseChanged', tick, id: c.id, fuse: c.fuse, bounceHigh: c.bounceHigh });
    }
    const up = isDown(input, Btn.Up), down = isDown(input, Btn.Down);
    if (up !== down) {
      c.aimHeld++;
      const stepA = c.aimHeld > CHAR.aimFastAfter ? CHAR.aimStepFast : CHAR.aimStep;
      c.aim = Math.max(-CHAR.aimMax, Math.min(CHAR.aimMax, c.aim + (up ? stepA : -stepA)));
    } else c.aimHeld = 0;
  }

  let fired = -1;
  if (grounded(c.state)) fired = stepGround(c, t, controlled, input, prevInput, tick, events, weapon);
  else stepAir(c, t, waterY, tick, events);

  const after = c.state as CharState; // the step functions above may have changed it
  if (after === 'dead' || after === 'drowning') return fired;
  // ---- water and bounds while on the ground (air is handled by the body step)
  const py = charPy(c), px = charPx(c);
  if (waterY > 0 && py >= waterY) {
    enterWater(c, tick, events);
    return fired;
  }
  if (px < -200 || px > t.width + 200 || py > t.height + 200) die(c, tick, 'lost', events);
  return fired;
}

function stepGround(
  c: Character,
  t: TerrainState,
  controlled: boolean,
  input: InputFrame,
  prevInput: InputFrame,
  tick: number,
  events: SimEvent[],
  weapon: WeaponDef | null,
): number {
  const r = c.body.radius;
  let px = charPx(c), py = charPy(c);

  // Terrain may have appeared inside us (girder) or vanished beneath us (crater).
  if (overlapsDisc(t, px, py, r)) {
    const free = findFreeSpot(t, px, py, r);
    if (free) {
      px += free.dx;
      py += free.dy;
      placeAt(c, px, py);
    }
  }
  if (!isSupported(t, px, py, r)) {
    // losing the ground while charging drops the shot (classic: falling ends control)
    c.power = 0;
    startFall(c, 0, 0);
    return -1;
  }

  switch (c.state) {
    case 'landing':
      if (c.stateTicks >= CHAR.landingTicks) setState(c, 'idle');
      return -1;
    case 'charging': {
      // Hold Fire to charge; release (or full charge) fires. Losing control cancels.
      if (!controlled || !weapon) {
        c.power = 0;
        setState(c, 'idle');
        return -1;
      }
      if (isDown(input, Btn.Fire) && c.power < weapon.chargeTicks) {
        c.power++;
        if (c.power < weapon.chargeTicks) return -1;
      }
      const power = c.power;
      c.power = 0;
      setState(c, 'idle');
      return power;
    }
    case 'jumpPrep':
      if (controlled && pressed(prevInput, input, Btn.Jump)) c.jumpKind = 2; // double tap → backflip
      if (c.stateTicks >= CHAR.jumpPrepTicks) {
        const j = c.jumpKind === 2 ? CHAR.backflip : CHAR.forwardJump;
        events.push({ type: 'CharacterJumped', tick, id: c.id, kind: c.jumpKind === 2 ? 'backflip' : 'forward' });
        c.jumpKind = 0;
        startFall(c, j.vx * c.facing, j.vy);
      }
      return -1;
    case 'idle':
    case 'walk': {
      if (!controlled) {
        if (c.state === 'walk') setState(c, 'idle');
        return -1;
      }
      if (weapon && pressed(prevInput, input, Btn.Fire)) {
        if (weapon.needsTarget && !c.hasTarget) return -1; // pick a target first
        if (weapon.instant) return 0; // melee and other instant weapons act on the press
        c.power = 1;
        setState(c, 'charging');
        return -1;
      }
      if (pressed(prevInput, input, Btn.Jump)) {
        c.jumpKind = 1;
        setState(c, 'jumpPrep');
        return -1;
      }
      const left = isDown(input, Btn.Left), right = isDown(input, Btn.Right);
      if (left === right) {
        if (c.state === 'walk') setState(c, 'idle');
        return -1;
      }
      const dir = right ? 1 : -1;
      c.facing = dir;
      if (c.state !== 'walk') setState(c, 'walk');
      if (c.stateTicks % CHAR.walkTicksPerPx !== 0) return -1;
      const res = walkStep(t, c, dir);
      if (res === 'ledge') startFall(c, CHAR.walkOffVx * dir, 0);
      return -1;
    }
  }
  return -1;
}

function stepAir(c: Character, t: TerrainState, waterY: number, tick: number, events: SimEvent[]): void {
  const res = stepBody(c.body, t, waterY, tick, []);
  if (res.removed) {
    die(c, tick, res.removed, events);
    return;
  }
  if (res.enteredWater) {
    enterWater(c, tick, events);
    return;
  }
  // Land when touching a surface gentle enough to stand on, or when the body came to rest.
  const standable = res.touched && -res.contactNy >= CHAR.standMaxSlopeCos;
  if (!standable && !c.body.sleeping) return;
  const px = charPx(c);
  let py = charPy(c);
  const r = c.body.radius;
  for (let k = 0; k < 3 && !isSupported(t, px, py, r) && !overlapsDisc(t, px, py + 1, r); k++) py++;
  if (!isSupported(t, px, py, r)) return; // grazed a surface but nothing below yet
  placeAt(c, px, py);
  c.body.sleeping = false;
  c.body.stillTicks = 0;
  c.lastImpact = res.impactSpeed;
  const dmg = c.fallImmune ? 0 : fallDamage(res.impactSpeed);
  c.fallImmune = false;
  events.push({ type: 'CharacterLanded', tick, id: c.id, impact: res.impactSpeed, damage: dmg });
  if (dmg > 0) {
    c.pendingDamage += dmg; // revealed with all other damage once the world settles
    events.push({ type: 'CharacterHit', tick, id: c.id, damage: dmg, pending: c.pendingDamage });
  }
  setState(c, 'landing');
}

function enterWater(c: Character, tick: number, events: SimEvent[]): void {
  if (c.body.drownTicks === 0) c.body.drownTicks = 1;
  c.body.sleeping = false;
  setState(c, 'drowning');
  events.push({ type: 'CharacterEnteredWater', tick, id: c.id });
}

/** Kill a character (drowned, lost off-map, or out of hp at a damage reveal). */
export function killCharacter(c: Character, tick: number, reason: 'drowned' | 'lost' | 'hp', events: SimEvent[]): void {
  die(c, tick, reason, events);
}

function die(c: Character, tick: number, reason: 'drowned' | 'lost' | 'hp', events: SimEvent[]): void {
  c.hp = 0;
  c.pendingDamage = 0;
  setState(c, 'dead');
  events.push({ type: 'CharacterDied', tick, id: c.id, reason });
}
