# MECH VS. MECH — Base Strike

A fast, neon-lit 3D mech arena game built with [three.js](https://threejs.org/). Pilot an assault mech, hold the line against endless enemy waves, and destroy the enemy base before yours falls.

![Genre](https://img.shields.io/badge/genre-arcade%20mech%20combat-blue)
![Engine](https://img.shields.io/badge/engine-three.js-black)

## The Story

**Year 2087. The Meridian District.**

The megacity has been carved up by rogue combat AIs left over from the Corporate Wars. What began as automated security systems defending abandoned factory blocks has evolved into something worse: a self-replicating war machine that calls itself **RED FORGE**, churning out mech after mech from its fortified fabrication base at the north end of the district.

The city council tried negotiation. RED FORGE answered with artillery.

You are the last line of defense: a veteran pilot of the **Urban Pacification Division**, strapped into a blue-and-chrome assault walker with police lights still blinking on its shoulders — a relic from the days when this district had laws. Your orders are simple:

> *Defend the southern base. Salvage what you can from the wreckage. And when you've built up enough firepower — march north and burn RED FORGE to the ground.*

Reinforcements are not coming. The turrets you weld together from battlefield scrap are the only backup you'll get.

Good hunting, officer.

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

Hit **MULTIPLAYER** on the menu, give yourself a callsign, and enter the lobby. Every pilot on the server shows up in the list — pick one and **CHALLENGE** them. They get an accept/decline prompt; on accept, both of you drop into the challenger's currently selected level.

It's a symmetric 1-v-1 base assault: the challenger fights for the blue team from the usual spawn, the challenged pilot fights for red from the enemy end. No AI waves, no pre-placed turrets — you earn salvage (fixed +3/s, plus kill bounties), build your own defenses, and win by destroying the other player's base. If you're destroyed you redeploy at your base after a few seconds, so the base is the only thing that decides the match.

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
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy: client IPs are read from `X-Forwarded-For` (for the per-IP cap) and HSTS is sent on HTTPS |
| `ALLOWED_ORIGINS` | — | Extra WebSocket origins, comma-separated (e.g. `https://mygame.github.io`). Same-origin as the served page is always allowed |
| `MAX_CLIENTS` | `200` | Total simultaneous WebSocket connections |
| `MAX_CONNS_PER_IP` | `8` | Connections per client address |

Notes:

- The WebSocket handshake requires a matching `Origin`, so other websites can't drive your lobby from their visitors' browsers. If you serve the game page from a *different* origin than the server (GitHub Pages + `?server=…`, for example), list that page's origin in `ALLOWED_ORIGINS` — and make sure your proxy forwards the original `Host` header (Caddy and nginx's `proxy_set_header Host $host` do).
- The server holds no persistent state and writes nothing to disk — a restart just empties the lobby and any running matches.

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

Your guns have a Future-Cop-style aim assist: shots snap to the nearest enemy in a narrow cone in front of you, so focus on positioning, not precision.

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

An homage to *Future Cop: LAPD* (1998) — the mech, the aim assist, and the base-assault mode are all a loving nod. Built with three.js; sound effects are synthesized live with the Web Audio API.

Background music: ["Rocky Musicloop"](https://opengameart.org/content/rocky-musicloop) by johndekale (CC0 / public domain).
