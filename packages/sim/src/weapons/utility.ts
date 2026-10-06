import type { SimEvent } from '../core/events.js';
import { Btn, isDown, pressed, type InputFrame } from '../core/input.js';
import { SUB, toSub } from '../core/units.js';
import { HALF_TURN, degToAngle, ilength, normalizeAngle, vecFromAngle } from '../core/trig.js';
import { CHAR, charPx, charPy, placeAt, startFall, touchesHitbox, type Character } from '../character/character.js';
import { overlapsDisc } from '../physics/collision.js';
import { PHYS } from '../physics/constants.js';
import { MAX_OBJECTS, makeObject } from '../environment/objects.js';
import { addCapsule, carveCapsule, type EditRect } from '../terrain/edit.js';
import { Mat } from '../terrain/terrain.js';
import { throwCharacter } from '../explosions/explosion.js';
import type { GameState } from '../state/gameState.js';
import type { WeaponDef } from './definition.js';
import { launchVector } from './projectile.js';

/**
 * Utilities and deployables (plan §12.1 "terrain modification", "teleport", "mobility"; M12).
 *
 *   teleport / girder — targeted: validated first, so a refused spot costs no ammo
 *   parachute / jetpack — gear worn in the air, steered with the arrows
 *   drill / torch — the character turns into a tunnelling tool for a few seconds
 *   skip — ends the turn (handled by the turn system)
 *   deploy — places a prop (a mouse trap) in front of the user
 *
 * Gear and tools only work for the controlled character: losing control switches them off
 * (the parachute stays open — it only closes on landing).
 */

export type TerrainEditFn = (r: EditRect | null, cause: 'tunnel' | 'girder') => void;

const EPS_OVERLAP = 1;

// ------------------------------------------------------------------ targeted placement checks
export interface Placement {
  ok: boolean;
  reason: 'blocked' | 'range' | 'water' | '';
}

/** Where a teleport to the character's target would put it, and whether that spot is free. */
export function teleportCheck(s: GameState, c: Character): Placement & { x: number; y: number } {
  const t = s.terrain!;
  const x = c.targetX, y = c.targetY, r = CHAR.radius;
  const bad = (reason: Placement['reason']) => ({ ok: false, reason, x, y });
  if (!c.hasTarget) return bad('blocked');
  if (x < r + 2 || x > t.width - r - 3 || y < r + 2 || y > t.height - r - 3) return bad('range');
  if (s.waterY > 0 && y + r >= s.waterY - 2) return bad('water');
  if (overlapsDisc(t, x, y, r + EPS_OVERLAP)) return bad('blocked');
  for (const o of s.characters) {
    if (o.id === c.id || o.state === 'dead') continue;
    if (touchesHitbox(o, x * SUB + SUB / 2, y * SUB + SUB / 2, r)) return bad('blocked');
  }
  return { ok: true, reason: '', x, y };
}

/** Squared distance (px²) from (px, py) to the segment (ax, ay)–(bx, by), integer maths. */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const qx = px - ax, qy = py - ay;
  const proj = qx * dx + qy * dy;
  if (L2 === 0 || proj <= 0) return qx * qx + qy * qy;
  if (proj >= L2) return (px - bx) * (px - bx) + (py - by) * (py - by);
  return Math.trunc(((qx * qx + qy * qy) * L2 - proj * proj) / L2);
}

/**
 * The girder the character would place: centred on its target, tilted by its aim in 45° steps
 * (flat, rising, upright, falling). Must be within range, out of the water, clear of everyone.
 */
export function girderPlan(s: GameState, c: Character, def: WeaponDef): Placement & { x0: number; y0: number; x1: number; y1: number } {
  const q = Math.round(c.aim / degToAngle(45)) * degToAngle(45);
  const world = normalizeAngle(c.facing >= 0 ? q : HALF_TURN - q);
  const v = vecFromAngle(world, def.girderLength * 128); // half length, ×256
  const hx = Math.trunc(v.x / SUB), hy = Math.trunc(-v.y / SUB);
  const cx = c.targetX, cy = c.targetY;
  const plan = { x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy };
  const bad = (reason: Placement['reason']) => ({ ok: false, reason, ...plan });
  if (!c.hasTarget) return bad('blocked');
  const t = s.terrain!;
  if (cx < 0 || cx >= t.width || cy < -100 || cy >= t.height) return bad('range');
  const dx = cx - charPx(c), dy = cy - charPy(c);
  if (dx * dx + dy * dy > def.girderRange * def.girderRange) return bad('range');
  if (s.waterY > 0 && cy >= s.waterY - 4) return bad('water');
  const half = def.girderThickness >> 1;
  for (const o of s.characters) {
    if (o.state === 'dead') continue;
    const clear = half + CHAR.radius + 2;
    // test the drawn bean (centre and head) against the beam
    if (segDist2(charPx(o), charPy(o), plan.x0, plan.y0, plan.x1, plan.y1) < clear * clear) return bad('blocked');
    if (segDist2(charPx(o), charPy(o) - 7, plan.x0, plan.y0, plan.x1, plan.y1) < clear * clear) return bad('blocked');
  }
  for (const o of s.objects) {
    const clear = half + o.body.radius + 1;
    if (segDist2(o.body.x >> 8, o.body.y >> 8, plan.x0, plan.y0, plan.x1, plan.y1) < clear * clear) return bad('blocked');
  }
  return { ok: true, reason: '', ...plan };
}

// ------------------------------------------------------------------ one-shot uses (Fire pressed)
/**
 * Use a utility that acts on the Fire press. Returns false when it was refused (nothing happens,
 * no ammo is spent). Skip is reported as used; the caller ends the turn.
 */
export function useUtility(s: GameState, c: Character, index: number, def: WeaponDef, edit: TerrainEditFn, events: SimEvent[]): boolean {
  const fail = (reason: 'blocked' | 'range' | 'water') => {
    events.push({ type: 'UtilityFailed', tick: s.tick, id: c.id, weapon: index, reason });
    return false;
  };
  switch (def.utility) {
    case 'teleport': {
      const p = teleportCheck(s, c);
      if (!p.ok) return fail(p.reason || 'blocked');
      placeAt(c, p.x, p.y);
      startFall(c, 0, 0);
      c.fallImmune = true;
      c.hasTarget = false;
      events.push({ type: 'UtilityUsed', tick: s.tick, id: c.id, weapon: index, kind: 'teleport', x: p.x, y: p.y });
      return true;
    }
    case 'girder': {
      const g = girderPlan(s, c, def);
      if (!g.ok) return fail(g.reason || 'blocked');
      const r = addCapsule(s.terrain!, g.x0, g.y0, g.x1, g.y1, def.girderThickness >> 1, Mat.GIRDER);
      edit(r, 'girder');
      c.hasTarget = false;
      events.push({ type: 'GirderPlaced', tick: s.tick, x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 });
      events.push({ type: 'UtilityUsed', tick: s.tick, id: c.id, weapon: index, kind: 'girder', x: c.targetX, y: c.targetY });
      return true;
    }
    case 'drill':
    case 'torch': {
      let dx = 0, dy = SUB; // the drill goes straight down
      if (def.utility === 'torch') {
        // the torch burns along the aim, snapped to flat or 45° up / down
        const a = c.aim > degToAngle(22) ? degToAngle(45) : c.aim < -degToAngle(22) ? -degToAngle(45) : 0;
        const v = launchVector(a, c.facing, SUB);
        dx = v.vx;
        dy = v.vy;
      }
      c.state = 'tool';
      c.stateTicks = 0;
      c.power = 0;
      c.toolTicks = def.toolTicks;
      c.toolDx = dx;
      c.toolDy = dy;
      c.toolWeapon = index;
      c.toolStruck = [];
      events.push({ type: 'GearChanged', tick: s.tick, id: c.id, gear: 'tool', on: true });
      events.push({ type: 'UtilityUsed', tick: s.tick, id: c.id, weapon: index, kind: def.utility, x: charPx(c), y: charPy(c) });
      return true;
    }
    case 'skip':
      events.push({ type: 'UtilityUsed', tick: s.tick, id: c.id, weapon: index, kind: 'skip', x: charPx(c), y: charPy(c) });
      return true;
    default:
      return false; // parachute / jetpack are worn: see stepGear
  }
}

/** Deploy weapon: place its prop just in front of the user (it drops from there). */
export function deployObject(s: GameState, c: Character, def: WeaponDef, events: SimEvent[]): boolean {
  const prop = s.props.findIndex((p) => p.id === def.deployProp);
  if (prop < 0 || s.objects.length >= MAX_OBJECTS || !s.terrain) return false;
  const pd = s.props[prop]!;
  let x = charPx(c) + c.facing * (CHAR.radius + pd.radius + 2), y = charPy(c);
  if (overlapsDisc(s.terrain, x, y, pd.radius)) x = charPx(c); // against a wall: at the feet
  y = Math.min(y, s.terrain.height - pd.radius - 1);
  const o = makeObject(s.nextObjectId++, prop, pd, x, y);
  s.objects.push(o);
  events.push({ type: 'ObjectDeployed', tick: s.tick, id: o.id, prop: pd.id, by: c.id });
  return true;
}

// ------------------------------------------------------------------ worn gear: parachute, jetpack
/** Horizontal speed a parachute drifts at for the given wind, subpixels/tick. */
function chuteDrift(wind: number, def: WeaponDef): number {
  return Math.trunc((wind * def.chuteWind * 3) / (100 * 2)); // full wind × 1 → 1.5 px/tick
}

/**
 * Before the character controller: switch gear on/off from the Fire press and steer it.
 * `gearDef` is the selected weapon when it is a parachute or jetpack (and may be used now).
 * Returns true when the Fire press was used to turn gear on (the caller spends ammo).
 */
export function stepGear(s: GameState, c: Character, controlled: boolean, input: InputFrame, prev: InputFrame, gearDef: WeaponDef | null, index: number, events: SimEvent[]): boolean {
  let used = false;
  if (c.jet && !controlled) {
    c.jet = false;
    c.jetFuel = 0;
    events.push({ type: 'GearChanged', tick: s.tick, id: c.id, gear: 'jet', on: false });
  }
  const fire = controlled && pressed(prev, input, Btn.Fire);
  // the jetpack stops on Space with the jetpack in hand, or on Enter with anything in hand
  if (c.jet && controlled && (pressed(prev, input, Btn.Jump) || (fire && s.weapons[c.weapon]?.utility === 'jetpack'))) {
    // Fire again: jetpack off (fall from here)
    c.jet = false;
    c.jetFuel = 0;
    events.push({ type: 'GearChanged', tick: s.tick, id: c.id, gear: 'jet', on: false });
  } else if (fire && gearDef?.utility === 'parachute' && c.state === 'air' && !c.chute) {
    c.chute = true;
    used = true;
    events.push({ type: 'GearChanged', tick: s.tick, id: c.id, gear: 'chute', on: true });
    events.push({ type: 'UtilityUsed', tick: s.tick, id: c.id, weapon: index, kind: 'parachute', x: charPx(c), y: charPy(c) });
  } else if (fire && gearDef?.utility === 'jetpack' && (c.state === 'air' || c.state === 'idle' || c.state === 'walk')) {
    c.jet = true;
    c.jetFuel = gearDef.jetFuel;
    c.chute = false;
    used = true;
    if (c.state !== 'air') {
      startFall(c, 0, -toSub(3)); // lift off
      c.fallImmune = false;
    }
    events.push({ type: 'GearChanged', tick: s.tick, id: c.id, gear: 'jet', on: true });
    events.push({ type: 'UtilityUsed', tick: s.tick, id: c.id, weapon: index, kind: 'jetpack', x: charPx(c), y: charPy(c) });
  }
  // a jetpack on the ground: ↑ takes off again
  if (c.jet && controlled && isDown(input, Btn.Up) && (c.state === 'idle' || c.state === 'walk' || c.state === 'landing')) {
    startFall(c, 0, -toSub(3));
    c.fallImmune = true;
  }
  if (c.state !== 'air') return used;
  const b = c.body;
  const left = controlled && isDown(input, Btn.Left), right = controlled && isDown(input, Btn.Right);
  if (left !== right) c.facing = right ? 1 : -1;
  if (c.jet) {
    const def = jetDef(s, c, gearDef);
    const thrust = def ? def.jetThrust : toSub(0.4);
    let burn = false;
    if (controlled && isDown(input, Btn.Up)) {
      b.vy -= thrust;
      burn = true;
    }
    if (left !== right) {
      b.vx += (right ? 1 : -1) * (thrust >> 1);
      burn = true;
    }
    b.vx = Math.max(-toSub(3), Math.min(toSub(3), b.vx));
    b.vy = Math.max(-toSub(4), b.vy);
    b.sleeping = false;
    b.stillTicks = 0;
    c.fallImmune = true; // a controlled flight lands softly…
    if (burn && --c.jetFuel <= 0) {
      c.jet = false;
      c.jetFuel = 0;
      c.fallImmune = false; // …running dry does not
      events.push({ type: 'GearChanged', tick: s.tick, id: c.id, gear: 'jet', on: false });
    }
  } else if (c.chute) {
    const def = chuteDef(s, c, gearDef);
    const fall = def ? def.chuteFall : toSub(1);
    const g = (PHYS.gravity * b.gravityScale) >> 8;
    if (b.vy > fall - g) b.vy = fall - g; // gravity is added by the body step
    const want = (def ? chuteDrift(s.wind, def) : 0) + (left !== right ? (right ? 1 : -1) * toSub(0.75) : 0);
    b.vx += Math.max(-16, Math.min(16, want - b.vx));
    c.fallImmune = true;
  }
  return used;
}

/** The def that drives worn gear: the selected one if it matches, else the first in the set. */
function jetDef(s: GameState, c: Character, sel: WeaponDef | null): WeaponDef | undefined {
  if (sel?.utility === 'jetpack') return sel;
  const w = s.weapons[c.weapon];
  return w?.utility === 'jetpack' ? w : s.weapons.find((d) => d.utility === 'jetpack');
}
function chuteDef(s: GameState, c: Character, sel: WeaponDef | null): WeaponDef | undefined {
  if (sel?.utility === 'parachute') return sel;
  const w = s.weapons[c.weapon];
  return w?.utility === 'parachute' ? w : s.weapons.find((d) => d.utility === 'parachute');
}

// ------------------------------------------------------------------ tunnelling tools
function endTool(s: GameState, c: Character, events: SimEvent[]): void {
  c.toolTicks = 0;
  c.toolStruck = [];
  startFall(c, 0, 0);
  c.fallImmune = true;
  events.push({ type: 'GearChanged', tick: s.tick, id: c.id, gear: 'tool', on: false });
}

/**
 * One tick of a drill / torch: carve ahead, move, burn whoever is in the way. Ends when the time
 * is up, Fire is pressed again, control is lost, or the way is blocked (rock, girder, map edge).
 */
export function stepTool(s: GameState, c: Character, controlled: boolean, input: InputFrame, prev: InputFrame, edit: TerrainEditFn, events: SimEvent[]): void {
  const def = s.weapons[c.toolWeapon];
  const t = s.terrain!;
  if (!def || !controlled || c.toolTicks <= 0 || (c.stateTicks > 2 && pressed(prev, input, Btn.Fire))) {
    endTool(s, c, events);
    return;
  }
  c.stateTicks++;
  c.toolTicks--;
  const r = def.toolRadius;
  const b = c.body;
  const nx = b.x + Math.trunc((c.toolDx * def.toolSpeed) / SUB);
  const ny = b.y + Math.trunc((c.toolDy * def.toolSpeed) / SUB);
  // carve a little ahead of the body so it never pushes into soil
  const ahead = r - CHAR.radius + 2;
  const ax = (nx >> 8) + Math.trunc((c.toolDx * ahead) / SUB), ay = (ny >> 8) + Math.trunc((c.toolDy * ahead) / SUB);
  edit(carveCapsule(t, b.x >> 8, b.y >> 8, ax, ay, r), 'tunnel');
  if (overlapsDisc(t, nx >> 8, ny >> 8, CHAR.radius) || (nx >> 8) < CHAR.radius || (nx >> 8) > t.width - CHAR.radius - 1 || (ny >> 8) > t.height - CHAR.radius - 1) {
    endTool(s, c, events); // rock, girder or the map edge
    return;
  }
  b.x = nx;
  b.y = ny;
  b.vx = 0;
  b.vy = 0;
  if (def.toolDamage > 0) {
    // the flame at the tip burns each character once per use and nudges it away
    const tipX = b.x + c.toolDx * (CHAR.radius + 4), tipY = b.y + c.toolDy * (CHAR.radius + 4);
    for (const o of s.characters) {
      if (o.id === c.id || o.state === 'dead' || o.state === 'drowning' || c.toolStruck.includes(o.id)) continue;
      if (!touchesHitbox(o, tipX, tipY, 4)) continue;
      c.toolStruck.push(o.id);
      o.pendingDamage += def.toolDamage;
      events.push({ type: 'CharacterHit', tick: s.tick, id: o.id, damage: def.toolDamage, pending: o.pendingDamage });
      const len = Math.max(1, ilength(c.toolDx, c.toolDy));
      throwCharacter(o, Math.trunc((c.toolDx * toSub(2)) / len), -toSub(2));
    }
  }
  if (s.waterY > 0 && (b.y >> 8) >= s.waterY) endTool(s, c, events);
}
