/**
 * Fixed-timestep driver: turns variable display frames into whole 20 ms sim ticks
 * plus an interpolation factor for rendering (plan §7). Time is injected, so the
 * loop is fully unit-testable and never touches the simulation's determinism.
 */
export interface LoopAdvance {
  /** Number of sim ticks to run this frame. */
  steps: number;
  /** 0..1: how far display time sits between the previous and current sim state. */
  alpha: number;
  /** True if the frame was too long and time was dropped (tab hidden, breakpoint...). */
  dropped: boolean;
}

export class FixedStepLoop {
  private accumulator = 0;
  private last: number | null = null;

  constructor(
    readonly tickMs: number,
    /** Upper bound on ticks per frame, preventing a spiral of death after a stall. */
    readonly maxStepsPerFrame = 5,
  ) {}

  advance(nowMs: number): LoopAdvance {
    if (this.last === null) {
      this.last = nowMs;
      return { steps: 0, alpha: 0, dropped: false };
    }
    const dt = Math.max(0, nowMs - this.last);
    this.last = nowMs;
    this.accumulator += dt;

    let steps = Math.floor(this.accumulator / this.tickMs);
    let dropped = false;
    if (steps > this.maxStepsPerFrame) {
      steps = this.maxStepsPerFrame;
      this.accumulator = 0;
      dropped = true;
    } else {
      this.accumulator -= steps * this.tickMs;
    }
    return { steps, alpha: dropped ? 1 : this.accumulator / this.tickMs, dropped };
  }

  /** Call when resuming from pause so paused time is not replayed. */
  reset(): void {
    this.last = null;
    this.accumulator = 0;
  }
}
