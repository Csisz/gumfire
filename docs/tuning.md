# Tuning and golden-hash log

Every intentional change to simulation behaviour that alters a golden hash gets a line here.

| Date | Milestone | Change | Golden affected |
| --- | --- | --- | --- |
| 2026-09-30 | M0 | Initial demo sim (bouncers) and RNG seeding | `determinism.test.ts` golden `4df6b565`, seeded RNG snapshot |
| 2026-09-30 | M1 | GameState schema 2: terrain (chunk hashes) and waterY added to the state hash; demo behaviour unchanged | golden `4df6b565` → `950a526e` |
| 2026-09-30 | M2 | Chunk hash changed from FNV-1a over bytes to an incremental position-weighted sum (`pixelWeight`); terrain edits via commands | map-state hashes change; demo golden unchanged |
