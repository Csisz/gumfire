import { sanitizeCommand, type SimCommand } from './core/commands.js';
import type { SimEvent } from './core/events.js';
import { sanitizeInput, type InputFrame } from './core/input.js';
import { MAX_BODIES, makeBody, stepBodies, wakeBodiesInRect } from './physics/body.js';
import { MAX_CHARACTERS, makeCharacter, stepCharacter } from './character/character.js';
import { rollWind } from './environment/wind.js';
import { makeProjectile, stepProjectile } from './weapons/projectile.js';
import type { GameState } from './state/gameState.js';
import { addRect, carveCapsule, carveCircle, type EditRect } from './terrain/edit.js';
import { Mat } from './terrain/terrain.js';
import { SUB } from './core/units.js';
import { ilength } from './core/trig.js';

/** Hard cap on commands applied per tick (protects against hostile or corrupt input). */
export const MAX_COMMANDS_PER_TICK = 32;
export const MAX_PROJECTILES = 64;

function stepProjectiles(state: GameState, events: SimEvent[]): void {
  const t = state.terrain!;
  const keep = [];
  for (const p of state.projectiles) {
    const def = state.weapons[p.weapon]!;
    const out = stepProjectile(p, def, t, state.characters, state.wind, state.waterY);
    switch (out.kind) {
      case 'flying':
        keep.push(p);
        break;
      case 'explode':
        events.push({ type: 'Exploded', tick: state.tick, projectile: p.id, weapon: p.weapon, x: out.x, y: out.y, radius: def.explosionRadius, hit: out.hit, characterId: out.characterId });
        // M5: the blast carves terrain; damage and knockback arrive at M6.
        if (def.carve && def.explosionRadius > 0) terrainEdit(state, carveCircle(t, out.x, out.y, def.explosionRadius), 'explosion', events);
        break;
      case 'splash':
        events.push({ type: 'ProjectileSplashed', tick: state.tick, id: p.id, x: out.x, y: state.waterY });
        break;
      case 'lost':
        events.push({ type: 'ProjectileLost', tick: state.tick, id: p.id });
        break;
    }
  }
  state.projectiles = keep;
}

function terrainEdit(state: GameState, r: EditRect | null, cause: 'carve' | 'tunnel' | 'girder' | 'explosion', events: SimEvent[]): void {
  if (!r) return;
  wakeBodiesInRect(state.bodies, r.x0, r.y0, r.x1, r.y1);
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

  // 2. turn pre-update (M7)
  // 3. character controller (+ airborne characters' physics). Only the active character
  //    receives input; the others idle, fall, land and drown on their own.
  if (state.terrain) {
    for (const c of state.characters) {
      const weapon = state.weapons[c.weapon] ?? null;
      const power = stepCharacter(c, state.terrain, state.waterY, state.tick, c.id === state.activeCharacter, input, state.lastInput, events, weapon);
      if (power >= 0 && weapon && state.projectiles.length < MAX_PROJECTILES) {
        const id = state.nextProjectileId++;
        const p = makeProjectile(id, c.weapon, weapon, c, power);
        state.projectiles.push(p);
        events.push({ type: 'ProjectileFired', tick: state.tick, id, weapon: c.weapon, owner: c.id, power, speed: ilength(p.vx, p.vy), x: p.x >> 8, y: p.y >> 8 });
      }
    }
  }
  // 4. rope (M13)
  // 5. projectiles + 6. triggers (impact) + 7. explosions
  if (state.terrain && state.projectiles.length > 0) stepProjectiles(state, events);

  // 8. physics + 9. water
  if (state.terrain && state.bodies.length > 0) {
    state.bodies = stepBodies(state.bodies, state.terrain, state.waterY, state.tick, events);
  }

  // 10. settle detection · 11. turn post-update (M7)

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
  if (cmd.type === 'debugSelect') {
    const ok = cmd.id === 0 || state.characters.some((c) => c.id === cmd.id && c.state !== 'dead');
    if (ok && state.activeCharacter !== cmd.id) {
      state.activeCharacter = cmd.id;
      events.push({ type: 'ActiveCharacterChanged', tick: state.tick, id: cmd.id });
    }
    return;
  }
  if (cmd.type === 'selectWeapon') {
    const c = state.characters.find((x) => x.id === state.activeCharacter);
    if (c && cmd.index < state.weapons.length && c.state !== 'charging' && c.weapon !== cmd.index) {
      c.weapon = cmd.index;
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
