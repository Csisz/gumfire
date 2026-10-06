import {
  MAX_COMMANDS_PER_TICK,
  TICK_MS,
  createGame,
  hashState,
  runReplay,
  step,
  type GameConfig,
  type GameState,
  type InputFrame,
  type SimCommand,
  type SimEvent,
  type TimedCommand,
} from '@gumfire/sim';
import { FixedStepLoop } from './fixedStepLoop';

/** Per-team match statistics gathered from sim events (results screen). */
export interface TeamStats {
  damageTaken: number;
  lost: number;
  shots: number;
}

/** Per-Gumling statistics for the awards: damage dealt to enemies, knock-outs. */
export interface CharStats {
  dealt: number;
  kills: number;
}

/**
 * One match: the authoritative sim state, the fixed 50 Hz loop and the recording (inputs +
 * commands) that makes every match a replay. The client never mutates `state` directly —
 * player actions become input frames or commands.
 */
export class MatchSession {
  readonly state: GameState;
  readonly loop = new FixedStepLoop(TICK_MS, 5);
  readonly inputs: InputFrame[] = [];
  readonly commands: TimedCommand[] = [];
  private queue: SimCommand[] = [];
  readonly stats: TeamStats[];
  /** Damage and KOs credited to whoever's turn it was (by character id). */
  readonly charStats = new Map<number, CharStats>();
  readonly deaths: Array<{ id: number; reason: 'drowned' | 'lost' | 'hp'; by: number }> = [];
  private actor = 0;
  readonly startedAt = performance.now();
  paused = false;

  /** `from`: start from this state instead of a fresh game (replays that begin mid-match). */
  constructor(
    readonly config: GameConfig,
    from?: GameState,
  ) {
    this.state = from ?? createGame(config);
    this.stats = (this.state.match?.teams ?? []).map(() => ({ damageTaken: 0, lost: 0, shots: 0 }));
  }

  command(c: SimCommand): void {
    this.queue.push(c);
  }

  /** The commands the next `tick()` will apply (online: they go into the shared log). */
  pendingCommands(): SimCommand[] {
    return this.queue.slice(0, MAX_COMMANDS_PER_TICK);
  }

  /** Drop queued commands (online: this player may not act on this tick). */
  clearCommands(): void {
    this.queue.length = 0;
  }

  /** Advance one tick with this frame; returns the tick's events. */
  tick(frame: InputFrame): SimEvent[] {
    const batch = this.queue.splice(0, MAX_COMMANDS_PER_TICK);
    for (const cmd of batch) this.commands.push({ tick: this.state.tick + 1, cmd });
    this.inputs.push(frame);
    const events = step(this.state, frame, batch);
    this.collect(events);
    return events;
  }

  private teamOf(id: number): number {
    return this.state.characters.find((c) => c.id === id)?.team ?? -1;
  }

  /** Side of a character's team (allies share one, M16). */
  private sideOf(id: number): number {
    const t = this.teamOf(id);
    return t >= 0 ? (this.state.match?.teams[t]?.side ?? t) : -1;
  }

  private credit(id: number): CharStats {
    let c = this.charStats.get(id);
    if (!c) {
      c = { dealt: 0, kills: 0 };
      this.charStats.set(id, c);
    }
    return c;
  }

  private collect(events: SimEvent[]): void {
    for (const e of events) {
      const st = (id: number) => this.stats[this.teamOf(id)];
      if (e.type === 'TurnStarted') this.actor = e.id;
      if (e.type === 'CharacterDamaged' && this.actor && this.sideOf(e.id) !== this.sideOf(this.actor)) this.credit(this.actor).dealt += e.amount;
      if (e.type === 'CharacterDied') {
        this.deaths.push({ id: e.id, reason: e.reason, by: this.actor });
        if (this.actor && this.sideOf(e.id) !== this.sideOf(this.actor)) this.credit(this.actor).kills++;
      }
      if (e.type === 'CharacterDamaged') {
        const s = st(e.id);
        if (s) s.damageTaken += e.amount;
      } else if (e.type === 'CharacterDied') {
        const s = st(e.id);
        if (s) s.lost++;
      } else if (e.type === 'ProjectileFired') {
        const s = st(e.owner);
        if (s) s.shots++;
      } else if (e.type === 'MeleeSwing') {
        const s = st(e.id);
        if (s) s.shots++;
      }
    }
  }

  /** Re-run the recording headless and compare hashes (debug: Ctrl+Shift+V). */
  verify(): { ok: boolean; ticks: number } {
    const res = runReplay({ config: this.config, inputs: this.inputs, commands: this.commands });
    return { ok: res.finalHash === hashState(this.state), ticks: this.inputs.length };
  }
}
