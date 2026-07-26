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

The menus are one column of cards — one decision per card — under a title bar that keeps the way back at the top and over an action bar that keeps **DEPLOY** at the bottom, neither of which scrolls away. The **MAP** card carries the district's own picture, drawn straight from its level file (one pixel per tile), so you can tell the maps apart before you fly one in; **MODE** is a card per mission type; and the settings that are values rather than choices — difficulty, fog of war, touch controls — stay `◂ VALUE ▸` rows in the setup card. The iPhone build ([ios/](ios/)) is laid out the same way.

## Multiplayer

Hit **MULTIPLAYER** on the start screen, give yourself a callsign, and enter the lobby. If someone in the lobby is already flying under that name you get the next one free — `ACE` becomes `ACE 2` — rather than being sent back to the callsign box. Matches are staged in **rooms**: create one or join one from the list — and if there's only one room going and it has space, you walk straight into it — each room runs its own match, so several groups can fight in parallel on one server. Inside a room, pick a side — **JOIN BLUE** or **JOIN RED**, up to **5 pilots per team** — and once both teams have at least one pilot, anyone on a team can hit **START MATCH** — that one press deploys everybody, so the match begins as soon as the last pilot has loaded in. The pilot who **created** the room picks the **MAP** everyone fights on (it starts on the level they had selected; the XL maps at the end of the list are sized for full 5v5 battles) — joiners see the choice in the room and in the room list before they join.

The room's creator also picks the **MODE** — ⚔ BASE ASSAULT or 🚩 CAPTURE THE FLAG — and it travels with the match, so everyone (browser and iPhone alike) fights the same game.

It's a symmetric team base assault, from 1v1 up to 5v5: blue deploys around the usual player spawn, red around the enemy end's wave-spawn points. No AI waves, no pre-placed turrets — each pilot earns salvage (fixed +3/s, plus kill bounties for the whole team), builds their own defenses, and the match is won by destroying the other team's base. If you're destroyed you redeploy at your base after a few seconds, so the base is the only thing that decides the match.

When a match ends, the whole roster rolls straight into a rematch on the next map in the list — **the result screen counts down from 10 seconds and starts it by itself**, so a session keeps going without anyone pressing anything. **▸ NEXT MAP** skips the wait, and **BACK TO LOBBY** is there for anyone who wants out. Either way there's no trip through the lobby and no re-picking teams. If there's nobody left to fight — the other side disconnected, which ends the match anyway — there's no rematch to be had, so the result screen drops NEXT MAP and counts itself back to the lobby in 5 seconds instead.

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

## Map Editor

**MAP EDITOR** on the start screen opens a tile painter for the level format itself — one character per 8×8 tile, the same thing `levels/levels.txt` holds. Pick ground, low ground, high ground, wall, ramp or **chasm** from the palette and paint with the left mouse button (the right button clears back to ground); the marker tools place the player spawn, both bases, red turrets and enemy spawn points. Width and height go from 10 to 64 tiles, and **START FROM…** loads any existing map as a starting point.

- **▶ PLAY** saves the map and flies it in behind the mission menu, ready to deploy.
- **💾 SAVE** keeps it in the browser — it shows up in the level select with a ★, and the game remembers whichever map you last picked.
- **📋 COPY TEXT** copies the finished `=== name` block — paste it at the end of [levels/levels.txt](levels/levels.txt) (and copy that file to `ios/MechVsMech/Resources/`) to make the map part of the game for real.

Editor maps live in your browser only, so they are single player: multiplayer matches are always staged on maps the server itself ships.

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
| **Ctrl** | Jump jets — clears a ledge onto high ground |
| **1 / 2** | Machine guns · rockets |
| **3 / T / B** | Build a turret in front of you |
| **↑ / ↓** (in the menus) | Move the menu cursor |
| **← / →** (in the menus) | Change the highlighted setting |
| **Enter / Space** (in the menus) | Select |

Every one of those keys is a default, not a fixture: **SETTINGS** on the entry screen (or **⌨ KEY BINDINGS** in the mission menu's setup card) lists each control on its own row — press the row, press the key you want, and it is yours from then on, remembered in the browser. Taking a key off another control unbinds it there rather than firing both, and RESET TO DEFAULTS puts the whole layout back. The briefing's control legend and the weapon badges on the HUD name your keys, not the factory ones. The mouse and **Esc** are not in the list — nothing else does their job. (Touch devices have no keyboard to rebind, so the screen isn't offered there; the joystick/gyro choice stays in the setup card.)

On a phone the left thumb is a floating joystick — move and strafe — and the right thumb turns the mech and holds down the machine guns; ⬆️, 🚀 and the turret button do the rest. **Push the stick right forward and the mech runs**: past about 85% of its travel the knob turns gold and you get the same 1.65× sprint the keyboard has on Shift, until you ease off. It's a latch, so a thumb hovering at the line can't stutter between walk and run. On the gyro scheme a hard forward lean does the same thing.

Your guns have an arcade-style aim assist: shots snap to the nearest enemy in a narrow cone in front of you, so focus on positioning, not precision.

### Salvage Economy

Salvage 🛢️ is your only resource:

- **+3 per second** passive income (scaled by difficulty)
- **+40** per enemy mech destroyed
- **+80** per enemy turret destroyed
- **−100** per defensive turret you build

On touch devices the same jump sits on the ⬆️ button next to 🚀 and 🛰️. A jump peaks just under 5 units — enough to clear the 4-unit step between terrain tiers, so high ground is reachable anywhere and a pit is never a trap, but the 10-unit walls around the base compounds still are walls.

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

### Capture the Flag

🚩 **CAPTURE THE FLAG** in the menu swaps the mission: both bases get a flag on a stand in their own courtyard. Walk onto the enemy flag to shoulder it, run it back to your own stand, and **three captures win the district**. Dying drops the flag where you fell — anyone on its team can touch it to send it home instantly, and it goes home by itself after 25 seconds if nobody does. The enemy plays the same game: half of every wave breaks off to raid your courtyard, and the rest hunt whoever is carrying their flag.

Everything else stays: waves keep coming and turrets still cost salvage. What changes is what counts — **only captures win a flag match**. The bases are still there and still destructible, and levelling the enemy's is worth doing (nothing more spawns out of a dead base, so the waves stop), but it will not take the district for you. Flatten it and the match runs on until somebody has three flags.

It works in multiplayer too: the pilot who created the room picks the mode, both teams get a flag in their courtyard, and a runner who makes it home scores for the whole team.

### Chasms

Some districts are split by a **chasm** — tiles with no floor at all. Walk off the lip and you keep falling until your mech is gone (you redeploy at your base like any other death), so bridges become the only way across and the map edge stops being a safe wall: where a rift runs out to the border, you can fall clean off the level. Enemy mechs know better and treat a chasm as a wall, which turns every bridge into a choke point. **THE RIFT** (the last map in the list) is built around one, and the map editor's chasm brush puts them in your own maps.

### Fog of War

🌫️ **FOG OF WAR** in the menu trades the god's-eye view for sensors: night falls over the district, your mech's own lamp is most of the light there is — a cone thrown as far as your sensors reach, swinging where you turn and casting the shadows of everything it finds — and enemy mechs and turrets are only as solid as your sensors' hold on them. Their running lights give them away in the dark before their hulls do. Contact is a strength, not a switch — a mech half behind a wall or right out at the edge of sensor range is a steady half-visible silhouette rather than something blinking on and off, it materialises quickly when it steps into the open, and it dissolves slowly when it breaks contact, so ducking behind a pillar for a moment never makes anyone disappear. When you do lose one, the minimap keeps a hollow blip where you last had it for a few seconds: you lose the mech's position, not the memory of it. An enemy shooting from cover stays hidden — its muzzle flash and tracers only appear once the shot clears the corner, so nothing gives away a mech you can't see. Bases and your own team are always visible. It's a view setting, not a rule: it only ever hides things from you, so it works in multiplayer too — a **YOUR VIEW** card in the lobby room lets each pilot switch their own on or off while the room's creator sets the map and the mode. It's remembered between sessions.

## Look

The district is lit for a filmic pipeline, not a flat one: tone mapping (HDR and a light bloom on iOS) keeps the neon accents, muzzle flashes and base beacons glowing instead of clipping to white, the sky is a dusk gradient that the distance fog melts into, compound walls carry panel seams and rivets, rockets trail exhaust, and a soft vignette frames the middle of the screen. Everything is drawn in one pass — no post-processing stack — so it still runs on a phone.

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
