import { Mat, type MapSpec } from '@gumfire/sim';

/**
 * Maps built from objects (M18.5): instead of one generic island shape with a themed surface,
 * the ground is stacked from the theme's own things — soap bars and sponges in the bathroom,
 * tyres, crates and toolboxes in the garage, books and erasers on the toy desk — with thin
 * ones (a toothbrush, a pencil, a steel beam) as floating ledges. Each object's outline comes
 * from its painted picture, so what you see is exactly what you can stand on and blow apart.
 *
 * Pure and seeded: the same kit, shapes and seed give the same map. The host (or the replay
 * file) carries the result as an ordinary map, so other machines never need to rebuild it.
 */
export interface ShapeMask {
  id: string;
  /** Mask grid (a scaled-down copy of the picture's alpha). */
  w: number;
  h: number;
  solid: Uint8Array;
}

/** An object placed on the map: its picture is drawn into this world rectangle. */
export interface Piece {
  shape: string;
  x: number;
  y: number;
  w: number;
  h: number;
  flip: boolean;
}

export interface ObjectKit {
  /** Big pieces the islands are built from. */
  ground: string[];
  /** Pieces stacked on top. */
  tall: string[];
  /** Thin pieces used as floating ledges. */
  ledges: string[];
}

export interface ObjectMap {
  spec: MapSpec;
  pieces: Piece[];
}

function rng(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Is the piece solid at world pixel (x, y)? */
export function pieceSolidAt(p: Piece, m: ShapeMask, x: number, y: number): boolean {
  if (x < p.x || y < p.y || x >= p.x + p.w || y >= p.y + p.h) return false;
  let u = (x - p.x + 0.5) / p.w;
  if (p.flip) u = 1 - u;
  const v = (y - p.y + 0.5) / p.h;
  const mx = Math.min(m.w - 1, Math.floor(u * m.w)), my = Math.min(m.h - 1, Math.floor(v * m.h));
  return m.solid[my * m.w + mx] === 1;
}

/** Stamp pieces into a material map (and optionally note the topmost piece per pixel). */
export function stampPieces(pieces: readonly Piece[], masks: ReadonlyMap<string, ShapeMask>, W: number, H: number, mat: Uint8Array | null, top: Int16Array | null): void {
  pieces.forEach((p, i) => {
    const m = masks.get(p.shape);
    if (!m) return;
    const x0 = Math.max(0, Math.floor(p.x)), y0 = Math.max(0, Math.floor(p.y));
    const x1 = Math.min(W - 1, Math.ceil(p.x + p.w)), y1 = Math.min(H - 1, Math.ceil(p.y + p.h));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!pieceSolidAt(p, m, x, y)) continue;
        if (mat) mat[y * W + x] = Mat.SOIL;
        if (top) top[y * W + x] = i;
      }
    }
  });
}

/** Highest solid pixel in each column of [x0, x1) (H when the column is empty). */
function surface(mat: Uint8Array, W: number, H: number, x0: number, x1: number): number {
  let best = H;
  for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
    for (let y = 0; y < best; y++) {
      if (mat[y * W + x] !== Mat.AIR) {
        best = y;
        break;
      }
    }
  }
  return best;
}

export function generateObjectMap(kit: ObjectKit, masks: ReadonlyMap<string, ShapeMask>, seed: number, W = 2000, H = 760): ObjectMap {
  for (let attempt = 0; attempt < 8; attempt++) {
    const out = tryMap(kit, masks, seed + attempt * 7919, W, H);
    if (out) return out;
  }
  return tryMap(kit, masks, seed, W, H, true)!;
}

function tryMap(kit: ObjectKit, masks: ReadonlyMap<string, ShapeMask>, seed: number, W: number, H: number, force = false): ObjectMap | null {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const usable = (ids: readonly string[]) => ids.filter((id) => masks.has(id));
  const ground = usable(kit.ground), tall = usable(kit.tall), ledges = usable(kit.ledges);
  if (!ground.length) return null;
  const waterY = H - 50;
  const mat = new Uint8Array(W * H);
  const pieces: Piece[] = [];
  const aspect = (id: string) => masks.get(id)!.w / masks.get(id)!.h;
  const place = (shape: string, x: number, y: number, w: number, h: number) => {
    const p: Piece = { shape, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), flip: r() < 0.5 };
    pieces.push(p);
    stampPieces([p], masks, W, H, mat, null);
    return p;
  };

  // islands: 2 or 3 stretches of ground with water between
  const islands = r() < 0.5 ? 2 : 3;
  const gap = 110 + r() * 90;
  const span = (W - 80 - gap * (islands - 1)) / islands;
  for (let k = 0; k < islands; k++) {
    const x0 = 40 + k * (span + gap), x1 = x0 + span;
    // the base layer: big pieces side by side, sunk into the water
    let x = x0 - 10;
    while (x < x1 - 60) {
      const id = pick(ground);
      const h = 190 + r() * 170;
      let w = Math.min(h * aspect(id), 560);
      w = Math.max(80, Math.min(w, x1 + 20 - x));
      const ph = w / aspect(id);
      place(id, x, waterY + 40 - ph, w, ph);
      x += w * (0.78 + r() * 0.12);
    }
    // stacked pieces on top (on the highest point under them: overhangs make little caves)
    const stacks = 3 + Math.floor(r() * 3);
    for (let s = 0; s < stacks; s++) {
      const id = tall.length && r() < 0.6 ? pick(tall) : pick(ground);
      const h = 100 + r() * 150;
      let w = h * aspect(id);
      if (w > 380) w = 380;
      const ph = w / aspect(id);
      const px = x0 + r() * Math.max(1, span - w);
      const top = surface(mat, W, H, Math.round(px + w * 0.3), Math.round(px + w * 0.7));
      const y = top - ph + 14;
      if (y < 110) continue; // keep headroom for lobbing
      place(id, px, y, w, ph);
    }
  }
  // floating ledges over the water and the islands
  const nLedges = ledges.length ? 2 + Math.floor(r() * 3) : 0;
  for (let i = 0; i < nLedges; i++) {
    const id = pick(ledges);
    const w = 170 + r() * 140;
    const h = w / aspect(id);
    const x = 60 + r() * (W - 120 - w);
    const top = surface(mat, W, H, Math.round(x), Math.round(x + w));
    const y = Math.min(top - h - 80, 140 + r() * 220);
    if (y < 120) continue;
    place(id, x, y, w, h);
  }

  // sanity: enough ground, and room to stand on in several places
  let solid = 0;
  for (let i = 0; i < W * H; i++) if (mat[i] !== Mat.AIR) solid++;
  let tops = 0;
  for (let x = 20; x < W - 20; x += 40) if (surface(mat, W, H, x, x + 1) < waterY - 30) tops++;
  if (!force && (solid < W * H * 0.12 || tops < 18)) return null;
  return { spec: { width: W, height: H, mat, waterY }, pieces };
}

/** Make a mask from a picture's alpha (browser): scaled to at most `max` px on its long side. */
export function maskFromImage(id: string, img: HTMLImageElement, max = 256): ShapeMask {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3]! > 140 ? 1 : 0;
  return { id, w, h, solid };
}
