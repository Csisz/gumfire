import { describe, expect, it } from 'vitest';
import { Btn, createGame, hashState, step, type GameConfig, type GameState } from '@gumfire/sim';
import { PROPS, WEAPONS } from '@gumfire/content';
import { Lockstep, PROTOCOL, type AuthorCtx, type MatchSpec, type ServerMsg } from '@gumfire/net';
import { RoomServer, type Conn } from '../src/rooms';

/** A client with a mailbox: messages arrive when the test delivers them (network delay). */
class Client {
  inbox: ServerMsg[] = [];
  id = '';
  token = '';
  code = '';
  host = '';
  connected = new Map<string, boolean>();
  s: GameState | null = null;
  ls: Lockstep | null = null;
  match: MatchSpec | null = null;
  h!: { message: (m: unknown) => void; close: () => void };
  resyncs = 0;
  constructor(readonly server: RoomServer) {
    this.open();
  }
  open(): void {
    const conn: Conn = { send: (m) => this.inbox.push(JSON.parse(JSON.stringify(m)) as ServerMsg), close: () => {} };
    this.h = this.server.connect(conn);
  }
  send(m: unknown): void {
    this.h.message(JSON.parse(JSON.stringify(m)));
  }
  deliver(): void {
    const msgs = this.inbox.splice(0);
    for (const m of msgs) {
      if (m.type === 'welcome') {
        this.id = m.you;
        this.token = m.token;
        this.code = m.code;
      } else if (m.type === 'room') {
        this.host = m.host;
        for (const p of m.players) this.connected.set(p.id, p.connected);
      } else if (m.type === 'start') this.begin(m.match, [], []);
      else if (m.type === 'catchup') {
        this.resyncs++;
        this.begin(m.match, m.frames, m.cmds);
      } else if (m.type === 'frames') this.ls!.receive(m.from, m.frames, m.cmds);
    }
  }
  begin(match: MatchSpec, frames: number[], cmds: Parameters<Lockstep['receive']>[2]): void {
    this.match = match;
    this.s = createGame(match.config as GameConfig);
    this.ls = new Lockstep(this.id);
    this.ls.receive(1, frames, cmds);
  }
  ctx(): AuthorCtx {
    return { host: this.host, owners: this.match!.owners, connected: (id) => this.connected.get(id) ?? false };
  }
  /** Advance up to n ticks; authored input = script(tick). */
  run(n: number, script: (tick: number) => number): void {
    if (!this.s || !this.ls) return;
    for (let i = 0; i < n; i++) {
      const d = this.ls.decide(this.s, this.ctx());
      if (d === 'wait') break;
      if (d === 'play') {
        const f = this.ls.next(this.s);
        step(this.s, f.input, f.cmds);
      } else {
        const input = script(this.s.tick + 1);
        this.ls.record(this.s.tick + 1, input, []);
        step(this.s, input, []);
      }
    }
    const out = this.ls.takeOutbox();
    if (out) this.send({ type: 'frames', ...out });
  }
}

const config: GameConfig = {
  seed: 9,
  mapgen: { generator: 'island', seed: 9 },
  weapons: WEAPONS,
  props: PROPS,
  match: { teams: [{ name: 'A', size: 2 }, { name: 'B', size: 2 }], ruleset: { teamSize: 2, turnSeconds: 6, retreatSeconds: 1 } },
};
const script = (t: number) => (t % 200 < 30 ? Btn.Up : t % 200 < 70 ? Btn.Fire : t % 200 < 100 ? Btn.Left : 0);

function lcg(seed: number): () => number {
  let x = seed;
  return () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
}

function setup() {
  const server = new RoomServer(lcg(42));
  const a = new Client(server), b = new Client(server);
  a.send({ type: 'create', name: 'Ann', protocol: PROTOCOL });
  a.deliver();
  b.send({ type: 'join', code: a.code, name: 'Ben', protocol: PROTOCOL });
  a.deliver();
  b.deliver();
  a.send({ type: 'start', match: { config: config as MatchSpec['config'], owners: [a.id, b.id], theme: 'frozen', looks: [] } satisfies MatchSpec });
  a.deliver();
  b.deliver();
  return { server, a, b };
}

describe('online lockstep', () => {
  it('two players over a laggy relay end every tick in the same state', () => {
    const { a, b } = setup();
    expect(a.s && b.s).toBeTruthy();
    for (let round = 0; round < 1500; round++) {
      a.run(3, script);
      b.run(3, script);
      // deliver every other round: messages pile up like a slow network
      if (round % 2 === 0) {
        a.deliver();
        b.deliver();
      }
    }
    a.deliver();
    b.deliver();
    for (let i = 0; i < 50; i++) {
      a.run(50, script);
      b.run(50, script);
      a.deliver();
      b.deliver();
    }
    const t = Math.min(a.s!.tick, b.s!.tick);
    expect(t).toBeGreaterThan(2000);
    expect(a.s!.match!.turn).toBeGreaterThan(3);
    // replay both to the same tick and compare
    const at = (c: Client) => {
      const s = createGame(config);
      const ls = c.ls!;
      for (let k = 0; k < t; k++) {
        const f = ls.frames[k]!;
        step(s, f, []);
      }
      return hashState(s);
    };
    expect(at(a)).toBe(at(b));
    if (a.s!.tick === b.s!.tick) expect(hashState(a.s!)).toBe(hashState(b.s!));
  });

  it('a player who drops is played by the host; coming back catches up from the log', () => {
    const { server, a, b } = setup();
    for (let i = 0; i < 300; i++) {
      a.run(2, script);
      b.run(2, script);
      a.deliver();
      b.deliver();
    }
    b.h.close(); // Ben's connection drops
    a.deliver();
    expect(a.connected.get(b.id)).toBe(false);
    for (let i = 0; i < 400; i++) {
      a.run(3, script); // Ann (host) now authors Ben's team too
      a.deliver();
    }
    expect(a.s!.tick).toBeGreaterThan(1200);
    // Ben comes back with his token
    const b2 = new Client(server);
    b2.send({ type: 'join', code: a.code, name: 'Ben', token: b.token, protocol: PROTOCOL });
    b2.deliver();
    a.deliver();
    expect(b2.id).toBe(b.id);
    expect(b2.ls!.frames.length).toBe(a.ls!.frames.length);
    b2.run(100_000, script); // replays everything it was sent
    a.deliver();
    expect(b2.s!.tick).toBe(a.s!.tick);
    expect(hashState(b2.s!)).toBe(hashState(a.s!));
  });

  it('frames that do not continue the log are turned down with a catch-up', () => {
    const { a, b } = setup();
    a.run(10, script);
    a.deliver();
    b.deliver();
    b.send({ type: 'frames', from: 3, frames: [0, 0], cmds: [] }); // a stale claim
    b.deliver();
    expect(b.resyncs).toBe(1);
    expect(b.ls!.frames.length).toBe(10);
  });

  it('rooms: bad codes, versions and only the host may start', () => {
    const server = new RoomServer(lcg(7));
    const a = new Client(server);
    a.send({ type: 'join', code: 'ZZZZ', name: 'x', protocol: PROTOCOL });
    a.send({ type: 'create', name: 'x', protocol: PROTOCOL + 1 });
    expect(a.inbox.map((m) => (m.type === 'error' ? m.message : m.type))).toEqual(['no room with that code', 'this game version cannot play with this server']);
    a.inbox = [];
    a.send({ type: 'create', name: 'Ann', protocol: PROTOCOL });
    a.deliver();
    const b = new Client(server);
    b.send({ type: 'join', code: a.code.toLowerCase(), name: 'Ben', protocol: PROTOCOL });
    b.deliver();
    b.send({ type: 'start', match: { config, owners: [a.id, b.id], theme: 'frozen', looks: [] } });
    expect(b.inbox.some((m) => m.type === 'error' && /only the host/.test(m.message))).toBe(true);
  });
});

describe('relay origins (M20)', () => {
  it('lets the listed sites and the server’s own pages in', async () => {
    const { originAllowed } = await import('../src/origin');
    const list = ['https://gumfire.vercel.app', '*.example.com'];
    expect(originAllowed('https://gumfire.vercel.app', 'nas.example.org', list)).toBe(true);
    expect(originAllowed('https://evil.app', 'nas.example.org', list)).toBe(false);
    expect(originAllowed('https://play.example.com', 'nas', list)).toBe(true);
    expect(originAllowed('http://nas:8787', 'nas:8787', list)).toBe(true);
    expect(originAllowed(undefined, 'nas', list)).toBe(true);
    expect(originAllowed('https://evil.app', 'nas', ['*'])).toBe(true);
    expect(originAllowed('https://evil.app', 'nas', [])).toBe(true);
  });
});
