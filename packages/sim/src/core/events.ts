/**
 * Simulation events: plain data emitted by `step()` for render, audio and UI.
 * Events are NOT part of the hashed state.
 */
export type SimEvent =
  | { type: 'DemoSpawned'; tick: number; id: number }
  | { type: 'DemoBounced'; tick: number; id: number; speed: number };
