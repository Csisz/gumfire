import { sanitizeCommand, type SimCommand } from './core/commands.js';
import type { SimEvent } from './core/events.js';
import { sanitizeInput, type InputFrame } from './core/input.js';
import { MAX_BODIES, makeBody, stepBodies, wakeBodiesInRect } from './physics/body.js';
import { MAX_CHARACTERS, makeCharacter, stepCharacter } from './character/character.js';
import { rollWind } from './environment/wind.js';
import { makeProjectile, stepProjectile } from './weapons/projectile.js';
import { meleeSwing } from './weapons/melee.js';
import { MAX_PROJECTILES, callStrike, fireHitscan, spawnPayload } from './weapons/actions.js';
import { stepFires } from './environment/fire.js';
import { blastObjects, stepObjects, wakeObjectsInRect, type ObjectWorld } from './environment/objects.js';
import { blastBodies, blastCharacters, type Explosion } from './explosions/explosion.js';
import { stepSettle } from './explosions/resolve.js';
import { ammoLeft, controlOf, delayLeft, liveRemote, maskInput, maySelectWeapon, onShotFired, selectNextInTeam, skipTurn, spendAmmo, stepTurn } from './turn/turn.js';
import { deployObject, stepGear, stepTool, useUtility, type TerrainEditFn } from './weapons/utility.js';
import { airCharge, shootHead, stepHead, stepRope } from './weapons/rope.js';
import type { WeaponDef } from './weapons/definition.js';
import { nextInt } from './core/rng.js';
import type { GameState } from './state/gameState.js';
import { addRect, carveCapsule, carveCircle, type EditRect } from './terrain/edit.js';
import { Mat } from './terrain/terrain.js';
import { SUB } from './core/units.js';
import { ilength } from './core/trig.js';
import { Btn, pressed } from './core/input.js';

export { MAX_PROJECTILES };
/** Hard cap on commands applied per tick (protects against hostile or corrupt input). */
export const MAX_COMMANDS_PER_TICK = 32;

function stepProjectiles(state: GameState, events: SimEvent[]): void {
  const t = state.terrain!;
  const keep = [];
  const list = state.projectiles.slice(); // payloads append sub-projectiles; they fly from next tick
  const before = list.length;
  for (const p of list) {
    const def = state.weapons[p.weapon]!;
    const out = stepProjectile(p, def, t, state.characters, state.wind, state.waterY, state.tick, events, state.objects);
    switch (out.kind) {
      case 'flying':
        keep.push(p);
        break;
      case 'explode':
        events.push({ type: 'ProjectileImpact', tick: state.tick, id: p.id, weapon: p.weapon, x: out.x, y: out.y, hit: out.hit, characterId: out.characterId });
        state.pendingExplosions.push({
          x: out.x,
          y: out.y,
          radius: def.explosionRadius,
          damage: def.damage,
          knockback: def.knockback,
          carve: def.carve,
          cause: 'weapon',
          source: p.id,
        });
        spawnPayload(state, def, p.owner, p.id, out.x, out.y, events);
        break;
      case 'gone':
        break;
      case 'splash':
        events.push({ type: 'ProjectileSplashed', tick: state.tick, id: p.id, x: out.x, y: state.waterY });
        break;
      case 'lost':
        events.push({ type: 'ProjectileLost', tick: state.tick, id: p.id });
        break;
    }
  }
  // sub-projectiles spawned this tick were appended after the stepped ones
  for (const p of state.projectiles.slice(before)) keep.push(p);
  state.projectiles = keep;
}

/**
 * Resolve the explosions queued before this point of the tick, in FIFO order (plan §7.2 step 7).
 * Each: carve terrain → damage + impulses from positions at this tick → wake bodies.
 * Explosions queued while resolving (death blasts come from the reveal, later in the tick)
 * wait for the next tick, which gives chain reactions a stable rhythm.
 */
function resolveExplosions(state: GameState, events: SimEvent[]): void {
  const batch: Explosion[] = state.pendingExplosions;
  state.pendingExplosions = [];
  const t = state.terrain!;
  for (const e of batch) {
    if (e.carve && e.radius > 0) terrainEdit(state, carveCircle(t, e.x, e.y, e.radius), 'explosion', events);
    events.push({ type: 'Exploded', tick: state.tick, x: e.x, y: e.y, radius: e.radius, damage: e.damage, cause: e.cause, source: e.source });
    blastCharacters(e, state.characters, state.tick, events);
    blastBodies(e, state.bodies);
    for (const p of state.projectiles) if (p.body) blastBodies(e, [p.body]); // grenades get pushed too
    if (state.objects.length) {
      const w = objectWorld(state);
      blastObjects(e, w, state.tick, events);
      syncObjectWorld(state, w);
    }
  }
}

/** The slice of the state the object system works on (objects may queue blasts and fires). */
function objectWorld(s: GameState): ObjectWorld {
  return { objects: s.objects, props: s.props, characters: s.characters, pendingExplosions: s.pendingExplosions, fires: s.fires, nextFireId: s.nextFireId, rng: s.rng };
}
function syncObjectWorld(s: GameState, w: ObjectWorld): void {
  s.objects = w.objects;
  s.nextFireId = w.nextFireId;
}

/** A crate was touched: heal the Gumling, or give its team ammo for a limited weapon. */
function pickup(s: GameState, o: { id: number }, def: { heal: number; ammo: number; utility: boolean }, c: GameState['characters'][0], events: SimEvent[]): void {
  if (def.heal > 0) {
    c.hp = Math.min(999, c.hp + def.heal);
    events.push({ type: 'CrateCollected', tick: s.tick, id: o.id, by: c.id, kind: 'health', amount: def.heal, weapon: -1 });
    return;
  }
  const team = s.match?.teams[c.team];
  const kind = def.utility ? 'utility' : 'weapon';
  const limited = s.weapons.map((w, i) => (!w.hidden && w.ammo >= 0 && (w.category === 'utility') === def.utility ? i : -1)).filter((i) => i >= 0);
  if (!team || limited.length === 0) {
    events.push({ type: 'CrateCollected', tick: s.tick, id: o.id, by: c.id, kind, amount: 0, weapon: -1 });
    return;
  }
  const w = limited[nextInt(s.rng.crates, limited.length)]!;
  team.ammo[w] = (team.ammo[w] ?? 0) + def.ammo;
  events.push({ type: 'CrateCollected', tick: s.tick, id: o.id, by: c.id, kind, amount: def.ammo, weapon: w });
  events.push({ type: 'AmmoChanged', tick: s.tick, team: team.id, weapon: w, ammo: team.ammo[w]! });
}

/**
 * The selected weapon goes off: utilities and deployables first (they may refuse, costing
 * nothing), then ammo, then the delivery. `fromAir`: used from the rope or jetpack (longer retreat).
 */
function useWeapon(state: GameState, c: GameState['characters'][0], weapon: WeaponDef, power: number, edit: TerrainEditFn, events: SimEvent[], fromAir: boolean): void {
  if (weapon.category === 'utility') {
    if (!useUtility(state, c, c.weapon, weapon, edit, events)) return;
    spendAmmo(state, c, events);
    onShotFired(state, weapon, events);
    if (weapon.utility === 'skip') skipTurn(state, events);
    return;
  }
  if (weapon.category === 'deploy') {
    if (!deployObject(state, c, weapon, events)) return;
    spendAmmo(state, c, events);
    onShotFired(state, weapon, events, fromAir);
    return;
  }
  spendAmmo(state, c, events);
  if (weapon.category === 'melee') {
    meleeSwing(c, c.weapon, weapon, state.characters, state.tick, events);
  } else if (weapon.category === 'hitscan') {
    fireHitscan(state, c, c.weapon, weapon, events);
  } else if (weapon.category === 'strike') {
    callStrike(state, c, c.weapon, weapon, events);
  } else if (state.projectiles.length < MAX_PROJECTILES) {
    const id = state.nextProjectileId++;
    const p = makeProjectile(id, c.weapon, weapon, c, power);
    state.projectiles.push(p);
    events.push({ type: 'ProjectileFired', tick: state.tick, id, weapon: c.weapon, owner: c.id, power, speed: ilength(p.vx, p.vy), x: p.x >> 8, y: p.y >> 8 });
  } else return;
  onShotFired(state, weapon, events, fromAir);
}

function terrainEdit(state: GameState, r: EditRect | null, cause: 'carve' | 'tunnel' | 'girder' | 'explosion' | 'fire', events: SimEvent[]): void {
  if (!r) return;
  wakeBodiesInRect(state.bodies, r.x0, r.y0, r.x1, r.y1);
  for (const p of state.projectiles) if (p.body) wakeBodiesInRect([p.body], r.x0, r.y0, r.x1, r.y1);
  if (state.objects.length) wakeObjectsInRect(state.objects, r.x0, r.y0, r.x1, r.y1);
  // characters check their support every tick, so they need no explicit wake
  events.push({ type: 'TerrainChanged', tick: state.tick, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, changed: r.changed, cause });
}

/**
 * Advance the simulation by exactly one tick (20 ms). Pure apart from mutating `state`.
 * The system order below is the canonical tick order from plan §7.2; systems are
 * added in their slots as milestones land.
 */
export function step(state: GameState, rawInput: InputFrame, commands: readonly unknown[] = []): SimEvent[] {
  const input = sanitizeInput(rawInput);
  const events: SimEvent[] = [];
  state.tick++;

  // 1. apply inputs (buttons + commands)
  const n = Math.min(commands.length, MAX_COMMANDS_PER_TICK);
  for (let i = 0; i < n; i++) {
    const cmd = sanitizeCommand(commands[i]);
    if (cmd) applyCommand(state, cmd, events);
  }

  // 2. turn pre-update: who is in control this tick, and with which buttons
  const control = controlOf(state);
  let charInput = maskInput(state, input);
  let charPrev = maskInput(state, state.lastInput);
  // a remote-triggered weapon is out: Fire detonates it, and its owner stands still meanwhile
  const remote = control.id !== 0 ? liveRemote(state, control.id) : undefined;
  if (remote) {
    if (pressed(state.lastInput, input, Btn.Fire)) remote.detonate = true;
    charInput = 0;
    charPrev = 0;
  }
  // 3. character controller (+ airborne characters' physics). Only the controlled character
  //    receives input; the others idle, fall, land and drown on their own.
  if (state.terrain) {
    const edit: TerrainEditFn = (r, cause) => terrainEdit(state, r, cause, events);
    for (const c of state.characters) {
      const controlled = control.id !== 0 && c.id === control.id;
      // out of ammo or still delayed: the weapon cannot fire (aiming still works)
      const usable = !controlled || (ammoLeft(state, c.id, c.weapon) !== 0 && delayLeft(state, c.id, c.weapon) === 0);
      const weapon = usable ? (state.weapons[c.weapon] ?? null) : null;
      if (c.state === 'tool') {
        stepTool(state, c, controlled, charInput, charPrev, edit, events);
        continue;
      }
      // 4. grapple: a flying head bites; a Gumling on the rope swings (and may shoot from it)
      if (c.headOn && stepHead(state, c, events) === 'first') {
        spendAmmo(state, c, events);
        events.push({ type: 'UtilityUsed', tick: state.tick, id: c.id, weapon: c.ropeWeapon, kind: 'rope', x: c.body.x >> 8, y: c.body.y >> 8 });
      }
      if (c.state === 'rope') {
        const power = stepRope(state, c, controlled, charInput, charPrev, weapon, events);
        if (power >= 0 && weapon) useWeapon(state, c, weapon, power, edit, events, true);
        continue;
      }
      // re-shots during a rope use need no ammo (the use already paid)
      const held = state.weapons[c.weapon];
      const rope = held?.utility === 'rope' && (weapon || c.ropeOn) ? held : null;
      if (controlled && rope && pressed(charPrev, charInput, Btn.Fire) && (c.state === 'idle' || c.state === 'walk' || c.state === 'air' || c.state === 'landing')) {
        shootHead(state, c, c.weapon, rope, events);
      }
      // worn gear (parachute, jetpack) reacts to Fire itself, in the air too
      const gear = weapon && (weapon.utility === 'parachute' || weapon.utility === 'jetpack') ? weapon : null;
      if (c.state !== 'dead' && (c.chute || c.jet || (controlled && gear))) {
        if (stepGear(state, c, controlled, charInput, charPrev, controlled ? gear : null, c.weapon, events)) {
          spendAmmo(state, c, events);
          onShotFired(state, gear!, events);
        }
      }
      // a weapon from the jetpack (the jetpack itself is not in hand)
      if (controlled && c.jet && c.state === 'air' && weapon && !gear && !rope && weapon.usableFromRope) {
        const p = airCharge(c, weapon, charInput, charPrev);
        if (p >= 0) useWeapon(state, c, weapon, p, edit, events, true);
      }
      const power = stepCharacter(c, state.terrain, state.waterY, state.tick, controlled, charInput, charPrev, events, gear || rope ? null : weapon);
      if (power < 0 || !weapon) continue;
      useWeapon(state, c, weapon, power, edit, events, false);
    }
  }
  // 5. projectiles + 6. triggers (impact)
  if (state.terrain && state.projectiles.length > 0) stepProjectiles(state, events);
  // 7. explosions
  if (state.terrain && state.pendingExplosions.length > 0) resolveExplosions(state, events);
  // 7b. fire: flames fall, stick, burn the ground and hurt
  if (state.terrain && state.fires.length > 0) {
    const t = state.terrain;
    state.fires = stepFires(state.fires, t, state.characters, state.waterY, state.tick, events, (x, y, r) => terrainEdit(state, carveCircle(t, x, y, r), 'fire', events));
  }

  // 8. physics + 9. water
  if (state.terrain && state.bodies.length > 0) {
    state.bodies = stepBodies(state.bodies, state.terrain, state.waterY, state.tick, events);
  }
  // 9b. map objects: mines, barrels, crates
  if (state.terrain && state.objects.length > 0) {
    const w = objectWorld(state);
    stepObjects(w, state.terrain, state.waterY, state.tick, events, (o, def, c) => pickup(state, o, def, c, events));
    syncObjectWorld(state, w);
  }

  // 10. settle detection (+ auto damage reveal in free play) · 11. turn post-update
  stepSettle(state, events);
  stepTurn(state, input, state.lastInput, events);

  state.lastInput = input;
  return events;
}

function applyCommand(state: GameState, cmd: SimCommand, events: SimEvent[]): void {
  const t = state.terrain;
  if (!t) return;
  if (cmd.type === 'debugSpawnCharacter') {
    if (state.characters.length >= MAX_CHARACTERS) return;
    const id = state.nextCharacterId++;
    state.characters.push(makeCharacter(id, cmd.team, cmd.x, cmd.y));
    events.push({ type: 'CharacterSpawned', tick: state.tick, id, team: cmd.team });
    return;
  }
  if (cmd.type === 'setTarget') {
    const ctl = controlOf(state);
    const c = state.characters.find((x) => x.id === ctl.id);
    const w = c ? state.weapons[c.weapon] : undefined;
    if (!c || !w || !w.needsTarget || !ctl.mayFire || c.state === 'charging') return;
    if (state.match && state.match.shotsFired > 0) return;
    c.hasTarget = true;
    c.targetX = cmd.x;
    c.targetY = cmd.y;
    events.push({ type: 'TargetSet', tick: state.tick, id: c.id, x: cmd.x, y: cmd.y });
    return;
  }
  if (cmd.type === 'nextCharacter') {
    selectNextInTeam(state, events);
    return;
  }
  if (cmd.type === 'debugSelect') {
    if (state.match) return; // the turn system owns selection in a match
    const ok = cmd.id === 0 || state.characters.some((c) => c.id === cmd.id && c.state !== 'dead');
    if (ok && state.activeCharacter !== cmd.id) {
      state.activeCharacter = cmd.id;
      events.push({ type: 'ActiveCharacterChanged', tick: state.tick, id: cmd.id });
    }
    return;
  }
  if (cmd.type === 'selectWeapon') {
    const c = state.characters.find((x) => x.id === state.activeCharacter);
    if (c && maySelectWeapon(state) && cmd.index < state.weapons.length && !state.weapons[cmd.index]!.hidden && ammoLeft(state, c.id, cmd.index) !== 0 && delayLeft(state, c.id, cmd.index) === 0 && c.state !== 'charging' && c.state !== 'tool' && c.weapon !== cmd.index) {
      c.weapon = cmd.index;
      c.hasTarget = false;
      events.push({ type: 'WeaponSelected', tick: state.tick, id: c.id, weapon: cmd.index });
    }
    return;
  }
  if (cmd.type === 'debugSetWind' || cmd.type === 'debugRollWind') {
    const w = cmd.type === 'debugSetWind' ? cmd.wind : rollWind(state.rng.wind, state.wind);
    if (w !== state.wind) {
      state.wind = w;
      events.push({ type: 'WindChanged', tick: state.tick, wind: w });
    }
    return;
  }
  if (cmd.type === 'debugExplode') {
    if (state.pendingExplosions.length >= MAX_PROJECTILES) return;
    state.pendingExplosions.push({
      x: cmd.x, y: cmd.y, radius: cmd.r, damage: cmd.damage, knockback: cmd.knockback, carve: true, cause: 'weapon', source: 0,
    });
    return;
  }
  if (cmd.type === 'debugSpawn') {
    if (state.bodies.length >= MAX_BODIES) return;
    const id = state.nextBodyId++;
    state.bodies.push(makeBody(id, cmd.x * SUB + SUB / 2, cmd.y * SUB + SUB / 2, cmd.vx, cmd.vy, { radius: cmd.r }));
    events.push({ type: 'BodySpawned', tick: state.tick, id });
    return;
  }
  let r: EditRect | null = null;
  let cause: 'carve' | 'tunnel' | 'girder';
  switch (cmd.type) {
    case 'debugCarve':
      r = carveCircle(t, cmd.x, cmd.y, cmd.r);
      cause = 'carve';
      break;
    case 'debugTunnel':
      r = carveCapsule(t, cmd.x0, cmd.y0, cmd.x1, cmd.y1, cmd.r);
      cause = 'tunnel';
      break;
    case 'debugGirder':
      r = addRect(t, cmd.x, cmd.y, cmd.w, cmd.h, Mat.GIRDER);
      cause = 'girder';
      break;
  }
  terrainEdit(state, r, cause, events);
}
