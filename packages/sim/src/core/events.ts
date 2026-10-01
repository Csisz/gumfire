/**
 * Simulation events: plain data emitted by `step()` for render, audio and UI.
 * Events are NOT part of the hashed state.
 */
export type SimEvent =
  /** Terrain pixels changed inside this inclusive rect (renderer repaints it plus a margin). */
  | { type: 'TerrainChanged'; tick: number; x0: number; y0: number; x1: number; y1: number; changed: number; cause: 'carve' | 'tunnel' | 'girder' | 'explosion' | 'fire' }
  | { type: 'BodySpawned'; tick: number; id: number }
  /** A body hit terrain with this normal speed (subpixels/tick) at pixel (x, y). */
  | { type: 'BodyImpact'; tick: number; id: number; speed: number; x: number; y: number }
  | { type: 'BodyEnteredWater'; tick: number; id: number; x: number; y: number }
  | { type: 'BodyRemoved'; tick: number; id: number; reason: 'drowned' | 'lost' }
  | { type: 'CharacterSpawned'; tick: number; id: number; team: number }
  | { type: 'CharacterJumped'; tick: number; id: number; kind: 'forward' | 'backflip' }
  /** Landed from the air; `impact` = normal speed in subpixels/tick. */
  | { type: 'CharacterLanded'; tick: number; id: number; impact: number; damage: number }
  /** Damage taken now, not yet applied to hp (`pending` = running total). */
  | { type: 'CharacterHit'; tick: number; id: number; damage: number; pending: number }
  /** Pending damage revealed and applied to hp. */
  | { type: 'CharacterDamaged'; tick: number; id: number; amount: number; hp: number }
  | { type: 'CharacterEnteredWater'; tick: number; id: number }
  | { type: 'CharacterDied'; tick: number; id: number; reason: 'drowned' | 'lost' | 'hp' }
  | { type: 'ActiveCharacterChanged'; tick: number; id: number }
  /** `speed` = launch speed in subpixels/tick; `power` = charge ticks. */
  | { type: 'ProjectileFired'; tick: number; id: number; weapon: number; owner: number; power: number; speed: number; x: number; y: number }
  /** A projectile's trigger fired here (the explosion itself follows as `Exploded`). */
  | { type: 'ProjectileImpact'; tick: number; id: number; weapon: number; x: number; y: number; hit: 'terrain' | 'character' | 'object' | 'timeout' | 'fuse' | 'remote'; characterId: number }
  | { type: 'Exploded'; tick: number; x: number; y: number; radius: number; damage: number; cause: 'weapon' | 'death' | 'object'; source: number }
  /** Pending damage was revealed (world settled). */
  | { type: 'DamageRevealed'; tick: number; total: number }
  | { type: 'ProjectileSplashed'; tick: number; id: number; x: number; y: number }
  | { type: 'ProjectileLost'; tick: number; id: number }
  | { type: 'WindChanged'; tick: number; wind: number }
  | { type: 'WeaponSelected'; tick: number; id: number; weapon: number }
  /** A bouncing projectile hit terrain (`speed` = normal speed, subpixels/tick). */
  | { type: 'ProjectileBounced'; tick: number; id: number; speed: number; x: number; y: number }
  | { type: 'FuseChanged'; tick: number; id: number; fuse: number; bounceHigh: boolean }
  // ---- weapon framework (M9)
  /** A sub-projectile (cluster bomblet, strike drop) entered the world. */
  | { type: 'ProjectileSpawned'; tick: number; id: number; weapon: number; parent: number }
  /** A boomerang hit terrain and dropped / was caught by its thrower / struck a character. */
  | { type: 'ProjectileDropped'; tick: number; id: number; x: number; y: number }
  | { type: 'ProjectileCaught'; tick: number; id: number; by: number }
  | { type: 'ProjectileStruck'; tick: number; id: number; characterId: number }
  /** A hitscan ray from (x0, y0) to (x1, y1); `hit` = what stopped it. */
  | { type: 'HitscanFired'; tick: number; id: number; weapon: number; x0: number; y0: number; x1: number; y1: number; hit: 'terrain' | 'character' | 'object' | 'none' }
  | { type: 'StrikeCalled'; tick: number; id: number; weapon: number; x: number; y: number; count: number }
  | { type: 'TargetSet'; tick: number; id: number; x: number; y: number }
  | { type: 'FiresSpawned'; tick: number; x: number; y: number; count: number }
  // ---- environment (M10)
  | { type: 'ObjectsPlaced'; tick: number; count: number }
  | { type: 'ObjectDetonated'; tick: number; id: number; prop: string; x: number; y: number }
  | { type: 'ObjectRemoved'; tick: number; id: number; reason: 'drowned' | 'lost' }
  | { type: 'MineArmed'; tick: number; id: number; fuse: number }
  | { type: 'MineDud'; tick: number; id: number; x: number; y: number }
  | { type: 'CrateDropped'; tick: number; id: number; kind: 'health' | 'weapon'; x: number }
  | { type: 'CrateLanded'; tick: number; id: number; x: number; y: number }
  /** `amount` = hp healed or ammo added; `weapon` = weapon index for weapon crates (−1 otherwise). */
  | { type: 'CrateCollected'; tick: number; id: number; by: number; kind: 'health' | 'weapon'; amount: number; weapon: number }
  | { type: 'AmmoChanged'; tick: number; team: number; weapon: number; ammo: number }
  /** Telegraph: sudden death starts when the round clock runs out in `seconds`. */
  | { type: 'SuddenDeathSoon'; tick: number; seconds: number }
  /** A melee swing along `dir` (angle units); `hits` = character ids struck. */
  | { type: 'MeleeSwing'; tick: number; id: number; weapon: number; x: number; y: number; dir: number; hits: number[] }
  // ---- turn system (M7)
  | { type: 'TurnPhaseChanged'; tick: number; phase: 'turnPrep' | 'turnActive' | 'retreat' | 'settling' | 'damageReveal' | 'matchOver'; turn: number }
  /** A new turn: `team` plays with character `id`. */
  | { type: 'TurnStarted'; tick: number; turn: number; team: number; id: number }
  | { type: 'RetreatStarted'; tick: number; id: number; ticks: number }
  | { type: 'ControlEnded'; tick: number; id: number; reason: 'timeout' | 'damage' | 'water' | 'retreatOver' | 'endTurn' }
  | { type: 'SuddenDeath'; tick: number; mode: 'hpToOne' | 'water' | 'both' | 'roundEnds' }
  | { type: 'WaterRose'; tick: number; y: number }
  /** `winner` = team id, −1 for a draw. */
  | { type: 'MatchEnded'; tick: number; result: 'win' | 'draw'; winner: number };
