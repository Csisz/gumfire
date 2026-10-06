import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { paintLayer, type LayerId } from './painted';
import type { Camera } from '@gumfire/render';
import { THEMES, type ThemeDef, type ThemeId } from './themes';

/**
 * Theme backdrops (art boards 1 and 5): a sky fixed to the screen, a far and a mid layer that
 * scroll with parallax (`depth` 0 = fixed to the screen, 1 = moves with the world), and drifting
 * snowflakes or petals. Layers are painted by painted.ts, or come from an art pack.
 */
export type BackdropTheme = ThemeId;

interface Layer {
  c: Container;
  depth: number;
}

export class Background {
  readonly container = new Container();
  private readonly sky: Sprite;
  private readonly layers: Layer[] = [];
  private readonly flakes: Array<{ g: Graphics; x: number; y: number; v: number; phase: number }> = [];
  private readonly textures: Texture[] = [];

  constructor(
    private readonly worldW: number,
    private readonly worldH: number,
    readonly theme: BackdropTheme = 'frozen',
    /** Painted images from an art pack, replacing the generated layers. */
    images: Partial<Record<LayerId, CanvasImageSource & { width: number; height: number }>> = {},
    /**
     * A painted backdrop scene (art pack): one wide picture as the far layer, kept in proportion
     * with its bottom at the waterline; the sky above it is its own top colour. `midProps` are
     * big set pieces (ice-cream tubs, strawberries…) standing in a hazy middle layer.
     */
    backdrop?: { image: HTMLImageElement; midProps: HTMLImageElement[] },
  ) {
    const def = THEMES[theme];
    const tex = (src: CanvasImageSource & { width: number; height: number }): Texture => {
      const t = Texture.from(src as HTMLCanvasElement, true); // uncached: destroyed with the match
      t.source.scaleMode = 'linear';
      this.textures.push(t);
      return t;
    };
    if (backdrop) {
      this.sky = new Sprite(tex(skyFrom(backdrop.image)));
      this.container.addChild(this.sky);
      this.addBackdrop(backdrop.image, backdrop.midProps, tex);
      this.addAir(def.air);
      return;
    }
    this.sky = new Sprite(tex(images.sky ?? paintLayer(def.painted, 'sky', 1024, 576)));
    this.container.addChild(this.sky);
    // far and mid layers cover x ∈ [-0.25 W, 1.25 W], y ∈ [-0.4 H, H] in layer units, painted at half size
    const LW = worldW * 1.5, LH = worldH * 1.4;
    for (const [id, depth] of [
      ['far', 0.25],
      ['mid', 0.55],
    ] as const) {
      const c = new Container();
      const sp = new Sprite(tex(images[id] ?? paintLayer(def.painted, id, LW * 0.5, LH * 0.5)));
      sp.width = LW;
      sp.height = LH;
      sp.position.set(-worldW * 0.25, -worldH * 0.4);
      c.addChild(sp);
      this.layers.push({ c, depth });
      this.container.addChild(c);
    }
    this.addAir(def.air);
  }

  private addBackdrop(image: HTMLImageElement, midProps: HTMLImageElement[], tex: (src: HTMLImageElement | HTMLCanvasElement) => Texture): void {
    const { worldW, worldH } = this;
    const LW = worldW * 1.5;
    // far: the scene, padded with its own sky and haze and soft edges so zooming out finds no seam
    const far = new Container();
    const scene = padScene(image);
    const sp = new Sprite(tex(scene.canvas));
    sp.width = LW * 1.3;
    sp.height = (sp.width * scene.canvas.height) / scene.canvas.width;
    sp.position.set(worldW / 2 - sp.width / 2, worldH * 1.05 - sp.height);
    const below = new Graphics().rect(sp.x, worldH * 1.05 - 2, sp.width, worldH).fill(scene.bottom);
    far.addChild(sp, below);
    this.layers.push({ c: far, depth: 0.25 });
    this.container.addChild(far);
    // mid: a few big props in the haze, spread along the layer
    if (midProps.length) {
      const mid = new Container();
      const haze = THEMES[this.theme].haze;
      const n = Math.max(3, Math.round(worldW / 700));
      let r = 0x9e3779b9 ^ worldW;
      const rnd = () => ((r = (Math.imul(r ^ (r >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) | 0) >>> 0) / 4294967296;
      for (let i = 0; i < n; i++) {
        const im = midProps[i % midProps.length]!;
        const p = new Sprite(tex(im));
        const h = worldH * (0.2 + rnd() * 0.12);
        p.height = h;
        p.width = (h * im.naturalWidth) / im.naturalHeight;
        p.anchor.set(0.5, 1);
        p.position.set(-worldW * 0.2 + ((i + 0.3 + rnd() * 0.4) / n) * LW * 0.95, worldH * 1.02);
        if (rnd() < 0.5) p.scale.x *= -1;
        p.alpha = 0.85;
        p.tint = haze; // atmospheric haze
        mid.addChild(p);
      }
      this.layers.push({ c: mid, depth: 0.55 });
      this.container.addChild(mid);
    }
  }

  /** What drifts through the air: snow, petals, dust motes or rising soap bubbles. */
  private addAir(kind: ThemeDef['air']): void {
    const petals = [0xffffff, 0xffc2d6, 0xfff3a8];
    const n = kind === 'snow' ? 70 : kind === 'petals' ? 40 : kind === 'bubbles' ? 26 : 45;
    for (let i = 0; i < n; i++) {
      const g = new Graphics();
      if (kind === 'petals') g.ellipse(0, 0, 2.2, 1.3).fill({ color: petals[i % 3]!, alpha: 0.9 });
      else if (kind === 'snow') g.circle(0, 0, 1 + Math.random() * 1.6).fill({ color: 0xffffff, alpha: 0.85 });
      else if (kind === 'dust') g.circle(0, 0, 0.8 + Math.random() * 1.2).fill({ color: 0xfff3d6, alpha: 0.55 });
      else {
        const r = 3 + Math.random() * 7;
        g.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.12 }).stroke({ width: 1.2, color: 0xffffff, alpha: 0.75 });
        g.circle(-r * 0.35, -r * 0.35, r * 0.25).fill({ color: 0xffffff, alpha: 0.8 });
      }
      // bubbles rise, dust hangs about, snow and petals fall
      const v = kind === 'bubbles' ? -(0.00012 + Math.random() * 0.0002) : kind === 'dust' ? 0.00002 + Math.random() * 0.00005 : (kind === 'petals' ? 0.00008 : 0.00015) + Math.random() * 0.00025;
      this.flakes.push({ g, x: Math.random(), y: Math.random(), v, phase: Math.random() * 6 });
      this.container.addChild(g);
    }
  }

  destroy(): void {
    for (const t of this.textures) t.destroy(true);
  }

  update(camera: Camera, nowMs: number): void {
    const vw = camera.viewW, vh = camera.viewH;
    this.sky.width = vw;
    this.sky.height = vh;
    for (const l of this.layers) {
      // at depth d the layer moves d× as fast as the world, at a proportionally smaller scale
      const s = camera.zoom * (0.55 + 0.45 * l.depth);
      const cx = this.worldW / 2 + (camera.x - this.worldW / 2) * l.depth;
      const cy = this.worldH / 2 + (camera.y - this.worldH / 2) * l.depth;
      l.c.scale.set(s);
      l.c.position.set(vw / 2 - cx * s, vh / 2 - cy * s + (1 - l.depth) * vh * 0.12);
    }
    for (const f of this.flakes) {
      f.y = (f.y + f.v * 16 + 1) % 1;
      f.g.position.set(((f.x + Math.sin(nowMs / 1400 + f.phase) * 0.01) % 1) * vw, f.y * vh);
    }
  }
}

/** Average colour of an image's top or bottom rows (CSS-style hex number). */
function edgeColour(image: HTMLImageElement, edge: 'top' | 'bottom'): number {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(image, 0, 0, 64, 32);
  const d = g.getImageData(0, edge === 'top' ? 0 : 29, 64, 3).data;
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]!;
    gg += d[i + 1]!;
    b += d[i + 2]!;
  }
  const n = d.length / 4;
  return (Math.round(r / n) << 16) | (Math.round(gg / n) << 8) | Math.round(b / n);
}

const css = (v: number, t = 0) => {
  const f = (x: number) => Math.round(x + (255 - x) * t);
  return `rgb(${f((v >> 16) & 255)},${f((v >> 8) & 255)},${f(v & 255)})`;
};

/** Sky colours for a backdrop: its top colour, lightened (the haze), down to its bottom colour. */
function skyStops(image: HTMLImageElement): [number, number] {
  return [edgeColour(image, 'top'), edgeColour(image, 'bottom')];
}

/** The sky behind everything: the same gradient the padded scene fades into. */
function skyFrom(image: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const [top, bottom] = skyStops(image);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, css(top, 0.25));
  grad.addColorStop(1, css(bottom, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return c;
}

/**
 * The backdrop on a bigger canvas: a sky gradient around it and the picture's top and side
 * edges faded into that sky, so the edge of the painting never shows.
 */
function padScene(image: HTMLImageElement): { canvas: HTMLCanvasElement; bottom: number } {
  const w = image.naturalWidth, h = image.naturalHeight;
  const PW = Math.round(w * 1.3), PH = Math.round(h * 1.45);
  const [top, bottom] = skyStops(image);
  const c = document.createElement('canvas');
  c.width = PW;
  c.height = PH;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, PH);
  sky.addColorStop(0, css(top, 0.25));
  sky.addColorStop(1, css(bottom, 0));
  g.fillStyle = sky;
  g.fillRect(0, 0, PW, PH);
  // the picture with feathered top and sides
  const m = document.createElement('canvas');
  m.width = w;
  m.height = h;
  const mg = m.getContext('2d')!;
  mg.drawImage(image, 0, 0);
  mg.globalCompositeOperation = 'destination-in';
  const fx = mg.createLinearGradient(0, 0, w, 0);
  fx.addColorStop(0, 'rgba(0,0,0,0)');
  fx.addColorStop(0.1, 'rgba(0,0,0,1)');
  fx.addColorStop(0.9, 'rgba(0,0,0,1)');
  fx.addColorStop(1, 'rgba(0,0,0,0)');
  mg.fillStyle = fx;
  mg.fillRect(0, 0, w, h);
  const fy = mg.createLinearGradient(0, 0, 0, h);
  fy.addColorStop(0, 'rgba(0,0,0,0)');
  fy.addColorStop(0.14, 'rgba(0,0,0,1)');
  fy.addColorStop(1, 'rgba(0,0,0,1)');
  mg.fillStyle = fy;
  mg.fillRect(0, 0, w, h);
  g.drawImage(m, (PW - w) / 2, PH - h);
  return { canvas: c, bottom };
}
