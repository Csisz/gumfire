/**
 * Presentation-only camera (plan §11): world ↔ screen transforms, pan, zoom around a
 * screen point, fit-to-map and clamping. Pure math — no Pixi — so it is unit-tested and
 * each client can move its own camera freely without touching the simulation.
 * Subject following and priorities arrive at M8.
 */
export interface CameraOptions {
  minZoom?: number;
  maxZoom?: number;
  /** World px allowed beyond the left/right map edges. */
  sideMargin?: number;
  /** World px of sky allowed above the map. */
  topMargin?: number;
  /** World px allowed below the map bottom. */
  bottomMargin?: number;
  /**
   * Never zoom out further than the map (plus side margins) fills the view's width — wider
   * screens otherwise see past the water and the backdrop (M10 playtest).
   */
  fillWidth?: boolean;
}

export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export class Camera {
  /** World point at the centre of the screen. */
  x: number;
  y: number;
  zoom = 1;
  viewW = 800;
  viewH = 600;
  readonly minZoom: number;
  readonly maxZoom: number;
  private readonly side: number;
  private readonly top: number;
  private readonly bottom: number;
  private readonly fillWidth: boolean;

  constructor(
    public worldW: number,
    public worldH: number,
    opts: CameraOptions = {},
  ) {
    this.minZoom = opts.minZoom ?? 0.35;
    this.maxZoom = opts.maxZoom ?? 2.5;
    this.side = opts.sideMargin ?? 240;
    this.top = opts.topMargin ?? 480;
    this.bottom = opts.bottomMargin ?? 120;
    this.fillWidth = opts.fillWidth ?? false;
    this.x = worldW / 2;
    this.y = worldH / 2;
  }

  setViewport(w: number, h: number): void {
    this.viewW = Math.max(1, w);
    this.viewH = Math.max(1, h);
    this.zoom = Math.max(this.zoom, this.effectiveMinZoom());
    this.clamp();
  }

  /** The smallest zoom allowed for the current viewport. */
  effectiveMinZoom(): number {
    if (!this.fillWidth) return this.minZoom;
    return Math.min(this.maxZoom, Math.max(this.minZoom, this.viewW / (this.worldW + 2 * this.side)));
  }

  setWorld(w: number, h: number): void {
    this.worldW = w;
    this.worldH = h;
    this.clamp();
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.x + (sx - this.viewW / 2) / this.zoom, y: this.y + (sy - this.viewH / 2) / this.zoom };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom + this.viewW / 2, y: (wy - this.y) * this.zoom + this.viewH / 2 };
  }

  /** Drag the view by a screen-space delta (content follows the pointer). */
  panByScreen(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
  }

  /** Zoom by `factor`, keeping the world point under screen (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.effectiveMinZoom(), this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  /** Show the whole map. */
  fitWorld(): void {
    const z = Math.min(this.viewW / this.worldW, this.viewH / (this.worldH + this.bottom)) * 0.98;
    this.zoom = Math.min(this.maxZoom, Math.max(this.effectiveMinZoom(), z));
    this.x = this.worldW / 2;
    this.y = this.worldH / 2;
    this.clamp();
  }

  centerOn(wx: number, wy: number): void {
    this.x = wx;
    this.y = wy;
    this.clamp();
  }

  /** Keep the view within the map plus margins; centre an axis that fits entirely. */
  clamp(): void {
    const hw = this.viewW / 2 / this.zoom;
    const hh = this.viewH / 2 / this.zoom;
    const minX = -this.side + hw;
    const maxX = this.worldW + this.side - hw;
    this.x = minX > maxX ? this.worldW / 2 : Math.min(maxX, Math.max(minX, this.x));
    const minY = -this.top + hh;
    const maxY = this.worldH + this.bottom - hh;
    this.y = minY > maxY ? (this.worldH + this.bottom - this.top) / 2 : Math.min(maxY, Math.max(minY, this.y));
  }

  transform(): ViewTransform {
    return { scale: this.zoom, x: this.viewW / 2 - this.x * this.zoom, y: this.viewH / 2 - this.y * this.zoom };
  }
}
