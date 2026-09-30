import { hashState, createGame, type GameConfig, type GameState } from './state/gameState.js';
import type { SimCommand, TimedCommand } from './core/commands.js';
import type { InputFrame } from './core/input.js';
import { step } from './step.js';

/**
 * A replay is the config, one input frame per tick, and the tick-stamped commands
 * (plan §15, §21). `commands` must be sorted by tick.
 */
export interface Replay {
  config: GameConfig;
  inputs: InputFrame[];
  commands?: TimedCommand[];
}

export interface ReplayResult {
  state: GameState;
  /** Hash every `hashEvery` ticks, keyed by tick. */
  checkpoints: Array<{ tick: number; hash: number }>;
  finalHash: number;
}

export function runReplay(replay: Replay, hashEvery = 50): ReplayResult {
  const state = createGame(replay.config);
  const checkpoints: ReplayResult['checkpoints'] = [];
  const cmds = replay.commands ?? [];
  let c = 0;
  for (const frame of replay.inputs) {
    const tick = state.tick + 1;
    const batch: SimCommand[] = [];
    while (c < cmds.length && cmds[c]!.tick < tick) c++; // skip stale (shouldn't happen when sorted)
    while (c < cmds.length && cmds[c]!.tick === tick) batch.push(cmds[c++]!.cmd);
    step(state, frame, batch);
    if (state.tick % hashEvery === 0) checkpoints.push({ tick: state.tick, hash: hashState(state) });
  }
  return { state, checkpoints, finalHash: hashState(state) };
}
