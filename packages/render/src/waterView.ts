import { Container, Graphics } from 'pixi.js';

export interface WaterStyle {
  body: number;
  bodyAlpha: number;
  surface: number;
  foam: number;
  outline: number;
}

/** Hot cocoa (Birthday Aftermath liquid). */
export const COCOA_WATER: WaterStyle = {
  body: 0x6b3b22,
  bodyAlpha: 1,
  surface: 0x8a5230,
  foam: 0xf3dcc6,
  outline: 0x3b2418,
};

/**
 * The deadly liquid below `waterY` (plan §8.7, §9.6). Presentation only: the sim owns the
 * level; this view just draws a band from the level down, with an animated wavy surface.
 * Extends `sideMargin` px beyond the map so it fills the camera's allowed area.
 */
export class WaterView {
  readonly container = new Container();
  private readonly body = new Graphics();
  private readonly surface = new Graphics();
  private levelY: number;

  constructor(
    private readonly worldW: number,
    private readonly worldH: number,
    waterY: number,
    private readonly style: WaterStyle = COCOA_WATER,
    private readonly sideMargin = 400,
    private readonly depthBelow = 400,
  ) {
    this.container.label = 'water';
    this.levelY = waterY;
    this.container.addChild(this.body, this.surface);
    this.redrawBody();
    this.update(0);
  }

  setLevel(waterY: number): void {
    if (waterY === this.levelY) return;
    this.levelY = waterY;
    this.redrawBody();
  }

  /** Animate the surface. `timeMs` is display time (never sim time). */
  update(timeMs: number): void {
    const s = this.style;
    const x0 = -this.sideMargin;
    const x1 = this.worldW + this.sideMargin;
    const y = this.levelY;
    const g = this.surface.clear();
    const step = 16;
    const wave = (x: number) => Math.sin(x * 0.03 + timeMs * 0.002) * 2.5 + Math.sin(x * 0.011 - timeMs * 0.0013) * 1.5;
    g.moveTo(x0, y + 10);
    for (let x = x0; x <= x1; x += step) g.lineTo(x, y + wave(x));
    g.lineTo(x1, y + 10).closePath().fill({ color: s.surface });
    g.moveTo(x0, y + wave(x0));
    for (let x = x0; x <= x1; x += step) g.lineTo(x, y + wave(x));
    g.stroke({ width: 3, color: s.outline });
    for (let x = x0 + 40; x < x1; x += 97) {
      const bob = Math.sin(timeMs * 0.003 + x) * 1.5;
      g.ellipse(x, y + 5 + bob, 9, 2.5).fill({ color: s.foam, alpha: 0.7 });
    }
  }

  private redrawBody(): void {
    const s = this.style;
    this.body
      .clear()
      .rect(-this.sideMargin, this.levelY, this.worldW + 2 * this.sideMargin, this.worldH - this.levelY + this.depthBelow)
      .fill({ color: s.body, alpha: s.bodyAlpha });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
