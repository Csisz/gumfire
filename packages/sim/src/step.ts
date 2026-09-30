import type { SimEvent } from './core/events.js';
import { sanitizeInput, type InputFrame } from './core/input.js';
import { stepDemo } from './demo/bouncers.js';
import type { GameState } from './state/gameState.js';

/**
 * Advance the simulation by exactly one tick (20 ms). Pure apart from mutating `state`.
 * The system order below is the canonical tick order from plan §7.2; systems are
 * added in their slots as milestones land.
 */
export function step(state: GameState, rawInput: InputFrame): SimEvent[] {
  const input = sanitizeInput(rawInput);
  const events: SimEvent[] = [];
  state.tick++;

  // 1. apply inputs · 2. turn pre-update · 3. character controller · 4. rope
  // 5. projectiles · 6. triggers · 7. explosions · 8. physics · 9. water
  // 10. settle detection · 11. turn post-update
  stepDemo(state.demo, state.rng.misc, state.lastInput, input, state.tick, events);

  state.lastInput = input;
  return events;
}
