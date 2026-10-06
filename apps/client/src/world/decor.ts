import { Container, Sprite, Texture } from 'pixi.js';
import { isSolid, type TerrainState } from '@gumfire/sim';

/**
 * Set dressing (art pack): painted snack props standing on the terrain surface — cones and
 * popsicles in the frozen factory, strawberries and daisies at the picnic. Presentation only:
 * the sim never sees them. Placement is seeded from the map so a replay looks the same, and a
 * prop topples away once the ground under its foot is blown out.
 */
interface Piece {
  s: Sprite;
  x: number;
  y: number;
  half: number;
  falling: number;
  vy: number;
}

export class Decor {
  readonly container = new Container();
  private readonly pieces: Piece[] = [];
  private readonly textures: Texture[] = [];
  private frame = 0;

  constructor(
    private readonly terrain: TerrainState,
    images: HTMLImageElement[],
    seed: number,
    /** Keep these x positions (spawns, objects) clear. */
    avoid: number[] = [],
  ) {
    if (!images.length) return;
    const tex = images.map((im) => {
      const t = Texture.from(im, true);
      t.source.scaleMode = 'linear';
      this.textures.push(t);
      return t;
    });
    let r = (seed ^ 0x5bd1e995) >>> 0;
    const rnd = () => ((r = (Math.imul(r ^ (r >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) | 0) >>> 0) / 4294967296;
    const t = terrain;
    const count = Math.round(t.width / 150);
    const used: number[] = [];
    for (let tries = 0; tries < count * 6 && this.pieces.length < count; tries++) {
      const x = Math.round(40 + rnd() * (t.width - 80));
      if (used.some((u) => Math.abs(u - x) < 70) || avoid.some((a) => Math.abs(a - x) < 28)) continue;
      // the top surface at x, with open air above for the prop
      let y = 0;
      while (y < t.height && !isSolid(t, x, y)) y++;
      if (y >= t.height - 60 || y < 40) continue;
      const k = Math.floor(rnd() * tex.length);
      const tx = tex[k]!;
      const h = 26 + rnd() * 26;
      const w = (h * tx.width) / tx.height;
      // needs a fairly flat footing: both edges of the base touch the ground nearby
      const half = Math.max(4, w * 0.3);
      const ground = (gx: number) => {
        for (let d = -6; d <= 8; d++) if (isSolid(t, Math.round(gx), y + d)) return true;
        return false;
      };
      if (!ground(x - half) || !ground(x + half)) continue;
      const s = new Sprite(tx);
      s.anchor.set(0.5, 1);
      s.height = h;
      s.width = w * (rnd() < 0.5 ? -1 : 1);
      s.position.set(x, y + 5); // sunk a little: the frosting crust covers the foot
      s.rotation = (rnd() - 0.5) * 0.12;
      used.push(x);
      this.pieces.push({ s, x, y, half, falling: 0, vy: 0 });
      this.container.addChild(s);
    }
  }

  /** Check support now and then; unsupported props tip over and drop out of sight. */
  update(): void {
    this.frame++;
    for (const p of this.pieces) {
      if (p.falling) {
        p.vy += 0.35;
        p.s.y += p.vy;
        p.s.rotation += 0.06 * p.falling;
        p.s.alpha -= 0.02;
        p.s.visible = p.s.alpha > 0;
        continue;
      }
      if (this.frame % 8 !== 0) continue;
      const t = this.terrain;
      let support = 0;
      for (const dx of [-p.half, 0, p.half]) for (let d = -2; d <= 6; d++) if (isSolid(t, Math.round(p.x + dx), p.y + d)) { support++; break; }
      if (support < 2) p.falling = Math.random() < 0.5 ? -1 : 1;
    }
  }

  destroy(): void {
    for (const t of this.textures) t.destroy(true);
  }
}
