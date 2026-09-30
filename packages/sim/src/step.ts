import { sanitizeCommand, type SimCommand } from './core/commands.js';
import type { SimEvent } from './core/events.js';
import { sanitizeInput, type InputFrame } from './core/input.js';
import { MAX_BODIES, makeBody, stepBodies, wakeBodiesInRect } from './physics/body.js';
import { MAX_CHARACTERS, makeCharacter, stepCharacter } from './character/character.js';
import type { GameState } from './state/gameState.js';
import { addRect, carveCapsule, carveCircle, type EditRect } from './terrain/edit.js';
import { Mat } from './terrain/terrain.js';
import { SUB } from './core/units.js';

/** Hard cap on commands applied per tick (protects against hostile or corrupt input). */
export const MAX_COMMANDS_PER_TICK = 32;

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
      stepCharacter(c, state.terrain, state.waterY, state.tick, c.id === state.activeCharacter, input, state.lastInput, events);
    }
  }
  // 4. rope · 5. projectiles · 6. triggers · 7. explosions (M6+)

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
  if (r) {
    wakeBodiesInRect(state.bodies, r.x0, r.y0, r.x1, r.y1);
    // characters check their support every tick, so they need no explicit wake
    events.push({ type: 'TerrainChanged', tick: state.tick, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, changed: r.changed, cause });
  }
}
