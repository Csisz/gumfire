# Putting GUMFIRE online

GUMFIRE has two parts:

- **the game** — static files (`apps/client/dist`): HTML, scripts, art. Any static host works.
- **the relay** — `apps/server`, a small Node program that runs online rooms over a WebSocket
  (`/ws`). It needs a machine that stays on: the NAS, or a small container host.

There are two ways to run them.

## A. Everything on the NAS (one container)

The container serves the game *and* the relay, so nothing else is needed:

```bash
docker compose up -d --build
```

Open `http://<nas>:8787`. For friends outside the home network, put it behind HTTPS (step 1
below) and send them that address.

## B. Game on Vercel, relay on the NAS

### 1. The relay on the NAS, behind HTTPS

A page served over HTTPS (Vercel always is) may only open **secure** WebSockets (`wss://`), so
the relay needs a certificate.

1. In `docker-compose.yml`, allow your Vercel site and start the container:
   ```yaml
   environment:
     ALLOWED_ORIGINS: "https://gumfire.vercel.app"   # your Vercel address(es), comma separated
   ```
   `docker compose up -d --build`
2. Give the NAS a public name with a certificate. On a Synology NAS (DSM 7):
   - a DDNS name (e.g. `yourname.synology.me`): *Control Panel → External Access → DDNS*;
   - a Let's Encrypt certificate for it: *Control Panel → Security → Certificate*;
   - a reverse proxy rule: *Control Panel → Login Portal → Advanced → Reverse Proxy → Create*
     - Source: HTTPS, host `gumfire.yourname.synology.me` (or the DDNS name), port 443
     - Destination: HTTP, `localhost`, port 8787
     - *Custom Header → Create → WebSocket* (adds the Upgrade / Connection headers — without
       them online play connects and immediately drops)
   - on the router, forward port 443 to the NAS.
3. Check from outside: `https://gumfire.yourname.synology.me/health` answers
   `{"ok":true,"rooms":0}`.

### 2. The game on Vercel

1. Push the repository to GitHub and *Add New → Project* on Vercel, importing it. Keep the
   root directory as the repository root: `vercel.json` sets the install and build commands and
   the output folder (`apps/client/dist`).
2. *Settings → Environment Variables*:
   - `VITE_RELAY_URL` = `wss://gumfire.yourname.synology.me/ws` — the relay the Online screen
     uses by default.
   - optional `SITE_URL` = `https://gumfire.vercel.app` — makes link previews (the picture shown
     when you paste the address in a chat) work; Vercel's own production address is used when
     it is not set.
3. Deploy. Redeploy after changing a variable (it is baked in at build time).

Players open the Vercel address → **Online** → create a room → send the 4-letter code.

The server address can still be changed on the Online screen, or with a link:
`https://gumfire.vercel.app/?server=gumfire.yourname.synology.me`.

## Other relay hosts

The same `Dockerfile` runs on Fly.io, Render, Railway and the like (port 8787, health check
`/health`). They give you HTTPS and `wss://` out of the box; set `ALLOWED_ORIGINS` and point
`VITE_RELAY_URL` at `wss://<app>.<host>/ws`. Rooms live in memory, so run **one** instance.

## When online does not work

| Symptom | Cause |
| --- | --- |
| "could not connect" at once, on the Vercel site | `ws://` address from an HTTPS page — the relay needs `wss://` (step 1) |
| connects, then drops within a second | the reverse proxy does not pass WebSockets (the *WebSocket* custom header) |
| refused with 401 in the browser console | the site is not in `ALLOWED_ORIGINS` (exact address, with `https://`, no trailing slash) |
| `/health` works at home but not outside | port 443 is not forwarded to the NAS |
