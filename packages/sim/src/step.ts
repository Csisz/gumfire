import { sanitizeCommand, type SimCommand } from './core/commands.js';
import type { SimEvent } from './core/events.js';
import { sanitizeInput, type InputFrame } from './core/input.js';
import { stepDemo } from './demo/bouncers.js';
import type { GameState } from './state/gameState.js';
import { addRect, carveCapsule, carveCircle, type EditRect } from './terrain/edit.js';
import { Mat } from './terrain/terrain.js';

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

  // 2. turn pre-update · 3. character controller · 4. rope · 5. projectiles · 6. triggers
  // 7. explosions · 8. physics · 9. water · 10. settle detection · 11. turn post-update
  stepDemo(state.demo, state.rng.misc, state.lastInput, input, state.tick, events);

  state.lastInput = input;
  return events;
}

function applyCommand(state: GameState, cmd: SimCommand, events: SimEvent[]): void {
  const t = state.terrain;
  if (!t) return;
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
  if (r) events.push({ type: 'TerrainChanged', tick: state.tick, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, changed: r.changed, cause });
}
