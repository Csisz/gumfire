# GUMFIRE

An original 2D turn-based artillery game: squads of tiny gummy-candy soldiers ("Gumlings") wage
household-scale war on pixel-destructible terrain — wind-drifting rockets, bouncing fused
grenades, knockback into hot cocoa. Built around a deterministic simulation so replays, online
lockstep play and AI shot-search come for free.

> Status: **M0 — technical sandbox** complete. See [`docs/progress`](docs/progress).

## Quick start

```bash
pnpm install
pnpm dev          # sandbox at http://localhost:5173
pnpm check        # lint + typecheck + tests + build (what CI runs)
```

Sandbox controls: Space spawn · ←/→ push · Enter kick · P pause · `.` single tick ·
V verify determinism · R restart · I toggle interpolation.

## Repository map

```
apps/sandbox/     dev playground: fixed-step loop, Pixi rendering, determinism check
packages/sim/     PURE deterministic simulation — no DOM, no Pixi, no Math.random, no Date
  src/core/       units, integer trig (+ generated tables), RNG, hash, input, clone
  src/state/      GameState, create/hash/clone/serialise
  src/demo/       temporary M0 bouncers (removed at M3)
  src/step.ts     one 20 ms tick, canonical system order
  src/replay.ts   seed + input frames → state + checkpoint hashes
tests/            cross-package tests (lint-rule enforcement)
tools/            generators (trig tables)
docs/             ADRs, milestone progress, tuning log
```

Planned packages (per the master plan): `content`, `render`, `net`, `apps/client`, `apps/server`.

## Architecture in one paragraph

`step(state, inputFrame) → events` advances the simulation exactly one 20 ms tick. The client
runs it from a `FixedStepLoop` and interpolates rendering between ticks; online play will relay
input frames (not state); replays are `{ seed, inputs[] }`. Render, audio and UI only read the
state and the event stream.

## Determinism rules

1. Simulation state is integers only; positions in subpixels (1 px = 256).
2. No `Math.random`, `Date`, `performance`, timers or float trig in `packages/sim` — ESLint enforces it.
3. Randomness only from `state.rng.<stream>`; each purpose has its own stream.
4. Iterate entities in stable id order; never over unordered collections.
5. Behaviour changes that alter golden hashes get a line in `docs/tuning.md`.

## How to add a weapon

Arrives at M5 (data-driven `WeaponDefinition` JSON + icon + fixture test). See master plan §12.

## Testing

`pnpm test` runs unit, determinism and golden-hash tests. A golden hash change means sim
behaviour changed — update it only on purpose (`pnpm vitest run -u`) and log why.

## Contributing

Trunk-based: `main` always green; branches `mxx/<topic>`; conventional commits
(`feat(sim): …`). One milestone at a time: implement → test → verify → commit → next.

## Licence and assets

All code and assets are original. No names, art, audio or maps from any existing game are used.
Asset provenance will be tracked in `assets/PROVENANCE.md` from the first real asset.
