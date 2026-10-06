# M15a — Art pass: painted maps and Gumlings

Status: **done** (2026-10-02). Pulled forward before the AI opponent at the owner's request:
the maps and characters should reach the look of the concept boards (docs/art/references).

## Checklist
- [x] **HD terrain painter** (`packages/render/src/terrainArt.ts`): 2× output resolution,
      anti-aliased edges, outline, ambient occlusion and depth shading from a distance field,
      a crust (icing / frosting / glaze / grass) along the original top surface, scorched
      crater rims, a back wall behind holes
- [x] **Snack chunks**: terrain split into Voronoi chunks with outlined seams, each its own
      material — Frozen Snack Factory: cookie sponge + white icing, strawberry cake + pink
      frosting, brownie + chocolate glaze, ice cubes + frost; Garden Picnic: grassy soil (same
      chunks merge, no seam) with biscuit blocks glazed in caramel
- [x] **Art pack** (`apps/sandbox/public/art`, 28 files, ~4.9 MB): painted backdrops, terrain
      textures, props, Gumling poses and hats, generated with Higgsfield (text prompts only,
      original designs) and cut out by `tools/art/process_pack.py`
- [x] **Backdrop**: the painting as the far parallax layer, padded and feathered into a
      matching sky so zooming out shows no edge; big props in a hazy middle layer
- [x] **Set dressing** (`world/decor.ts`): cones, popsicles, ice cubes / strawberries, daisies,
      biscuits standing on the surface; seeded from the map, presentation only; they topple
      away when the ground under them is blown out
- [x] **Painted Gumlings**: team-tinted candy body sprite with idle / walk / jump / hurt poses,
      painted hats, the code-drawn face (eyes follow the aim) and the held weapon on top
- [x] Everything falls back to the generated look when the pack is missing

## Tests (267)
No sim changes (no golden changes). `pnpm check` green.

## Manual check
Headless Chromium: Slice Island and random island in both themes, wide / zoomed-out /
close-up, walk and jump poses, no console errors. Match start ≈ 8–9 s in the software
renderer (≈ 7 s before); a real GPU is much faster.

## Next
More themes' art (toy desk, garage, bathroom harbour), crust strips and more chunk shapes if
wanted; then **M15b — AI opponent**.
