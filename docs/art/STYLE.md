# GUMFIRE — art direction

Viktor's reference boards (2026-09-30) in [`references/`](references) define the look. They are
AI-generated **concept references only**: final assets are redrawn to match them, never traced or
shipped. Two things on the boards are deliberately **not** carried over: the word "worms" in any
text (the game is GUMFIRE, the characters are Gumlings) and look-alikes of real brands (the spray
can with a real product's label, the branded sandwich cookie). Every label and prop is our own.

| Board | Theme | Teams | Weapon ideas on the board |
| --- | --- | --- | --- |
| 1 | Frozen Snack Factory — cake/cookie islands with icing drips, ice cubes, pipes and tanks | Mint (green), Cherry (red) | Frosting Blaster, Fizzy Soda Bomb, Flying Cookie Roller |
| 2 | Toy Desk — torn-paper and cardboard terrain, crayons, clips, sticky notes | Shadow (black), Marsh (white) | Crayon Rocket, Binder-Clip Launcher, Bouncing Eraser Brick |
| 3 | Garage Workshop — soil with bolts, tyres, springs, crates, tool wall | Lemon (yellow), Plum (purple) | Magnet Mine, Tape-Measure Grappler, Battery Shock Bomb |
| 4 | Bathroom Harbor — soap bars, sponges, foam, tiles | Bubble (blue), Peel (orange) | Bubble Cannon, Plunging Soap Puck, Spinning Toothbrush Drill |
| 5 | Garden Picnic — grassy soil, biscuit bridges, strawberries, jam jars | Berry (red), Leaf (green) | Jam Slingshot, Acorn Mortar, Boomerang Trowel |

The weapon ideas feed the full roster (M9, M12); the themes feed map themes (M11).

## Characters (Gumlings)
- Gummy-candy bean body, slightly translucent, one soft highlight on the upper left, short
  stubby arms and feet, **thick dark outline** (≈ 2 px at 1:1), big simple eyes, tiny mouth.
- Team = body colour. Role = **hat or headgear** (cosmetic): helmet, aviator cap + goggles, chef
  hat, bandana mask, miner helmet with lamp, beret, safari hat, medic helmet, hard hat, snorkel
  mask, captain cap, spiked helmet, hood, strawberry cap, colander, sun hat, leafy camo…
- Expressions carry the mood: determined, cheeky wink, grin, angry brow, X-eyes when popped.

## World
- Terrain reads as food or household material with a **light crust on top** (icing, foam,
  grass) that drips over edges; the cut face shows the material's inside texture.
- Backgrounds are large, soft, slightly desaturated household objects with our own invented
  labels; one gentle warm light source; parallax depth.
- Liquid at the bottom matches the theme (cocoa, milk, bath water, pond).

## UI
- Sky-blue page (`#98e4fc`), **rounded white cards** with coloured tints per team or category
  (mint `#aff5d1`, cherry `#feceda`, cream `#fdf1c8`, ice `#cdf2fa`), a dark navy pill header
  (`#2f6fa8`) with white bold rounded caps text, and a hand-written accent font for taglines.
- Icons sit in rounded-square tiles with a thick outline; exclamation marks and motion lines for
  impact.
- Type: a heavy rounded display face for titles and numbers, a friendly hand-written face for
  flavour text (Google Fonts in the client; exact faces chosen at M14).

## Palette (placeholder art)
| Token | Hex | Use |
| --- | --- | --- |
| outline | `#1a1320` | every character, prop and icon |
| page | `#98e4fc` | client background / UI page |
| navy | `#2f6fa8` | headers, pills |
| mint | `#6fdc4a` | team 1 body |
| cherry | `#e8364f` | team 2 body |
| bubble | `#3fa9f5` | team 3 body |
| plum | `#9b59d0` | team 4 body |
| peel | `#ff9f1c` | team 5 body |
| lemon | `#ffd23f` | team 6 body |

## Art pack (M15a)
Painted assets live in `apps/sandbox/public/art` with a `manifest.json` (served by both the
sandbox and the client). Raw generations are processed by
`python3 tools/art/process_pack.py <raw-dir> apps/sandbox/public/art`: white backgrounds are
flood-filled away from the border, sheets are split into parts, textures are made seamless.
- Backdrops: 2560 px wide, light fog at the bottom (the terrain stands in front of it).
- Terrain textures: 512 px seamless squares, one per snack material.
- Gumling poses: pale grey candy blobs without a face (tinted with the team colour in game).
- Hats and props: cut-outs with the thick dark outline.
Prompts describe original designs only — no existing game, brand or character.

## Themes in the game (M18)
Frozen Snack Factory, Garden Picnic, Toy Desk, Garage Junkyard, Bathroom Bubble Harbour —
defined in `apps/client/src/world/themes.ts` (chunks, crusts, liquid, props, air, music).
New raw art goes through `tools/art/process_pack.py` (lists `THEMES`, `TEXTURES`, `PROPS`).

## Sound
All synthesised in the browser (`audio.ts`, `music.ts`): no sample files, no licences. Voices
are formant-filtered gibberish, never words. Each theme has its own lead instrument.
