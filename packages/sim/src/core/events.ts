/**
 * Simulation events: plain data emitted by `step()` for render, audio and UI.
 * Events are NOT part of the hashed state.
 */
export type SimEvent =
  /** Terrain pixels changed inside this inclusive rect (renderer repaints it plus a margin). */
  | { type: 'TerrainChanged'; tick: number; x0: number; y0: number; x1: number; y1: number; changed: number; cause: 'carve' | 'tunnel' | 'girder' }
  | { type: 'BodySpawned'; tick: number; id: number }
  /** A body hit terrain with this normal speed (subpixels/tick) at pixel (x, y). */
  | { type: 'BodyImpact'; tick: number; id: number; speed: number; x: number; y: number }
  | { type: 'BodyEnteredWater'; tick: number; id: number; x: number; y: number }
  | { type: 'BodyRemoved'; tick: number; id: number; reason: 'drowned' | 'lost' };
