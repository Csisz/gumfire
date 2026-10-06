import type { GameConfig, TimedCommand } from '@gumfire/sim';

/**
 * Online play (M17), plan §15: deterministic **lockstep by input relay**. The server never runs
 * the game: it keeps rooms, relays input frames and keeps the log so anyone can (re)join by
 * replaying it. Every tick has exactly one *author* — the player whose team is acting (or the
 * host, who authors the quiet ticks between turns and the CPU teams). All messages are JSON.
 */
export const PROTOCOL = 1;

/** A map that travels with the match: a handmade map's materials, run-length coded. */
export interface WireMap {
  width: number;
  height: number;
  waterY: number;
  rle: number[];
}

/** Everything needed to start the same match on every machine. */
export interface MatchSpec {
  config: Omit<GameConfig, 'map'> & { map?: WireMap };
  /** Who plays each team: a player id, or 'cpu:easy' | 'cpu:normal' | 'cpu:hard'. */
  owners: string[];
  /** Presentation (the same for everyone): theme and team looks. */
  /** Theme id (the client's theme registry; unknown ids fall back to the first theme). */
  theme: string;
  looks: Array<{ name: string; colour: number; emblem: string; members: Array<{ name: string; hat: string }> }>;
  /** Objects of an object-built map (drawing only; the map itself travels in `config.map`). */
  pieces?: Array<{ shape: string; x: number; y: number; w: number; h: number; flip: boolean }>;
}

/** Lobby settings the host shares while players gather (shown read-only to the others). */
export interface LobbyInfo {
  summary: string;
  /** Slot names and owners, in team order. */
  slots: Array<{ team: string; colour: number; owner: string; side: number }>;
}

export interface PlayerInfo {
  id: string;
  name: string;
  connected: boolean;
}

export type ClientMsg =
  | { type: 'create'; name: string; protocol: number }
  | { type: 'join'; code: string; name: string; token?: string; protocol: number }
  | { type: 'lobby'; lobby: LobbyInfo }
  | { type: 'start'; match: MatchSpec }
  /** Ticks `from`, `from + 1`, … authored by the sender. */
  | { type: 'frames'; from: number; frames: number[]; cmds: TimedCommand[] }
  | { type: 'hash'; tick: number; hash: number }
  /** This player missed frames (a gap in its log): send the whole log again. */
  | { type: 'resync' }
  | { type: 'backToLobby' }
  | { type: 'leave' };

export type ServerMsg =
  | { type: 'welcome'; you: string; token: string; code: string }
  | { type: 'room'; code: string; host: string; players: PlayerInfo[]; lobby: LobbyInfo | null; started: boolean }
  | { type: 'start'; match: MatchSpec }
  | { type: 'frames'; from: number; frames: number[]; cmds: TimedCommand[] }
  /** The whole log so far: a (re)joining player or one whose frames lost a race replays it. */
  | { type: 'catchup'; match: MatchSpec; frames: number[]; cmds: TimedCommand[] }
  | { type: 'desync'; tick: number }
  | { type: 'backToLobby' }
  | { type: 'error'; message: string };

export const CPU_OWNERS = ['cpu:easy', 'cpu:normal', 'cpu:hard'] as const;
export const isCpuOwner = (o: string) => o.startsWith('cpu:');

/** Room codes: 4 letters without look-alikes. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
