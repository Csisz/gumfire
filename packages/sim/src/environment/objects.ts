import type { SimEvent } from '../core/events.js';
import { SUB, TICKS_PER_SECOND, toSub } from '../core/units.js';
import { chance, nextRange, type RngState } from '../core/rng.js';
import { makeBody, stepBody, wakeBodiesInRect, type Body } from '../physics/body.js';
import { touchesHitbox, type Character } from '../character/character.js';
import { blastEffect, type Explosion } from '../explosions/explosion.js';
import type { TerrainState } from '../terrain/terrain.js';
import { spawnFires, type Fire } from './fire.js';

/**
 * Map objects (plan §14 environment; Phase 2 hook 26.1 "props with tags"). Mines, barrels and
 * crates are the first props: physics bodies with hit points, tags and data-driven reactions,
 * authored as JSON in `content/props` and compiled into the match state like weapons.
 *
 *   mine   — a proximity trigger arms a seeded fuse; some are duds
 *   barrel — any blast damage sets it off (next tick: chain reactions have a rhythm)
 *   crate  — floats down on a parachute, picked up by touch: health or a weapon
 */
export type PropKind = 'mine' | 'barrel' | 'crate';
export type CrateKind = 'health' | 'weapon';

export interface PropJson {
  id: string;
  name: string;
  kind: PropKind;
  /** Free-form tags systems react to (Phase 2: flammable, conductive, pushable…). */
  tags?: string[];
  radius: number;
  restitution?: number;
  friction?: number;
  /** Gravity while falling: crates float down on a parachute (< 1). */
  gravityScale?: number;
  /** Blast damage it absorbs before it goes off (crates, barrels). */
  hp: number;
  trigger?: { kind: 'proximity'; radius: number; fuseMinSeconds: number; fuseMaxSeconds: number; dudChance: number };
  payload?: {
    explosion?: { radius: number; damage: number; knockback: number; carve: boolean };
    fire?: { count: number; speed: number; lifeSeconds: number; damage: number };
  };
  pickup?: { heal?: number; ammo?: number };
}

export interface PropDef {
  id: string;
  name: string;
  kind: PropKind;
  tags: string[];
  radius: number;
  restitution: number; // ×256
  friction: number; // ×256
  gravityScale: number; // ×256
  hp: number;
  triggerRadius: number; // px, 0 = no proximity trigger
  fuseMin: number; // ticks
  fuseMax: number;
  dudChance: number; // per 1000
  explosionRadius: number;
  damage: number;
  knockback: number; // ×256
  carve: boolean;
  fireCount: number;
  fireSpeed: number; // subpixels/tick
  fireLife: number; // ticks
  fireDamage: number;
  heal: number;
  ammo: number;
}

export class PropDefinitionError extends Error {}

const num = (path: string, v: unknown, lo: number, hi: number, int = false): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi || (int && !Number.isInteger(v))) {
    throw new PropDefinitionError(`${path}: expected ${int ? 'an integer' : 'a number'} in [${lo}, ${hi}], got ${JSON.stringify(v)}`);
  }
  return v;
};

export function compileProp(p: PropJson): PropDef {
  const at = (k: string) => `${p?.id ?? '?'}.${k}`;
  if (!p || typeof p.id !== 'string' || !/^[a-z][a-z0-9_]{1,40}$/.test(p.id)) throw new PropDefinitionError(`bad prop id ${JSON.stringify(p?.id)}`);
  if (!['mine', 'barrel', 'crate'].includes(p.kind)) throw new PropDefinitionError(`${at('kind')}: mine, barrel or crate`);
  const T = p.trigger, E = p.payload?.explosion, F = p.payload?.fire;
  const d: PropDef = {
    id: p.id,
    name: String(p.name ?? p.id),
    kind: p.kind,
    tags: Array.isArray(p.tags) ? p.tags.map(String).sort() : [],
    radius: num(at('radius'), p.radius, 2, 24, true),
    restitution: Math.round(num(at('restitution'), p.restitution ?? 0.2, 0, 1) * SUB),
    friction: Math.round(num(at('friction'), p.friction ?? 0.8, 0, 1) * SUB),
    gravityScale: Math.round(num(at('gravityScale'), p.gravityScale ?? 1, 0.05, 4) * SUB),
    hp: num(at('hp'), p.hp, 1, 999, true),
    triggerRadius: T ? num(at('trigger.radius'), T.radius, 4, 200, true) : 0,
    fuseMin: T ? Math.round(num(at('trigger.fuseMinSeconds'), T.fuseMinSeconds, 0, 10) * TICKS_PER_SECOND) : 0,
    fuseMax: T ? Math.round(num(at('trigger.fuseMaxSeconds'), T.fuseMaxSeconds, T.fuseMinSeconds, 10) * TICKS_PER_SECOND) : 0,
    dudChance: T ? Math.round(num(at('trigger.dudChance'), T.dudChance, 0, 1) * 1000) : 0,
    explosionRadius: E ? num(at('payload.explosion.radius'), E.radius, 0, 200, true) : 0,
    damage: E ? num(at('payload.explosion.damage'), E.damage, 0, 200, true) : 0,
    knockback: E ? Math.round(num(at('payload.explosion.knockback'), E.knockback, 0, 4) * SUB) : 0,
    carve: E?.carve === true,
    fireCount: F ? num(at('payload.fire.count'), F.count, 1, 24, true) : 0,
    fireSpeed: F ? toSub(num(at('payload.fire.speed'), F.speed, 0, 12)) : 0,
    fireLife: F ? Math.round(num(at('payload.fire.lifeSeconds'), F.lifeSeconds, 0.2, 20) * TICKS_PER_SECOND) : 0,
    fireDamage: F ? num(at('payload.fire.damage'), F.damage, 0, 50, true) : 0,
    heal: num(at('pickup.heal'), p.pickup?.heal ?? 0, 0, 200, true),
    ammo: num(at('pickup.ammo'), p.pickup?.ammo ?? 0, 0, 9, true),
  };
  if (p.kind === 'crate' && d.heal === 0 && d.ammo === 0) throw new PropDefinitionError(`${at('pickup')}: a crate gives health or ammo`);
  if (p.kind === 'mine' && d.triggerRadius === 0) throw new PropDefinitionError(`${at('trigger')}: a mine needs a proximity trigger`);
  return d;
}

export function compileProps(list: readonly PropJson[]): PropDef[] {
  const out = list.map(compileProp);
  const seen = new Set<string>();
  for (const d of out) {
    if (seen.has(d.id)) throw new PropDefinitionError(`duplicate prop id ${d.id}`);
    seen.add(d.id);
  }
  return out;
}

export interface WorldObject {
  id: number;
  /** Index into `state.props`. */
  prop: number;
  body: Body;
  hp: number;
  /** Mines: ticks left on an armed fuse; −1 = not armed; −2 = inert (a dud). */
  fuse: number;
  dud: boolean;
  /** Crates: still on the parachute. */
  falling: boolean;
}

export const MAX_OBJECTS = 64;

export function makeObject(id: number, propIndex: number, def: PropDef, x: number, y: number): WorldObject {
  return {
    id,
    prop: propIndex,
    body: makeBody(10_000 + id, x * SUB + SUB / 2, y * SUB + SUB / 2, 0, 0, { radius: def.radius, restitution: def.restitution, friction: def.friction, gravityScale: def.gravityScale }),
    hp: def.hp,
    fuse: -1,
    dud: false,
    falling: def.kind === 'crate',
  };
}

/** What the object does when its time comes. */
export function objectExplosion(o: WorldObject, def: PropDef): Explosion | null {
  if (def.explosionRadius <= 0 && def.damage <= 0) return null;
  return { x: o.body.x >> 8, y: o.body.y >> 8, radius: def.explosionRadius, damage: def.damage, knockback: def.knockback, carve: def.carve, cause: 'object', source: o.id };
}

export interface ObjectWorld {
  objects: WorldObject[];
  props: PropDef[];
  characters: Character[];
  pendingExplosions: Explosion[];
  fires: Fire[];
  nextFireId: number;
  rng: { fuse: RngState; misc: RngState; crates: RngState };
}

/** Set an object off: queue its payload, remove it. */
function detonate(w: ObjectWorld, o: WorldObject, def: PropDef, tick: number, events: SimEvent[]): void {
  const e = objectExplosion(o, def);
  if (e) w.pendingExplosions.push(e);
  if (def.fireCount > 0) w.nextFireId = spawnFires(w.fires, w.nextFireId, o.body.x >> 8, (o.body.y >> 8) - 3, def.fireCount, def.fireSpeed, def.fireLife, def.fireDamage, w.rng.misc);
  events.push({ type: 'ObjectDetonated', tick, id: o.id, prop: def.id, x: o.body.x >> 8, y: o.body.y >> 8 });
}

/**
 * Blast vs objects: push them, damage their hp; barrels and crates with no hp left go off on the
 * NEXT tick (their explosion is queued, and the queue resolves once per tick).
 */
export function blastObjects(e: Explosion, w: ObjectWorld, tick: number, events: SimEvent[]): void {
  const gone = new Set<number>();
  for (const o of w.objects) {
    const def = w.props[o.prop]!;
    if (o.body.drownTicks > 0) continue;
    const fx = blastEffect(e, o.body.x, o.body.y, o.body.radius);
    if (fx.phi === 0) continue;
    o.body.vx += fx.jx;
    o.body.vy += fx.jy;
    o.body.sleeping = false;
    o.body.stillTicks = 0;
    if (def.kind === 'mine' || fx.damage <= 0) continue;
    o.hp -= fx.damage;
    if (o.hp <= 0) {
      detonate(w, o, def, tick, events);
      gone.add(o.id);
    }
  }
  if (gone.size) w.objects = w.objects.filter((o) => !gone.has(o.id));
}

/**
 * Per tick: physics, mine triggers and fuses, crate parachutes and pick-ups.
 * `onPickup` applies a crate's reward (the match owns team ammo).
 */
export function stepObjects(
  w: ObjectWorld,
  t: TerrainState,
  waterY: number,
  tick: number,
  events: SimEvent[],
  onPickup: (o: WorldObject, def: PropDef, c: Character) => void,
): void {
  const keep: WorldObject[] = [];
  for (const o of w.objects) {
    const def = w.props[o.prop]!;
    const res = stepBody(o.body, t, waterY, tick, []);
    if (res.removed) {
      events.push({ type: 'ObjectRemoved', tick, id: o.id, reason: res.removed });
      continue;
    }
    if (o.falling && (res.touched || o.body.sleeping)) {
      o.falling = false; // parachute off
      o.body.gravityScale = SUB;
      events.push({ type: 'CrateLanded', tick, id: o.id, x: o.body.x >> 8, y: o.body.y >> 8 });
    }
    if (def.kind === 'mine') {
      if (o.fuse === -1 && o.body.drownTicks === 0) {
        const r = def.triggerRadius;
        for (const c of w.characters) {
          if (c.state === 'dead' || c.state === 'drowning') continue;
          const dx = (c.body.x - o.body.x) >> 8, dy = (c.body.y - o.body.y) >> 8;
          if (dx * dx + dy * dy <= r * r) {
            o.fuse = nextRange(w.rng.fuse, def.fuseMin, def.fuseMax);
            o.dud = chance(w.rng.fuse, def.dudChance, 1000);
            events.push({ type: 'MineArmed', tick, id: o.id, fuse: o.fuse });
            break;
          }
        }
      } else if (o.fuse >= 0 && o.fuse-- <= 0) {
        if (o.dud) {
          o.fuse = -2;
          events.push({ type: 'MineDud', tick, id: o.id, x: o.body.x >> 8, y: o.body.y >> 8 });
        } else {
          detonate(w, o, def, tick, events);
          continue;
        }
      }
    }
    if (def.kind === 'crate' && o.body.drownTicks === 0) {
      const by = w.characters.find((c) => c.state !== 'dead' && c.state !== 'drowning' && touchesHitbox(c, o.body.x, o.body.y, def.radius));
      if (by) {
        onPickup(o, def, by);
        continue;
      }
    }
    keep.push(o);
  }
  w.objects = keep;
}

export function wakeObjectsInRect(objects: WorldObject[], x0: number, y0: number, x1: number, y1: number): void {
  wakeBodiesInRect(
    objects.map((o) => o.body),
    x0,
    y0,
    x1,
    y1,
  );
}

/** An object is still settling (blocks the damage reveal). */
export function objectInMotion(o: WorldObject): boolean {
  return !o.body.sleeping || o.body.drownTicks > 0 || o.fuse >= 0 || o.falling;
}

/** Projectile vs objects: does a disc of radius r px at (x, y) subpixels touch one? */
export function touchesObject(objects: readonly WorldObject[], x: number, y: number, r: number): WorldObject | undefined {
  for (const o of objects) {
    const dx = (x - o.body.x) >> 4, dy = (y - o.body.y) >> 4;
    const rr = (o.body.radius + r) * 16;
    if (dx * dx + dy * dy <= rr * rr) return o;
  }
  return undefined;
}
