import { describe, expect, it } from 'vitest';
import { createGame, hashState } from '@gumfire/sim';
import { generateObjectMap, stampPieces, type ShapeMask } from '../src/world/objectMaps';

/** Synthetic outlines: a rounded slab, a disc and a thin ledge. */
function mask(id: string, w: number, h: number, inside: (u: number, v: number) => boolean): ShapeMask {
  const solid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) solid[y * w + x] = inside((x + 0.5) / w, (y + 0.5) / h) ? 1 : 0;
  return { id, w, h, solid };
}
const masks = new Map<string, ShapeMask>([
  ['slab', mask('slab', 120, 60, (u, v) => Math.abs(u - 0.5) < 0.48 && Math.abs(v - 0.5) < 0.46)],
  ['disc', mask('disc', 80, 80, (u, v) => (u - 0.5) ** 2 + (v - 0.5) ** 2 < 0.22)],
  ['ledge', mask('ledge', 160, 16, (u, v) => Math.abs(v - 0.5) < 0.4 && Math.abs(u - 0.5) < 0.49)],
]);
const kit = { ground: ['slab', 'disc'], tall: ['disc'], ledges: ['ledge'] };

describe('object-built maps', () => {
  it('are seeded: the same seed gives the same map and pieces', () => {
    const a = generateObjectMap(kit, masks, 42), b = generateObjectMap(kit, masks, 42), c = generateObjectMap(kit, masks, 43);
    expect(b.pieces).toEqual(a.pieces);
    let diff = 0;
    for (let i = 0; i < a.spec.mat.length; i++) if (a.spec.mat[i] !== b.spec.mat[i]) diff++;
    expect(diff).toBe(0);
    expect(c.pieces).not.toEqual(a.pieces);
  });

  it('give playable matches (every Gumling finds a spot) on many seeds', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const m = generateObjectMap(kit, masks, seed);
      expect(m.pieces.length).toBeGreaterThan(6);
      const s = createGame({ seed, map: m.spec, match: { teams: [1, 2, 3, 4].map((i) => ({ name: `T${i}`, size: 4 })) } });
      expect(s.characters).toHaveLength(16);
      expect(hashState(s)).toBeTypeOf('number');
    }
  });

  it('what is drawn is exactly what is solid', () => {
    const m = generateObjectMap(kit, masks, 7);
    const { width: W, height: H } = m.spec;
    const top = new Int16Array(W * H).fill(-1);
    stampPieces(m.pieces, masks, W, H, null, top);
    let wrong = 0;
    for (let i = 0; i < W * H; i++) if (top[i]! >= 0 !== (m.spec.mat[i] !== 0)) wrong++;
    expect(wrong).toBe(0);
  });
});
