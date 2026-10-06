import type { GameState } from '@gumfire/sim';
import { fork } from './evaluate';
import { planTurn, type AiLevel, type Plan } from './planner';
import type { Step } from './script';

/**
 * Drives one team (M15b). Every tick the client asks `control()` for that tick's input while it
 * is this team's turn; between ticks `think()` advances the search within a time budget. A
 * plan is made from a snapshot taken when the turn hands over control and played back as a
 * script of input frames — nothing else touches the sim, so AI turns replay like human ones.
 */
/** Plans a turn somewhere else (a Web Worker) and resolves with the plan. */
export type RemotePlanner = (state: GameState, level: AiLevel) => Promise<Plan>;

export class AiPlayer {
  private search: Generator<void, Plan> | null = null;
  private pending: Promise<Plan> | null = null;
  private epoch = 0;
  /** When set, plans are made by this (off the main thread) instead of `think()`. */
  remote: RemotePlanner | null = null;
  private plan: Plan | null = null;
  private at = 0;
  private turn = -1;
  private waited = 0;
  /** Last plan (debug / HUD). */
  lastPlan: Plan | null = null;

  constructor(
    readonly team: number,
    readonly level: AiLevel,
    /** Ticks to "think" at least before acting, so the player can follow the turn. */
    readonly minThinkTicks = level === 'easy' ? 60 : level === 'normal' ? 45 : 35,
  ) {}

  /** Is it this AI's character's turn (and may it act)? */
  isMyTurn(s: GameState): boolean {
    const m = s.match;
    if (!m || (m.phase !== 'turnActive' && m.phase !== 'retreat')) return false;
    const c = s.characters.find((x) => x.id === s.activeCharacter);
    return !!c && c.team === this.team;
  }

  /** True while the search is still running. */
  get thinking(): boolean {
    return this.search !== null || this.pending !== null;
  }

  /** Spend up to `budgetMs` on the search (Infinity: finish now — tests, headless). */
  think(budgetMs: number, now: () => number = Date.now): void {
    if (!this.search) return;
    const end = now() + budgetMs;
    for (;;) {
      const r = this.search.next();
      if (r.done) {
        this.plan = r.value;
        this.lastPlan = r.value;
        this.search = null;
        this.at = 0;
        return;
      }
      if (budgetMs !== Infinity && now() >= end) return;
    }
  }

  /** This tick's input and commands. Call once per tick, before stepping the sim. */
  control(s: GameState): Step {
    const m = s.match;
    if (!m || !this.isMyTurn(s)) {
      if (m && m.turn !== this.turn) this.reset();
      return { input: 0 };
    }
    if (m.turn !== this.turn) {
      this.reset();
      this.turn = m.turn;
    }
    if (m.phase !== 'turnActive' && !this.plan) return { input: 0 };
    const me = s.characters.find((c) => c.id === s.activeCharacter)!;
    if (!this.plan && !this.search) {
      // wait until standing still, then plan from a snapshot of this moment
      if (!this.pending) {
        if (me.state !== 'idle' && me.state !== 'walk') return { input: 0 };
        this.waited = 0;
        if (this.remote) {
          const epoch = this.epoch;
          this.pending = this.remote(fork(s), this.level).then(
            (plan) => {
              if (epoch !== this.epoch) return plan; // the turn is over already
              this.plan = plan;
              this.lastPlan = plan;
              this.pending = null;
              this.at = 0;
              return plan;
            },
            () => {
              // the worker failed: think here instead
              if (epoch === this.epoch) {
                this.pending = null;
                this.remote = null;
              }
              return { script: [], score: 0, label: 'wait', outcome: null };
            },
          );
        } else this.search = planTurn(fork(s), this.level);
      }
    }
    this.waited++;
    if (!this.plan || this.waited < this.minThinkTicks) return { input: 0 };
    const st = this.plan.script[this.at];
    if (!st) return { input: 0 };
    this.at++;
    return st;
  }

  private reset(): void {
    this.epoch++;
    this.pending = null;
    this.search = null;
    this.plan = null;
    this.at = 0;
    this.waited = 0;
  }
}
