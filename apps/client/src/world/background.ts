import { Container, FillGradient, Graphics, Text } from 'pixi.js';
import type { Camera } from '@gumfire/render';

/**
 * Frozen Snack Factory backdrop (art board 1), placeholder vector art: a pale-blue sky, far
 * factory tanks and pipes, a mid row of giant frozen treats, drifting snowflakes. Every label is
 * our own. Layers scroll with parallax: `depth` 0 = fixed to the screen, 1 = moves with the world.
 */
interface Layer {
  c: Container;
  depth: number;
}

export class Background {
  readonly container = new Container();
  private readonly sky = new Graphics();
  private skyW = 0;
  private skyH = 0;
  private readonly layers: Layer[] = [];
  private readonly flakes: Array<{ g: Graphics; x: number; y: number; v: number; phase: number }> = [];

  constructor(private readonly worldW: number, private readonly worldH: number) {
    this.container.addChild(this.sky);
    // far layer paler than the mid layer so the two never read as one muddle
    const far = this.farFactory();
    far.alpha = 0.55;
    const mid = this.midTreats();
    mid.alpha = 0.85;
    this.layers.push({ c: far, depth: 0.25 }, { c: mid, depth: 0.55 });
    for (const l of this.layers) this.container.addChild(l.c);
    for (let i = 0; i < 70; i++) {
      const g = new Graphics().circle(0, 0, 1 + Math.random() * 1.6).fill({ color: 0xffffff, alpha: 0.85 });
      this.flakes.push({ g, x: Math.random(), y: Math.random(), v: 0.00015 + Math.random() * 0.00025, phase: Math.random() * 6 });
      this.container.addChild(g);
    }
  }

  private farFactory(): Container {
    const c = new Container();
    const W = this.worldW, H = this.worldH;
    const g = new Graphics();
    const base = H * 0.95;
    const tank = (x: number, w: number, h: number, label: string, lid: number) => {
      g.roundRect(x, base - h, w, h, 18).fill(0xb9d9ee).stroke({ width: 3, color: 0x7fa9c6 });
      g.roundRect(x - 8, base - h - 20, w + 16, 34, 14).fill(lid).stroke({ width: 3, color: 0x7fa9c6 });
      for (let k = 0; k < 5; k++) g.ellipse(x + 16 + k * (w - 32) / 4, base - h + 12, 7, 10).fill(0xffffff);
      const t = new Text({ text: label, style: { fontFamily: 'Fredoka, sans-serif', fontSize: 34, fontWeight: '700', fill: 0x8fb6d2, align: 'center' } });
      t.anchor.set(0.5);
      t.position.set(x + w / 2, base - h * 0.55);
      c.addChild(t);
    };
    // pipes
    for (let k = 0; k < 9; k++) g.rect(W * 0.02 + k * W * 0.12, base - H * 1.1, 26, H * 1.1).fill(0xc7e2f3);
    g.rect(-400, base - H * 0.78, W + 800, 22).fill(0xc7e2f3);
    g.rect(-400, base - H * 0.58, W + 800, 16).fill(0xc7e2f3);
    tank(W * 0.08, 300, H * 0.72, 'GUMFIRE\nICE WORKS', 0xe9f5fb);
    tank(W * 0.42, 260, H * 0.62, 'CHILL\nBATCH 7', 0xf6e1ea);
    tank(W * 0.72, 320, H * 0.8, 'FROSTY\nFIZZ', 0xe9f5fb);
    c.addChildAt(g, 0);
    return c;
  }

  private midTreats(): Container {
    const c = new Container();
    const g = new Graphics();
    const W = this.worldW, H = this.worldH;
    const base = H * 0.98;
    const ink = { width: 3, color: 0x6f8fa8 };
    // giant ice-cream tub
    g.moveTo(W * 0.02, base - 330).lineTo(W * 0.02 + 280, base - 330).lineTo(W * 0.02 + 250, base).lineTo(W * 0.02 + 30, base).closePath().fill(0xd6ecf8).stroke(ink);
    g.roundRect(W * 0.02 - 14, base - 360, 308, 40, 16).fill(0xf3f9fd).stroke(ink);
    // cone
    g.poly([W * 0.86, base, W * 0.86 + 70, base - 300, W * 0.86 + 140, base]).fill(0xe8c79a).stroke(ink);
    g.circle(W * 0.86 + 70, base - 320, 62).fill(0xf8d3e1).stroke(ink);
    // stacked ice cubes
    for (let k = 0; k < 3; k++) g.roundRect(W * 0.55 + k * 70, base - 70, 64, 64, 10).fill({ color: 0xe6f6ff, alpha: 0.9 }).stroke(ink);
    g.roundRect(W * 0.55 + 35, base - 136, 64, 64, 10).fill({ color: 0xe6f6ff, alpha: 0.9 }).stroke(ink);
    // no words on the mid layer: labels on two parallax layers slide over each other
    c.addChild(g);
    return c;
  }

  update(camera: Camera, nowMs: number): void {
    const vw = camera.viewW, vh = camera.viewH;
    if (vw !== this.skyW || vh !== this.skyH) {
      this.skyW = vw;
      this.skyH = vh;
      const grad = new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: 0x8fd3f4 }, { offset: 1, color: 0xe3f5fc }], textureSpace: 'local' });
      this.sky.clear().rect(0, 0, vw, vh).fill(grad);
    }
    for (const l of this.layers) {
      // at depth d the layer moves d× as fast as the world, at a proportionally smaller scale
      const s = camera.zoom * (0.55 + 0.45 * l.depth);
      const cx = this.worldW / 2 + (camera.x - this.worldW / 2) * l.depth;
      const cy = this.worldH / 2 + (camera.y - this.worldH / 2) * l.depth;
      l.c.scale.set(s);
      l.c.position.set(vw / 2 - cx * s, vh / 2 - cy * s + (1 - l.depth) * vh * 0.12);
    }
    for (const f of this.flakes) {
      f.y = (f.y + f.v * 16) % 1;
      f.g.position.set(((f.x + Math.sin(nowMs / 1400 + f.phase) * 0.01) % 1) * vw, f.y * vh);
    }
  }
}
