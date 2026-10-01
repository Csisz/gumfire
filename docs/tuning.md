# Tuning and golden-hash log

Every intentional change to simulation behaviour that alters a golden hash gets a line here.

| Date | Milestone | Change | Golden affected |
| --- | --- | --- | --- |
| 2026-09-30 | M0 | Initial demo sim (bouncers) and RNG seeding | `determinism.test.ts` golden `4df6b565`, seeded RNG snapshot |
| 2026-09-30 | M1 | GameState schema 2: terrain (chunk hashes) and waterY added to the state hash; demo behaviour unchanged | golden `4df6b565` → `950a526e` |
| 2026-09-30 | M2 | Chunk hash changed from FNV-1a over bytes to an incremental position-weighted sum (`pixelWeight`); terrain edits via commands | map-state hashes change; demo golden unchanged |
| 2026-09-30 | M3 | GameState schema 3 (bodies); demo bouncers removed; golden scenario rebuilt on the physics arena (spawns, carves, girders, tunnels, 3000 ticks) | new golden `f7d109b4` |
| 2026-09-30 | M4 | GameState schema 4 (characters); golden scenario adds a controlled character. Tuned: fall damage threshold 5.5→7.5 px/tick and ×8→×10 (backflip must not hurt), jump crouch 6→10 ticks (double-tap window) | new golden `bf8b18a8` |
| 2026-09-30 | M5 | GameState schema 5 (weapons, projectiles, wind); golden scenario fires Pepper Rockets and rerolls wind | new golden `aa720d93` |
| 2026-09-30 | M6 | GameState schema 6 (pendingDamage, pendingExplosions, quietTicks, autoReveal); explosions deal falloff damage and knockback, fall damage is pending too; golden scenario adds a second character and periodic `debugExplode` blasts | new golden `f28fe039` |
| 2026-09-30 | M7 | GameState schema 7 (`match`); physics-arena golden only changes by the schema/hash layout; new match golden (seed 7, 2 × 3 on the arena, 8 s turns, 40 s round) | golden `f28fe039` → `bad3eef8`; match golden `5c6e3483` |
| 2026-09-30 | M8 | GameState schema 8 (character fuse/bounce, projectile fuse/body); Fizz Grenade + Rolling Pin in the match golden; new full-match golden | arena `3ca9e7f6`, match `f4a15ca8`, full match `win:1:2948:db01340d` |
| 2026-09-30 | M8 playtest | Rolling Pin impulse 10 → 15, melee up bias 48 → 64; backflip vx −1.1 → −2.3 | match `f4a15ca8` → `5c74c658`, full match → `win:1:2948:423faa0`; arena unchanged |
| 2026-10-01 | M9 | GameState schema 9 (fires, projectile state, targets, remoteWait); projectile trigger order unified (fuse/remote/max-life before movement); fire fan 100°, Frosting fire speed 3 | arena `59132d52`, match `8e4d3d6e`, full match `win:1:2948:f81ec4f0` |
| 2026-10-01 | M9 playtest | Weapons hit a capsule matching the drawn Gumling (up 7 px, radius 10), blasts measured to it; backflip vx −2.3 → −1.5; Rolling Pin impulse 15 → 12.5; Battery Shock Bomb → Magnet Bomb; Frozen theme back wall alpha 38, lighter scorch | arena `a8f77a46`, match `bdefafc8`, full match `win:1:2948:9ef49411` |
