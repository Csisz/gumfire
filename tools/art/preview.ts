import { writeFileSync } from 'node:fs';
import { carveCircle, createGame, generateMap } from '../../packages/sim/src/index.js';
import { FROZEN_SNACK_THEME, GARDEN_PICNIC_THEME, paintTerrainHD, proceduralArt } from '../../packages/render/src/index.js';

const OUT = process.env.ART_OUT ?? '/tmp';
{
  for (const [name, theme, gen] of [['frozen', FROZEN_SNACK_THEME, 'island'], ['picnic', GARDEN_PICNIC_THEME, 'cavern']] as const) {
    const spec = generateMap({ generator: gen, seed: 77 }).spec;
    const g = createGame({ seed: 1, map: spec });
    const t = g.terrain!;
    const original = t.mat.slice();
    carveCircle(t, 700, 330, 40);
    carveCircle(t, 1200, 420, 55);
    const art = proceduralArt(theme, 2);
    const S = 2;
    // crop 900×450 world px
    const cx = 500, cy = 150, cw = 900, ch = 450;
    const out = new Uint8ClampedArray(t.width * S * t.height * S * 4);
    const t0 = Date.now();
    paintTerrainHD(t, art, out, cx, cy, cx + cw - 1, cy + ch - 1, original);
    const ms = Date.now() - t0;
    const crop = new Uint8ClampedArray(cw * S * ch * S * 4);
    for (let y = 0; y < ch * S; y++) {
      for (let x = 0; x < cw * S; x++) {
        const s = ((cy * S + y) * t.width * S + cx * S + x) * 4, d = (y * cw * S + x) * 4;
        const a = out[s + 3]! / 255;
        // over a sky colour
        crop[d] = out[s]! * a + 196 * (1 - a);
        crop[d + 1] = out[s + 1]! * a + 234 * (1 - a);
        crop[d + 2] = out[s + 2]! * a + 252 * (1 - a);
        crop[d + 3] = 255;
      }
    }
    writeFileSync(`${OUT}/${name}.rgba`, crop);
    writeFileSync(`${OUT}/${name}.txt`, `${cw * S}x${ch * S} ${ms}ms`);
  }
}
