import { CODE_ALPHABET, PROTOCOL, isCpuOwner, type ClientMsg, type LobbyInfo, type MatchSpec, type PlayerInfo, type ServerMsg } from '@gumfire/net';
import type { TimedCommand } from '@gumfire/sim';

/**
 * Rooms for online play (M17). Transport-free: a `Conn` is anything that can send a message, so
 * the same code runs behind WebSockets in production and directly in tests. The server keeps the
 * input log in order (first writer wins), relays it, and catches up anyone who joins late.
 */
export interface Conn {
  send(msg: ServerMsg): void;
  close(): void;
}

interface Player {
  id: string;
  name: string;
  token: string;
  conn: Conn | null;
}

export const LIMITS = {
  rooms: 200,
  playersPerRoom: 8,
  framesPerMessage: 600,
  cmdsPerMessage: 600,
  /** About 70 minutes of play. */
  logTicks: 210_000,
  /** Rooms with nobody connected are dropped after this long (ms). */
  idleMs: 10 * 60_000,
  nameLength: 16,
} as const;

class Room {
  readonly players = new Map<string, Player>();
  host = '';
  lobby: LobbyInfo | null = null;
  match: MatchSpec | null = null;
  frames: number[] = [];
  cmds: TimedCommand[] = [];
  hashes = new Map<number, number>();
  desynced = false;
  emptySince = 0;

  constructor(readonly code: string) {}

  info(): ServerMsg {
    const players: PlayerInfo[] = [...this.players.values()].map((p) => ({ id: p.id, name: p.name, connected: !!p.conn }));
    return { type: 'room', code: this.code, host: this.host, players, lobby: this.lobby, started: !!this.match };
  }

  broadcast(msg: ServerMsg, except?: Player): void {
    for (const p of this.players.values()) if (p !== except) p.conn?.send(msg);
  }
}

export class RoomServer {
  private readonly rooms = new Map<string, Room>();
  private nextId = 1;

  constructor(private readonly random: () => number = Math.random) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  private code(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  /** A secret that lets a player take their seat back after a dropped connection. */
  private token(): string {
    if (this.random === Math.random && typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    let t = '';
    for (let i = 0; i < 24; i++) t += Math.floor(this.random() * 36).toString(36);
    return t;
  }

  /** A new connection; returns the handlers for its messages and its closing. */
  connect(conn: Conn): { message: (raw: unknown) => void; close: () => void } {
    let room: Room | null = null;
    let me: Player | null = null;
    const fail = (message: string) => conn.send({ type: 'error', message });
    const cleanName = (n: unknown) => (typeof n === 'string' && n.trim() ? n.trim().slice(0, LIMITS.nameLength) : 'Player');

    const enter = (r: Room, p: Player) => {
      room = r;
      me = p;
      p.conn = conn;
      r.emptySince = 0;
      if (!r.host || !r.players.get(r.host)?.conn) r.host = p.id;
      conn.send({ type: 'welcome', you: p.id, token: p.token, code: r.code });
      r.broadcast(r.info());
      if (r.match) conn.send({ type: 'catchup', match: r.match, frames: r.frames, cmds: r.cmds });
    };

    const message = (raw: unknown) => {
      const msg = raw as ClientMsg;
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return fail('bad message');
      if (!room || !me) {
        if ((msg.type === 'create' || msg.type === 'join') && msg.protocol !== PROTOCOL) return fail('this game version cannot play with this server');
        if (msg.type === 'create') {
          if (this.rooms.size >= LIMITS.rooms) return fail('the server is full, try again later');
          const r = new Room(this.code());
          this.rooms.set(r.code, r);
          const p: Player = { id: `p${this.nextId++}`, name: cleanName(msg.name), token: this.token(), conn };
          r.players.set(p.id, p);
          return enter(r, p);
        }
        if (msg.type === 'join') {
          const r = this.rooms.get(String(msg.code ?? '').toUpperCase().trim());
          if (!r) return fail('no room with that code');
          const back = msg.token ? [...r.players.values()].find((p) => p.token === msg.token) : undefined;
          if (back) {
            back.conn?.close();
            return enter(r, back);
          }
          if (r.players.size >= LIMITS.playersPerRoom) return fail('the room is full');
          const p: Player = { id: `p${this.nextId++}`, name: cleanName(msg.name), token: this.token(), conn };
          r.players.set(p.id, p);
          return enter(r, p);
        }
        return fail('join a room first');
      }
      const r: Room = room, p: Player = me;
      const isHost = r.host === p.id;
      switch (msg.type) {
        case 'lobby':
          if (!isHost || r.match) return;
          r.lobby = msg.lobby;
          r.broadcast(r.info());
          return;
        case 'start': {
          if (!isHost) return fail('only the host can start');
          const m = msg.match;
          if (!m || !Array.isArray(m.owners) || !m.config) return fail('bad match');
          for (const o of m.owners) if (!isCpuOwner(o) && !r.players.has(o)) return fail('a team belongs to somebody who is not here');
          r.match = m;
          r.frames = [];
          r.cmds = [];
          r.hashes.clear();
          r.desynced = false;
          r.broadcast({ type: 'start', match: m });
          r.broadcast(r.info());
          return;
        }
        case 'frames': {
          if (!r.match) return;
          const frames = Array.isArray(msg.frames) ? msg.frames : [];
          const cmds = Array.isArray(msg.cmds) ? msg.cmds : [];
          if (frames.length === 0 || frames.length > LIMITS.framesPerMessage || cmds.length > LIMITS.cmdsPerMessage) return fail('bad frames');
          if (!frames.every((f) => Number.isInteger(f) && f >= 0 && f <= 0xffff)) return fail('bad frames');
          if (msg.from !== r.frames.length + 1) {
            // lost a race (or fell behind): replay the log as the server has it
            conn.send({ type: 'catchup', match: r.match, frames: r.frames, cmds: r.cmds });
            return;
          }
          if (r.frames.length + frames.length > LIMITS.logTicks) return fail('this match has gone on too long');
          const last = msg.from + frames.length - 1;
          const okCmds = cmds.filter((c) => c && Number.isInteger(c.tick) && c.tick >= msg.from && c.tick <= last && c.cmd && typeof c.cmd === 'object');
          r.frames.push(...frames);
          r.cmds.push(...okCmds);
          r.broadcast({ type: 'frames', from: msg.from, frames, cmds: okCmds }, p);
          return;
        }
        case 'hash': {
          if (!r.match || r.desynced || !Number.isInteger(msg.tick)) return;
          const seen = r.hashes.get(msg.tick);
          if (seen === undefined) {
            r.hashes.set(msg.tick, msg.hash >>> 0);
            if (r.hashes.size > 400) r.hashes.delete(r.hashes.keys().next().value!);
          } else if (seen !== msg.hash >>> 0) {
            r.desynced = true;
            r.broadcast({ type: 'desync', tick: msg.tick });
          }
          return;
        }
        case 'resync':
          if (r.match) conn.send({ type: 'catchup', match: r.match, frames: r.frames, cmds: r.cmds });
          return;
        case 'backToLobby':
          if (!isHost) return;
          r.match = null;
          r.frames = [];
          r.cmds = [];
          r.broadcast({ type: 'backToLobby' });
          r.broadcast(r.info());
          return;
        case 'leave':
          r.players.delete(p.id);
          p.conn = null;
          leaveRoom(r, p);
          return;
        default:
          return fail('unknown message');
      }
    };

    const leaveRoom = (r: Room, p: Player) => {
      if (r.host === p.id) {
        const next = [...r.players.values()].find((x) => x.conn && x !== p);
        if (next) r.host = next.id;
      }
      if (![...r.players.values()].some((x) => x.conn)) r.emptySince = Date.now();
      r.broadcast(r.info());
      room = null;
      me = null;
    };

    const close = () => {
      if (room && me) {
        const p: Player = me;
        if (p.conn === conn) p.conn = null;
        leaveRoom(room, p);
      }
    };
    return { message, close };
  }

  /** Drop rooms nobody has been in for a while. */
  sweep(now = Date.now()): void {
    for (const [code, r] of this.rooms) if (r.emptySince && now - r.emptySince > LIMITS.idleMs) this.rooms.delete(code);
  }
}
