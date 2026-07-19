# MECH VS. MECH — Base Strike

A fast, neon-lit 3D mech arena game built with [three.js](https://threejs.org/). Pilot an assault mech, hold the line against endless enemy waves, and destroy the enemy base before yours falls.

![Genre](https://img.shields.io/badge/genre-arcade%20mech%20combat-blue)
![Engine](https://img.shields.io/badge/engine-three.js-black)

## How to Run

For the full game **including multiplayer**, run the Node server — it builds the game (Vite) and serves the bundle alongside the WebSocket lobby:

```bash
npm install
npm start        # builds dist/ → http://localhost:8080
```

Single player needs no build at all — it's plain ES modules with three.js from a CDN, served by any static server (browsers block module imports from `file://`):

```bash
python3 -m http.server 8080
# or
npx serve .
```

Then open [http://localhost:8080](http://localhost:8080), pick a difficulty, and hit **DEPLOY**.

## Multiplayer

Hit **MULTIPLAYER** on the start screen, give yourself a callsign, and enter the lobby. Matches are staged in **rooms**: create one or join one from the list — each room runs its own match, so several groups can fight in parallel on one server. Inside a room, pick a side — **JOIN BLUE** or **JOIN RED**, up to **5 pilots per team** — and once both teams have at least one pilot, anyone on a team can hit **START MATCH**. Everyone in the room drops into the starter's currently selected level (the XL maps at the end of the level list are sized for full 5v5 battles).

It's a symmetric team base assault, from 1v1 up to 5v5: blue deploys around the usual player spawn, red around the enemy end's wave-spawn points. No AI waves, no pre-placed turrets — each pilot earns salvage (fixed +3/s, plus kill bounties for the whole team), builds their own defenses, and the match is won by destroying the other team's base. If you're destroyed you redeploy at your base after a few seconds, so the base is the only thing that decides the match.

To play across machines, friends open `http://<your-ip>:8080` — the game connects its WebSocket to whatever host serves it (or override with `?server=host:port`).

## Deploying to the Internet

The server is hardened for public exposure: strict security headers (CSP and friends), a WebSocket origin check, connection caps (total and per IP), per-socket rate limits, and a payload size cap. Two things it deliberately does **not** do — TLS and process supervision — belong to the platform:

- **Terminate TLS in front of it** (a reverse proxy like [Caddy](https://caddyserver.com/) / nginx, or any PaaS — Fly.io, Railway, Render…). The game requires no code changes for HTTPS: served over `https://`, it connects with `wss://` automatically.
- **Restart on crash** with the platform's supervisor (systemd, Docker `restart: always`, PaaS default).

A complete Caddy setup is two lines — Caddy fetches the certificate and proxies WebSockets out of the box:

```
game.example.com {
    reverse_proxy localhost:8080
}
```

Run the server behind it with `TRUST_PROXY=1 npm start`.

Everything is tuned with optional env vars:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Listen port |
| `HOST` | all interfaces | Listen address — set `127.0.0.1` when a reverse proxy on the same box is the only legitimate client |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy: client IPs are read from `X-Forwarded-For` (for the per-IP cap) and HSTS is sent on HTTPS |
| `ALLOWED_ORIGINS` | — | Extra WebSocket origins, comma-separated (e.g. `https://mygame.github.io`). Same-origin as the served page is always allowed |
| `MAX_CLIENTS` | `200` | Total simultaneous WebSocket connections |
| `MAX_CONNS_PER_IP` | `16` | Connections per client address (a full 10-player match may sit behind one NAT) |

Notes:

- The WebSocket handshake requires a matching `Origin`, so other websites can't drive your lobby from their visitors' browsers. If you serve the game page from a *different* origin than the server (GitHub Pages + `?server=…`, for example), list that page's origin in `ALLOWED_ORIGINS` — and make sure your proxy forwards the original `Host` header (Caddy and nginx's `proxy_set_header Host $host` do).
- The server holds no persistent state and writes nothing to disk — a restart just empties the lobby and any running matches.

### One-command VPS setup

For a dedicated Ubuntu box, [install.sh](install.sh) does all of the above in one go — OS hardening, UFW firewall, a sandboxed systemd unit, and a timer that auto-deploys pushes to `origin/main` within ~5 minutes. It offers two TLS setups:

```bash
sudo DOMAIN=play.example.com EMAIL=you@example.com ./install.sh   # HTTPS on the box: Caddy + Let's Encrypt
sudo DOMAIN=play.example.com,mech.example.org ./install.sh        # …same, on several domains
sudo ./install.sh                                                 # HTTP-only origin behind Cloudflare
```

With `DOMAIN` set, Caddy is installed on the same box, obtains a Let's Encrypt certificate per domain (point a plain, **un-proxied** DNS A/AAAA record at the server for each name first — Caddy retries issuance until the names resolve there), renews them automatically, and proxies to the game server on `127.0.0.1:8080`. `DOMAIN` accepts one or more hostnames, comma- or space-separated. `EMAIL` is optional (certificate expiry notices). Without `DOMAIN`, the origin speaks plain HTTP on port 80, locked to Cloudflare's IP ranges, and Cloudflare (orange-cloud DNS, SSL mode "Flexible") terminates HTTPS.

Instead of the command line, `DOMAIN`/`EMAIL` can live in a `.env` file next to `install.sh` (copy [.env.example](.env.example)) — it's gitignored and survives the auto-update timer. Either way the choice is remembered in `/etc/default/mech-vs-mech`, so re-runs are just `sudo ./install.sh`; `sudo DOMAIN= ./install.sh` (or an empty `DOMAIN=` in `.env`) switches back to Cloudflare mode. Precedence: command line > `.env` > remembered values.

## How to Play

Destroy the red base in the north before the enemy destroys your blue base in the south. Enemy mechs spawn in waves that grow larger and more aggressive over time — you can't kill them forever, so push for the base.

### Controls

| Input | Action |
|---|---|
| **W / A / S / D** | Move (arrow keys also steer and move) |
| **Mouse** | Turn your mech (click the arena to lock the pointer) |
| **Left mouse / Space** | Fire machine guns (hold for sustained fire) |
| **Right mouse / Q** | Fire rocket (slow, heavy damage) |
| **Shift** | Sprint boost |
| **B / T** | Toggle build mode |
| **Left mouse / Space** (in build mode) | Place turret |
| **Right mouse** (in build mode) | Cancel build mode |

Your guns have an arcade-style aim assist: shots snap to the nearest enemy in a narrow cone in front of you, so focus on positioning, not precision.

### Salvage Economy

Salvage 🛢️ is your only resource:

- **+3 per second** passive income (scaled by difficulty)
- **+40** per enemy mech destroyed
- **+80** per enemy turret destroyed
- **−100** per defensive turret you build

Turrets are the backbone of your defense — place them to cover your base and choke points, then use the breathing room to assault the enemy base. Your mech slowly self-repairs after 5 seconds without taking damage, and if you're destroyed, you redeploy at your base after a short delay — but the enemy won't wait.

### Difficulty

| | Easy | Medium | Hard |
|---|---|---|---|
| Enemy accuracy & aim leading | Poor | Leads your movement | Deadly |
| Enemy behavior | Marches straight in | Strafes, flanks | Fast, relentless |
| Wave timing | Every 26s | Every 21s | Every 17s |
| Enemy base HP | 900 | 1200 | 1600 |
| Salvage income | +25% | Normal | −20% |

Your choice is remembered between sessions.

## Project Structure

```
index.html          entry page (importmap + canvas + HUD markup)
style.css           HUD and overlay styling
server/             Node server (express + ws): serves dist/ + lobby + match relay
game/
├── main.js         entry point & game loop
├── core/           game state, math helpers, start/end flow
├── world/          renderer, camera, arena and obstacles
├── entities/       player, enemies, projectiles, particles
├── systems/        enemy AI, build mode, input, sound, multiplayer sync
├── net/            WebSocket client transport + multiplayer session flags
└── ui/             HUD, minimap, messages, multiplayer lobby
```

## Credits

Built with three.js; sound effects are synthesized live with the Web Audio API.

Background music: ["Rocky Musicloop"](https://opengameart.org/content/rocky-musicloop) by johndekale (CC0 / public domain).
