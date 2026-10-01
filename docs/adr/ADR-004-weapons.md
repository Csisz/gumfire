# ADR-004 — Data-driven weapons compiled into the match state

Status: accepted (M5, ballistic subset) · Plan: §12

## Decision
- Weapons are authored as JSON in `packages/content/weapons/*.json`, in human units (px,
  px/tick, ticks, ratios). The authored type is `WeaponJson` in `packages/sim`.
- The sim never imports content. Content is passed in `GameConfig.weapons`; `createGame`
  validates and compiles it (`compileWeapons`) into integer `WeaponDef`s (subpixels, ×256
  ratios) stored in `GameState.weapons`, with a one-time `weaponsHash` included in the state
  hash. A replay is therefore self-contained and a content mismatch shows up as a desync.
- A weapon is addressed by its index in that array (inputs, commands, events).
- Validation is hand-written (clear `WeaponDefinitionError` messages naming the field) rather
  than zod: no extra dependency in the sim, and the checks double as the unit conversion.
- Unsupported blocks are rejected explicitly ("only 'ballistic' is supported so far"), so new
  categories are added deliberately, milestone by milestone.

## Consequences
- New weapons of a supported category need only JSON (+ an icon later).
- Changing a weapon's numbers changes `weaponsHash` → golden hashes change → logged in
  `docs/tuning.md`.
- Behaviour blocks beyond the ballistic subset (bounce, fuse, cluster spawn, hitscan, melee,
  strikes, …) extend `WeaponJson`/`WeaponDef` and the projectile/trigger systems at M8–M12.

## Update (M8)
The schema gained `category: 'melee'` with a `melee` block, `input.mode: 'instant'`, a `fuse`
trigger (optionally player-set 1–5 s) and a `bounce` block. Fused projectiles are simulated as
physics bodies (same collision code as everything else). Still rejected explicitly: strikes,
hitscan, cluster spawn, walkers, homing, fire — they arrive at M9.

## Update (M9)
Weapons are composed of **delivery** (projectile: ballistic / walker / boomerang; melee; hitscan;
strike), **payload** (explosion, cluster, fire) and **modifiers** (fuse, remote, bounce, homing).
Sub-projectiles compile to hidden defs appended after the selectable set, so the projectile
system only ever runs "a projectile of def N". Targeted input (`target`, `targetCharge`) uses the
`setTarget` command. New combinations are content; new block kinds are code + a fixture test.
