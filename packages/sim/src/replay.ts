import { hashState, createGame, type GameConfig, type GameState } from './state/gameState.js';
import type { InputFrame } from './core/input.js';
import { step } from './step.js';

/** A replay is the config plus one input frame per tick (plan §15, §21). */
export interface Replay {
  config: GameConfig;
  inputs: InputFrame[];
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
  for (const frame of replay.inputs) {
    step(state, frame);
    if (state.tick % hashEvery === 0) checkpoints.push({ tick: state.tick, hash: hashState(state) });
  }
  return { state, checkpoints, finalHash: hashState(state) };
}
