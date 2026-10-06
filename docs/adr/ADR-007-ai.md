# ADR-007 — CPU players: scripted input from a look-ahead search

Status: accepted (M15b)

## Decision
- The CPU lives in its own package, `packages/ai`, on top of the sim. It never writes to the
  game state: it produces **input frames and commands**, exactly what a keyboard and mouse
  produce, so CPU turns are recorded, replayed and (later) sent over the network like a
  person's.
- A turn is planned once, from a snapshot taken when the CPU gets control, and played back as a
  **script** (one frame per tick): pick weapon → target / fuse → turn → aim taps → hold Fire for
  the chosen charge → release → end the retreat.
- Search in two stages:
  1. **Predict** with the sim's own projectile code over the current terrain (read only):
     thousands of facing × aim × charge (× fuse) choices on a coarse grid, the best cells
     refined to single aim taps. A flight with the longest fuse gives every shorter fuse's
     blast point for free.
  2. **Play out** the best 4–20 candidates as real scripts on a fork of the world with the
     real `step` until the damage reveal; score = enemy damage + knock-outs − 1.5× own
     damage (2× for itself) − limited-ammo and walking costs.
- Difficulty changes the search, not the rules: grid density, number of weapons, play-outs,
  walking before the shot, refining the winner — and, for easy and normal, an aim and charge
  wobble applied after the search.
- The planner is a generator with no clock: tests and the arena run it to completion; the
  client runs it in a **Web Worker** (a main-thread time-sliced fallback exists), so the CPU
  thinks at full speed however slow the frames are.

## Why
- Using the real sim for prediction and scoring keeps the CPU honest and exact: wind, bounces,
  sticky bombs, knockback into the water, mines and chain reactions are all "known" without a
  second physics model.
- Input-only output keeps the sim free of AI code paths and keeps determinism trivially intact.

## Consequences
- Weapons that need in-flight timing (remote detonation, boomerang), deployables and most
  utilities are not used by the CPU yet; it walks towards the enemy or naps when it has no
  shot. Rope, jetpack, crates and teleports are future work.
- The plan is made from a snapshot; anything that moves while the CPU is thinking (rare —
  the world is settled at turn start) can make the shot land differently. That is fine.
