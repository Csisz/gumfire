# ADR-008 — Online play: lockstep by input relay

Status: accepted (M17) · Plan: §15

## Decision
- **Lockstep, not state sync.** Every machine runs the same deterministic sim (ADR-002); only
  input frames and commands travel. A match on the wire is the replay format (ADR-005).
- **One author per tick.** From its state at tick t every machine computes who writes tick
  t + 1: the player whose team is acting (turn and retreat), otherwise the **host** (the quiet
  ticks between turns, CPU teams, and teams whose player is away). States are identical, so
  everyone agrees without a message. The author steps at once (no input delay for the acting
  player) and sends its frames; the others play them as they arrive and speed up when behind.
- **The server is a relay** (`apps/server`, Node + `ws`): rooms with 4-letter codes, the host's
  lobby info, and the match's input log in order. A frame batch that does not continue the log
  exactly is turned down and its sender gets the whole log again (`catchup`) — "first writer
  wins", which only matters when players drop or rejoin. The server never runs the game.
- **(Re)joining = replaying.** A player who reconnects with the seat token (or a client that
  notices a gap) receives the match spec and the whole log and re-simulates headless
  (~35 000 ticks/s), then carries on.
- **Desync check:** every 250 ticks clients report a state hash; the server compares them and
  warns everyone once.
- The same container serves the built game and the WebSocket (`/ws`), so "Online" on a page
  served by the server needs no address.

## Why
- Turn-based play hands control to one player at a time: one author per tick fits it exactly and
  needs no rollback; only the acting player's latency is hidden, which is the one that matters.
- Inputs are tiny (one 16-bit frame per tick, run-length coded for catch-ups); a whole match log
  is a few kilobytes.

## Consequences
- Watchers see the acting player's moves after one network trip; the turn timer runs on the
  author's clock.
- A host whose tab is hidden (browsers stop animation frames) holds up the quiet ticks.
- No pause online; instant replays and restarts are offline-only.
