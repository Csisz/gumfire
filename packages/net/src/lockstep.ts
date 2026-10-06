import type { GameState, SimCommand, TimedCommand } from '@gumfire/sim';
import { isCpuOwner } from './protocol';

/**
 * Client side of lockstep (M17). Holds the match's input log as far as this machine knows it and
 * decides, tick by tick, whether to **play** a frame from the log, **author** the next frame
 * (this player is acting, or this is the host and nobody else is), or **wait** for the network.
 *
 * Every machine computes the author of tick t + 1 from its own state at tick t; the states are
 * identical (determinism), so all agree. The server keeps the log in order and turns down a
 * frame that loses a race (only possible while players drop and rejoin); the loser replays the
 * server's log (`catchup`).
 */
export interface AuthorCtx {
  /** Host player id: authors the quiet ticks and the CPU teams (and teams whose player left). */
  host: string;
  owners: readonly string[];
  connected: (id: string) => boolean;
}

/** The player who authors the tick after this state. */
export function authorOf(s: GameState, ctx: AuthorCtx): string {
  const m = s.match;
  if (m && (m.phase === 'turnActive' || m.phase === 'retreat')) {
    const c = s.characters.find((x) => x.id === s.activeCharacter);
    const o = c ? ctx.owners[c.team] : undefined;
    if (o && !isCpuOwner(o) && ctx.connected(o)) return o;
  }
  return ctx.host;
}

/** The team the host plays for this tick (a CPU or an absent player's team), or −1. */
export function hostPlaysTeam(s: GameState, ctx: AuthorCtx): number {
  const m = s.match;
  if (!m || (m.phase !== 'turnActive' && m.phase !== 'retreat')) return -1;
  const c = s.characters.find((x) => x.id === s.activeCharacter);
  if (!c) return -1;
  const o = ctx.owners[c.team];
  return o && (isCpuOwner(o) || !ctx.connected(o)) ? c.team : -1;
}

export type Decision = 'play' | 'author' | 'wait';

export class Lockstep {
  /** frames[i] is the input of tick i + 1. */
  readonly frames: number[] = [];
  /** Tick-stamped commands, in tick order. */
  readonly cmds: TimedCommand[] = [];
  private cmdAt = 0;
  private out: { from: number; frames: number[]; cmds: TimedCommand[] } | null = null;

  constructor(readonly me: string) {}

  /** Frames from the server. Returns false when they do not continue the log (ask for a catch-up). */
  receive(from: number, frames: readonly number[], cmds: readonly TimedCommand[]): boolean {
    if (from !== this.frames.length + 1) return from + frames.length - 1 <= this.frames.length; // old news is fine
    for (const f of frames) this.frames.push(f);
    for (const c of cmds) this.cmds.push(c);
    return true;
  }

  /** What to do about the tick after `s`. */
  decide(s: GameState, ctx: AuthorCtx): Decision {
    if (this.frames.length > s.tick) return 'play';
    return authorOf(s, ctx) === this.me ? 'author' : 'wait';
  }

  /** How many known frames are waiting to be played. */
  behind(s: GameState): number {
    return this.frames.length - s.tick;
  }

  /** The logged input and commands of the tick after `s`. */
  next(s: GameState): { input: number; cmds: SimCommand[] } {
    const tick = s.tick + 1;
    const cmds: SimCommand[] = [];
    while (this.cmdAt < this.cmds.length && this.cmds[this.cmdAt]!.tick < tick) this.cmdAt++;
    while (this.cmdAt < this.cmds.length && this.cmds[this.cmdAt]!.tick === tick) cmds.push(this.cmds[this.cmdAt++]!.cmd);
    return { input: this.frames[tick - 1] ?? 0, cmds };
  }

  /** A tick this player authored: log it and queue it for sending. */
  record(tick: number, input: number, cmds: readonly SimCommand[]): void {
    if (tick !== this.frames.length + 1) throw new Error(`authored tick ${tick} does not continue the log (${this.frames.length})`);
    this.frames.push(input);
    const timed = cmds.map((cmd) => ({ tick, cmd }));
    for (const c of timed) this.cmds.push(c);
    this.cmdAt = this.cmds.length;
    if (!this.out) this.out = { from: tick, frames: [], cmds: [] };
    this.out.frames.push(input);
    this.out.cmds.push(...timed);
  }

  /** Frames to send since the last call. */
  takeOutbox(): { from: number; frames: number[]; cmds: TimedCommand[] } | null {
    const o = this.out;
    this.out = null;
    return o;
  }
}
