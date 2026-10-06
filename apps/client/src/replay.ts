import { createGame, hashState, step, type GameConfig, type GameState, type InputFrame, type SimCommand, type TimedCommand } from '@gumfire/sim';
import type { TeamLook } from './world/worldView';
import type { BackdropTheme } from './world/background';
import { themeOf } from './world/themes';
import type { Piece } from './world/objectMaps';

/**
 * Replay files (M16): a match is its config plus one input frame per tick plus the tick-stamped
 * commands (ADR-005), so a whole match fits in a small JSON file. Inputs and a handmade map's
 * materials are run-length encoded. The file also carries what the viewer needs to *show* the
 * match the same way: theme, team looks, which teams were CPUs.
 */
export const REPLAY_KIND = 'gumfire-replay';

export interface ReplayData {
  config: GameConfig;
  inputs: InputFrame[];
  commands: TimedCommand[];
  theme: BackdropTheme;
  looks: TeamLook[];
  cpu: boolean[];
  /** Objects of an object-built map (drawing only). */
  pieces?: Piece[];
  /** Hash after the last input (0 = unknown). */
  finalHash: number;
  created: string;
}

interface ReplayFile {
  kind: typeof REPLAY_KIND;
  version: 1;
  schema: number;
  created: string;
  theme: BackdropTheme;
  looks: TeamLook[];
  cpu: boolean[];
  pieces?: Piece[];
  config: Omit<GameConfig, 'map'> & { map?: { width: number; height: number; waterY: number; rle: number[] } };
  ticks: number;
  inputs: number[];
  commands: TimedCommand[];
  finalHash: number;
}

export class ReplayError extends Error {}

/** [value, count, value, count, …] */
export function rle(values: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; ) {
    const v = values[i]!;
    let n = 1;
    while (i + n < values.length && values[i + n] === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}

export function unrle(pairs: readonly number[], expected: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const v = pairs[i]!, n = pairs[i + 1]!;
    if (!Number.isInteger(v) || !Number.isInteger(n) || n < 1 || out.length + n > expected) throw new ReplayError('broken run-length data');
    for (let k = 0; k < n; k++) out.push(v);
  }
  if (out.length !== expected) throw new ReplayError('run-length data has the wrong length');
  return out;
}

export function encodeReplay(d: ReplayData, schema: number): string {
  const { map, ...rest } = d.config;
  const file: ReplayFile = {
    kind: REPLAY_KIND,
    version: 1,
    schema,
    created: d.created,
    theme: d.theme,
    looks: d.looks,
    cpu: d.cpu,
    ...(d.pieces?.length ? { pieces: d.pieces } : {}),
    config: { ...rest, ...(map ? { map: { width: map.width, height: map.height, waterY: map.waterY, rle: rle(map.mat) } } : {}) },
    ticks: d.inputs.length,
    inputs: rle(d.inputs),
    commands: d.commands,
    finalHash: d.finalHash,
  };
  return JSON.stringify(file);
}

export function decodeReplay(text: string, schema: number): ReplayData {
  let f: ReplayFile;
  try {
    f = JSON.parse(text) as ReplayFile;
  } catch {
    throw new ReplayError('this is not a GUMFIRE replay file');
  }
  if (!f || f.kind !== REPLAY_KIND || f.version !== 1) throw new ReplayError('this is not a GUMFIRE replay file');
  if (f.schema !== schema) throw new ReplayError(`this replay is from another game version (schema ${f.schema}, this game ${schema})`);
  const { map, ...rest } = f.config;
  const config: GameConfig = { ...rest };
  if (map) config.map = { width: map.width, height: map.height, waterY: map.waterY, mat: Uint8Array.from(unrle(map.rle, map.width * map.height)) };
  return {
    config,
    inputs: unrle(f.inputs, f.ticks),
    commands: f.commands ?? [],
    theme: themeOf(f.theme),
    looks: f.looks,
    cpu: f.cpu ?? [],
    pieces: Array.isArray(f.pieces) ? f.pieces : [],
    finalHash: f.finalHash >>> 0,
    created: f.created,
  };
}

/** Where each turn starts in a recording (for the viewer's turn list and skipping). */
export interface ReplayIndex {
  turns: Array<{ turn: number; tick: number; team: number }>;
  ticks: number;
  /** The recording reproduces the saved final state. */
  verified: boolean;
  /** States at some turn starts (every few turns) to seek backwards quickly. */
  checkpoints: Array<{ tick: number; state: GameState }>;
}

/** Commands for a tick, from a tick-sorted list starting at `from` (returns the next index). */
export function commandsAt(cmds: readonly TimedCommand[], from: number, tick: number, out: SimCommand[]): number {
  let c = from;
  while (c < cmds.length && cmds[c]!.tick < tick) c++;
  while (c < cmds.length && cmds[c]!.tick === tick) out.push(cmds[c++]!.cmd);
  return c;
}

/**
 * Run the whole recording once, headless: turn starts, checkpoints and verification. `start`:
 * the state the recording begins from (a replay of the last turn), default a fresh game.
 */
export function indexReplay(d: ReplayData, fork: (s: GameState) => GameState, checkpointEvery = 4, start?: GameState): ReplayIndex {
  const s = start ? fork(start) : createGame(d.config);
  const turns: ReplayIndex['turns'] = [];
  const checkpoints: ReplayIndex['checkpoints'] = [{ tick: s.tick, state: fork(s) }];
  let c = 0;
  for (const frame of d.inputs) {
    const batch: SimCommand[] = [];
    c = commandsAt(d.commands, c, s.tick + 1, batch);
    const ev = step(s, frame, batch);
    for (const e of ev) {
      if (e.type !== 'TurnStarted') continue;
      turns.push({ turn: e.turn, tick: e.tick, team: e.team });
      if (e.turn % checkpointEvery === 1) checkpoints.push({ tick: s.tick, state: fork(s) });
    }
  }
  return { turns, ticks: d.inputs.length, verified: d.finalHash === 0 || hashState(s) === d.finalHash, checkpoints };
}
