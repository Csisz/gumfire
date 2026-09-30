import type { Camera } from './camera.js';

/**
 * Camera priorities (plan §11) — presentation only, never touches the simulation.
 *
 * Each frame the client describes what is happening; the director picks ONE subject by
 * priority and eases the camera towards it:
 *   1. the newest projectile in flight (leading it along its velocity)
 *   2. a recent explosion (held for `blastHoldMs`)
 *   3. the fastest character thrown through the air (> `flyerMinSpeed` px/tick)
 *   4. the active character
 * Dragging the view hands control to the player until something new happens (a shot, a new
 * turn) or the player asks to follow again.
 */
export interface CameraSubject {
  x: number;
  y: number;
}

export interface CameraScene {
  /** Projectiles in flight, oldest first; px and px/tick. */
  projectiles: ReadonlyArray<CameraSubject & { vx: number; vy: number }>;
  /** Airborne characters with their speed in px/tick. */
  flyers: ReadonlyArray<CameraSubject & { speed: number }>;
  active: CameraSubject | null;
}

export interface DirectorOptions {
  blastHoldMs?: number;
  flyerMinSpeed?: number;
  /** Ticks of velocity to lead a projectile by. */
  leadTicks?: number;
  /** Easing time constants, ms. */
  fastTauMs?: number;
  slowTauMs?: number;
}

export type Focus = 'projectile' | 'blast' | 'flyer' | 'active' | 'manual' | 'none';

export class CameraDirector {
  private manual = false;
  private blast: (CameraSubject & { at: number }) | null = null;
  private readonly o: Required<DirectorOptions>;
  focus: Focus = 'none';

  constructor(opts: DirectorOptions = {}) {
    this.o = { blastHoldMs: 800, flyerMinSpeed: 2, leadTicks: 12, fastTauMs: 110, slowTauMs: 260, ...opts };
  }

  /** The player dragged / scrolled the view: stop following until something new happens. */
  takeManual(): void {
    this.manual = true;
  }

  /** Follow again (new turn, a shot, or the player pressed the follow key). */
  release(): void {
    this.manual = false;
  }

  get isManual(): boolean {
    return this.manual;
  }

  explosion(x: number, y: number, nowMs: number): void {
    this.blast = { x, y, at: nowMs };
  }

  /** Pick the subject for this frame (exposed for tests). */
  pick(scene: CameraScene, nowMs: number): { focus: Focus; target: CameraSubject | null } {
    if (this.manual) return { focus: 'manual', target: null };
    const p = scene.projectiles.at(-1);
    if (p) return { focus: 'projectile', target: { x: p.x + p.vx * this.o.leadTicks, y: p.y + p.vy * this.o.leadTicks } };
    if (this.blast && nowMs - this.blast.at < this.o.blastHoldMs) return { focus: 'blast', target: this.blast };
    let best: (CameraSubject & { speed: number }) | null = null;
    for (const f of scene.flyers) if (f.speed > this.o.flyerMinSpeed && (!best || f.speed > best.speed)) best = f;
    if (best) return { focus: 'flyer', target: best };
    if (scene.active) return { focus: 'active', target: scene.active };
    return { focus: 'none', target: null };
  }

  /** Ease `camera` towards the chosen subject. */
  update(camera: Camera, scene: CameraScene, nowMs: number, dtMs: number): void {
    const { focus, target } = this.pick(scene, nowMs);
    this.focus = focus;
    if (!target) return;
    const tau = focus === 'projectile' || focus === 'flyer' ? this.o.fastTauMs : this.o.slowTauMs;
    const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
    camera.centerOn(camera.x + (target.x - camera.x) * k, camera.y + (target.y - camera.y) * k);
  }
}
