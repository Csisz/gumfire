# ADR-001 — TypeScript monorepo with a custom deterministic simulation and PixiJS

Status: accepted (M0) · Plan: §6.1

## Decision
Build GUMFIRE as a pnpm TypeScript monorepo. The game rules live in `packages/sim`, a pure
simulation with no rendering, DOM, network or platform dependencies. Rendering uses PixiJS v8,
menus/HUD will use React, tooling is Vite + Vitest + ESLint, the online server is Node + `ws`.

## Why
The hard problems — pixel-destructible terrain, deterministic physics, AI shot search, lockstep
networking, replays — are all simulation problems where engines add little. A pure TS sim runs
headless in Node thousands of ticks per millisecond, which makes autonomous test-driven
development fast. Godot/Unity physics is float-based and non-deterministic and would be bypassed.

## Consequences
- Every system must be written by us (no physics engine).
- `packages/sim` may import nothing from other packages (enforced by ESLint).
- Desktop builds come later via Tauri.
