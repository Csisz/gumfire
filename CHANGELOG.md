# Changelog

## 1.0.0 — 2026-10-06 (M20, first release)

The whole of Phase 1, M0–M20:

- **The game** — two to four teams of Gumlings, turn by turn, on pixel-destructible terrain;
  walking, jumping, backflips, fall damage, water; wind; a deterministic integer simulation, so
  replays, online lockstep and the CPU's look-ahead all run the same code (M0–M8).
- **27 weapons and tools** — rockets, fused and bouncing grenades, cluster bombs, homing, air
  strike, hitscan, melee, fire, a walking bomb, boomerang, girders and bridges, teleport,
  parachute, jetpack, drill, torch, grapple rope (M9–M13); mines, kegs and supply crates (M10).
- **Five painted themes** — Frozen Snack Factory, Garden Picnic, Toy Desk, Garage Junkyard,
  Bathroom Bubble Harbour — each with its own backdrop, terrain look, liquid, weather and music,
  and maps built from its own objects: frozen donuts, picnic baskets, soap bars, tyres, books
  (M14, M15-art, M18, M18.5, M18.6).
- **CPU opponents** at three levels (M15b), **hot-seat** with alliances (2v2) and best-of-3/5
  series, **replays** to save and watch (M16), **online** rooms with reconnect (M17).
- **Balance** — weapon lab and CPU arena statistics; a turn limit so every match ends (M19).

Release work (M20):

- Hosting the game and the relay apart: `VITE_RELAY_URL` at build time, `?server=` links, a
  forgiving server field ("nas:8787", "https://…", "wss://…/ws" all work); the relay checks
  `ALLOWED_ORIGINS`. `vercel.json` and a step-by-step `DEPLOY.md` (Vercel + Synology reverse
  proxy with WebSockets, or one container).
- Art stored as WebP: 40 MB → 5 MB (object outlines identical); a first match loads under 3 MB.
- Menus in front of the themes' painted rooms, drifting and cross-fading; About screen with
  controls and credits; version shown on the title.
- App icons (installable as an app), link preview picture and description.
- Errors show on screen with a Reload link instead of a silent freeze.
