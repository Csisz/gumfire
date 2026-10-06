import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomServer } from './rooms';
import { originAllowed } from './origin';

/**
 * GUMFIRE server (M17): serves the built game (STATIC_DIR) and the online rooms on /ws.
 *   PORT=8787 STATIC_DIR=../client/dist node dist/server.mjs
 * When the game is hosted elsewhere (M20, e.g. Vercel) this is only the relay:
 *   ALLOWED_ORIGINS=https://gumfire.vercel.app  — pages allowed to open /ws (comma separated;
 *   unset or "*" = any). The server's own pages are always allowed.
 */
const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? 'public');
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? '*')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const rooms = new RoomServer();

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end(JSON.stringify({ ok: true, rooms: rooms.roomCount }));
    return;
  }
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(STATIC_DIR, rel || 'index.html');
  if (!file.startsWith(STATIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    // built scripts and art have stable names per release: let browsers keep them a while
    const cache = /[/\\](assets|art)[/\\]/.test(file) ? 'public, max-age=86400' : 'no-cache';
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

const wss = new WebSocketServer({
  server: http,
  path: '/ws',
  maxPayload: 4 * 1024 * 1024,
  verifyClient: (info: { origin?: string; req: { headers: { host?: string } } }) => originAllowed(info.origin, info.req.headers.host, ALLOWED),
});
const alive = new WeakMap<WebSocket, boolean>();
wss.on('connection', (ws) => {
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));
  const h = rooms.connect({ send: (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)), close: () => ws.close() });
  ws.on('message', (data) => {
    let msg: unknown;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    h.message(msg);
  });
  ws.on('close', h.close);
});
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) ws.terminate();
    else {
      alive.set(ws, false);
      ws.ping();
    }
  }
  rooms.sweep();
}, 20_000).unref();

http.listen(PORT, () => console.log(`GUMFIRE server on :${PORT} (static: ${STATIC_DIR}; pages allowed: ${ALLOWED.join(', ') || '*'})`));
