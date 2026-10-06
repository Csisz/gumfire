import { PROTOCOL, type ClientMsg, type LobbyInfo, type MatchSpec, type PlayerInfo, type ServerMsg } from '@gumfire/net';
import type { TimedCommand } from '@gumfire/sim';

/**
 * The browser end of online play (M17): one WebSocket to the GUMFIRE server, the room as the
 * server describes it, and automatic reconnection with the seat token (the server then sends the
 * whole log, and the match is replayed up to the present).
 */
export interface OnlineEvents {
  room(): void;
  start(match: MatchSpec): void;
  catchup(match: MatchSpec, frames: number[], cmds: TimedCommand[]): void;
  frames(from: number, frames: number[], cmds: TimedCommand[]): void;
  desync(tick: number): void;
  backToLobby(): void;
  error(message: string): void;
  /** The connection is down (`retrying`: we are trying to get back in). */
  down(retrying: boolean): void;
}

const URL_KEY = 'gumfire.server';
const SEAT_KEY = 'gumfire.seat';

/** Relay address baked in at build time (static hosting such as Vercel: the relay runs elsewhere). */
export const BUILT_IN_SERVER: string = ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_RELAY_URL ?? '').trim();

/**
 * Where the server probably is: a `?server=` link, the last one used, the one this build was
 * made for (VITE_RELAY_URL), or the page's own host when the GUMFIRE server serves the game.
 */
export function defaultServer(): string {
  try {
    const p = new URLSearchParams(window.location.search).get('server');
    if (p) return normaliseServer(p);
  } catch {
    /* no URL */
  }
  try {
    const saved = window.localStorage.getItem(URL_KEY);
    if (saved) return saved;
  } catch {
    /* no storage */
  }
  if (BUILT_IN_SERVER) return normaliseServer(BUILT_IN_SERVER);
  const l = window.location;
  const ws = l.protocol === 'https:' ? 'wss' : 'ws';
  if (l.port === '5174' || l.port === '4173' || l.protocol === 'file:') return `ws://${l.hostname || 'localhost'}:8787/ws`;
  return `${ws}://${l.host}/ws`;
}

/** Accept "gumfire.example.com", "https://…", "wss://…/ws" and make a WebSocket address of it. */
export function normaliseServer(input: string, pageSecure = typeof location !== 'undefined' && location.protocol === 'https:'): string {
  let s = input.trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, 'ws');
  else if (!/^wss?:\/\//i.test(s)) {
    // a bare address: secure unless it is clearly on the home network (and the page allows it)
    const local = /^(localhost|\d+\.\d+\.\d+\.\d+|[^/.]+)(:\d+)?(\/|$)/i.test(s);
    s = `${local && !pageSecure ? 'ws' : 'wss'}://${s}`;
  }
  const u = s.replace(/\/+$/, '');
  return /\/ws$/.test(u) ? u : `${u}/ws`;
}

export class OnlineClient {
  private ws: WebSocket | null = null;
  id = '';
  code = '';
  host = '';
  players: PlayerInfo[] = [];
  lobby: LobbyInfo | null = null;
  started = false;
  private token = '';
  private name = '';
  private url = '';
  private closing = false;
  private retry = 0;

  constructor(private readonly on: OnlineEvents) {}

  get isHost(): boolean {
    return !!this.id && this.id === this.host;
  }

  nameOf(id: string): string {
    return this.players.find((p) => p.id === id)?.name ?? '?';
  }

  isConnected(id: string): boolean {
    return this.players.find((p) => p.id === id)?.connected ?? false;
  }

  /** Create a room (code = null) or join one. */
  connect(url: string, name: string, code: string | null): void {
    url = normaliseServer(url);
    this.url = url;
    this.name = name;
    this.closing = false;
    try {
      window.localStorage.setItem(URL_KEY, url);
    } catch {
      /* no storage */
    }
    let seat: { code: string; token: string } | null;
    try {
      seat = JSON.parse(window.sessionStorage.getItem(SEAT_KEY) ?? 'null') as { code: string; token: string } | null;
    } catch {
      seat = null;
    }
    const token = code && seat && seat.code === code.toUpperCase() ? seat.token : undefined;
    this.open(code ? { type: 'join', code, name, token, protocol: PROTOCOL } : { type: 'create', name, protocol: PROTOCOL });
  }

  private open(first: ClientMsg): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.on.error('That server address does not look right.');
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify(first));
    };
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      this.handle(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closing) return;
      // back in with our seat, if we ever had one
      const canRetry = !!this.code && !!this.token && this.retry < 30;
      this.on.down(canRetry);
      if (canRetry) {
        this.retry++;
        window.setTimeout(() => this.open({ type: 'join', code: this.code, name: this.name, token: this.token, protocol: PROTOCOL }), Math.min(5000, 500 * this.retry));
      }
    };
  }

  private handle(m: ServerMsg): void {
    switch (m.type) {
      case 'welcome':
        this.id = m.you;
        this.token = m.token;
        this.code = m.code;
        try {
          window.sessionStorage.setItem(SEAT_KEY, JSON.stringify({ code: m.code, token: m.token }));
        } catch {
          /* no storage */
        }
        return;
      case 'room':
        this.host = m.host;
        this.players = m.players;
        this.lobby = m.lobby;
        this.started = m.started;
        this.on.room();
        return;
      case 'start':
        this.started = true;
        this.on.start(m.match);
        return;
      case 'catchup':
        this.started = true;
        this.on.catchup(m.match, m.frames, m.cmds);
        return;
      case 'frames':
        this.on.frames(m.from, m.frames, m.cmds);
        return;
      case 'desync':
        this.on.desync(m.tick);
        return;
      case 'backToLobby':
        this.started = false;
        this.on.backToLobby();
        return;
      case 'error':
        this.on.error(m.message);
        return;
    }
  }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  leave(): void {
    this.closing = true;
    this.send({ type: 'leave' });
    this.ws?.close();
    this.ws = null;
    this.id = this.code = this.host = '';
    this.players = [];
    this.started = false;
    try {
      window.sessionStorage.removeItem(SEAT_KEY);
    } catch {
      /* no storage */
    }
  }
}
