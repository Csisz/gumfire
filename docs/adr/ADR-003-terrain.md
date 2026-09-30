# ADR-003 — Terrain as a material bitmap with 64×64 chunks

Status: accepted (M1) · Plan: §8

## Decision
- The sim owns `TerrainState`: one byte per pixel (`Mat.AIR/SOIL/ROCK/GIRDER/BORDER`), row-major,
  y down, whole-pixel coordinates. Outside the map reads as AIR (open maps).
- The bitmap is split into 64×64 chunks. Per chunk the sim keeps a solid-pixel count
  (collision early-outs) and a hash. Since M2 the hash is a position-weighted sum
  Σ mat[i]·pixelWeight(i) mod 2³², so edits update it in O(changed pixels) rather than
  rehashing whole chunks (an r=100 crater costs ~0.2 ms).
- The game state hash includes size, `version` and every chunk hash, so hashing is O(chunks)
  (330 for 1920×696), not O(pixels).
- A per-chunk `dirty` flag tells the renderer what to repaint. It is presentation bookkeeping:
  not hashed and never read by gameplay code.
- Maps arrive as a PNG mask. The client decodes it; the sim only receives the material array.
  Colour convention: alpha < 128 → AIR, neutral grey (128 ± 12 per channel) → ROCK, any other
  opaque colour → SOIL.
- Rendering (`packages/render`): a pure painter turns materials into RGBA (outline, frosting
  crust with drips, sponge texture, striped rock). One Pixi texture per chunk; dirty chunks are
  repainted with an 8 px read margin (20 px above, for the crust) and re-uploaded, at most 24
  per frame, the rest queued.
- Serialisation run-length encodes typed arrays, so a full state with a 1920×696 map is a few KB.

## Why
Every collision query becomes an array lookup with no rebuild step after destruction.
Chunks bound both the hash cost and the GPU upload cost of an explosion.

## Consequences
- Edit operations must update chunk data incrementally (`setPixelTracked`, or the batched
  loop in `carveCircle`), call `markDirtyRect` and bump `version`. They reach the sim only as
  commands, so every edit is recorded and replayable.
- The renderer keeps a copy of the loaded bitmap to draw damage (back wall, scorch) and keeps
  frosting on the original surface.
- Loose soil does not fall (classic behaviour); floating islands are expected.
- A 3840×1392 map uses 5.3 MB for materials and 21 MB for the renderer's colour buffer.
