# ADR-006 — Settle-then-reveal damage

Status: accepted (M6) · Plan: §3.2, §7.3, §9.4

## Decision
- Explosions and falls never touch `hp` directly. They add to the character's
  `pendingDamage` and emit `CharacterHit` (for a flinch / flash only).
- The world is *settled* when nothing moves: no projectiles, no queued explosions, no
  character in `air` / `jumpPrep` / `landing` / `drowning`, no awake or sinking body.
  `state.quietTicks` counts consecutive settled ticks (it is part of the state hash).
- After `SETTLE_TICKS` (10) settled ticks, `revealDamage` applies every pending amount in id
  order (`CharacterDamaged` per character, one `DamageRevealed` total). Characters at 0 hp then
  die (`CharacterDied(reason: hp)`) and queue a small death blast (r 20, damage 10,
  knockback 1) that resolves next tick — which can start the cycle again (chain reactions).
- A character that drowns or leaves the map dies at once; its pending damage is discarded.
- `state.autoReveal` (default true) lets the sandbox and tests reveal on their own. The turn
  system (M7) turns it off and calls `revealDamage` itself in the turn-end phase, so reveals
  happen between turns exactly like the plan's turn flow.

## Why
- Classic readability: one clear number per character after the chaos, not a flicker of
  partial hits. Totals from several blasts read as one hit.
- Deaths never happen mid-flight, so a character thrown by a blast finishes its arc before
  popping, and chain reactions resolve in a deterministic, turn-ordered way.

## Consequences
- Anything that "moves" must be reflected in `worldInMotion` (new projectile kinds, mines,
  barrels, crates at M9–M10), otherwise reveals fire too early.
- UI must show HP from state, and treat `pendingDamage` as hidden information in real matches
  (the sandbox shows it as a debug aid).
