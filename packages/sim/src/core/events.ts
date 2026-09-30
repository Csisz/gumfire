/**
 * Simulation events: plain data emitted by `step()` for render, audio and UI.
 * Events are NOT part of the hashed state.
 */
export type SimEvent =
  /** Terrain pixels changed inside this inclusive rect (renderer repaints it plus a margin). */
  | { type: 'TerrainChanged'; tick: number; x0: number; y0: number; x1: number; y1: number; changed: number; cause: 'carve' | 'tunnel' | 'girder' | 'explosion' }
  | { type: 'BodySpawned'; tick: number; id: number }
  /** A body hit terrain with this normal speed (subpixels/tick) at pixel (x, y). */
  | { type: 'BodyImpact'; tick: number; id: number; speed: number; x: number; y: number }
  | { type: 'BodyEnteredWater'; tick: number; id: number; x: number; y: number }
  | { type: 'BodyRemoved'; tick: number; id: number; reason: 'drowned' | 'lost' }
  | { type: 'CharacterSpawned'; tick: number; id: number; team: number }
  | { type: 'CharacterJumped'; tick: number; id: number; kind: 'forward' | 'backflip' }
  /** Landed from the air; `impact` = normal speed in subpixels/tick. */
  | { type: 'CharacterLanded'; tick: number; id: number; impact: number; damage: number }
  | { type: 'CharacterDamaged'; tick: number; id: number; amount: number; reason: 'fall' }
  | { type: 'CharacterEnteredWater'; tick: number; id: number }
  | { type: 'CharacterDied'; tick: number; id: number; reason: 'drowned' | 'lost' }
  | { type: 'ActiveCharacterChanged'; tick: number; id: number }
  /** `speed` = launch speed in subpixels/tick; `power` = charge ticks. */
  | { type: 'ProjectileFired'; tick: number; id: number; weapon: number; owner: number; power: number; speed: number; x: number; y: number }
  | { type: 'Exploded'; tick: number; projectile: number; weapon: number; x: number; y: number; radius: number; hit: 'terrain' | 'character' | 'timeout'; characterId: number }
  | { type: 'ProjectileSplashed'; tick: number; id: number; x: number; y: number }
  | { type: 'ProjectileLost'; tick: number; id: number }
  | { type: 'WindChanged'; tick: number; wind: number }
  | { type: 'WeaponSelected'; tick: number; id: number; weapon: number };
