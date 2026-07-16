# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running

No test suite. Plain ES modules with three.js; runs unbundled straight from the repo (three.js comes from the CDN importmap in [index.html](index.html)). Serve statically (modules and level-file `fetch` don't work from `file://`):

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

Multiplayer needs the Node server instead ([server/server.js](server/server.js) — express serving **only the built `dist/`**, plus the WebSocket lobby on `/ws`). `npm start` rebuilds `dist/` first via the `prestart` script, so source edits need a server restart to show up — keep using the python server for quick single-player iteration:

```bash
npm install && npm start      # vite build + http://localhost:8080
```

Vite is set up for dist builds only — `npm run build` emits `dist/` (`npm run dev` / `npm run preview` also work). [vite.config.js](vite.config.js) copies `levels/` and `assets/` verbatim (they're runtime `fetch`es, invisible to the bundler), strips the CDN importmap from the built HTML (the bundle uses the pinned npm `three`), targets es2022 for `world.js`'s top-level await, and uses `appType: 'mpa'` so a missing level file is a real 404 instead of a 200 serving `index.html`. Keep the npm `three` version in lockstep with the importmap URL.

Pick a level with a URL param: `?level=2` or `?level=<name>` (default `level1`). Levels live in the single bundle `levels/levels.txt`; a name not found there falls back to a standalone `levels/<name>.txt` (useful for drafts).

**Do not run tests through Chrome or any headless browser — the user does all in-browser testing themselves.** Report what should be verified manually instead. Syntax-checking a module is fine:

```bash
node --input-type=module --check < game/systems/ai.js
```

`window.__mech` (player, game, entities) is exposed in [main.js](game/main.js) as a console hook for the user's manual testing — keep it working.

## Architecture

### Boot order — the level loads before everything else

[game/world/world.js](game/world/world.js) has a **top-level await** that fetches and parses the level file. Every other module imports it (directly or via `core/helpers.js`), so by the time any module body runs, `ARENA`, `LEVEL` (spawn points, marker positions), and the terrain grid are populated. Entities are then created **at module scope**: `entities.js` builds the bases and red turrets from `LEVEL` markers on import, `player.js` builds the player. There is no reset logic — restart is `location.reload()` (see `flow.js`), which also preserves the `?level=` param.

Multiplayer rides on this: a match is a reload into `?level=…&mp=1` with credentials in `sessionStorage`, so [game/net/net.js](game/net/net.js) can decide `MP` (active, myTeam/enemyTeam) **synchronously at module load** and the module-scope entity creation just branches on it (guest player is red, spawns via `spawnPointFor` at the first `S` marker, no marker turrets in PvP).

### Multiplayer (PvP)

- [server/server.js](server/server.js) is a dumb lobby + relay — it never simulates the game. Lobby: `join`(name)/`challenge`/`challengeResponse`; on accept it mints a match (two tokens, the **challenger's** level) and both clients reload into it, `rejoin` by token, and start on a mutual `ready` → `go` handshake ([game/ui/lobby.js](game/ui/lobby.js) drives all of this UI).
- `net.js` is **import-clean** (no game imports) — anything may import it without cycles. It holds `MP`, the socket, and `netRegistry` (netId → entity; `registerEntity` auto-registers anything with a `netId`).
- Ownership model ([game/systems/remote.js](game/systems/remote.js)): each client simulates only its own side. Opponent entities are replicas (`e.remote = true` — excluded from local AI and from `separateMechs` pushes). Projectiles replicate as `cosmetic` (visuals only); a hit on an opponent entity is sent as `hit` and **applied by its owner** (`projectiles.js` `applyHit`), who echoes authoritative `hp`/`die` back. Win = the enemy base's `die` event; both ends route through the same `killEntity`/`endGame`.
- Keep PvP symmetric: no `applyDifficulty`, fixed salvage trickle, blue-profile turrets and zero turret aim-lead for both teams in MP. Anything difficulty-scaled must stay SP-only (`!MP.active`).

### Level files

All levels are in **one bundle, `levels/levels.txt`** — a `=== <name>` line starts a level, bundle order is play order. `world.js` fetches it once at boot and exports `levels` (`[{ name, text }]`); the level-select menu and next-level flow read from that array, so the whole game makes a single level-related HTTP request. Within a level: one character per 8×8 tile, first row is the enemy (north, −z) end:

- Terrain: `g` ground (y 0) · `l` low (−4) · `h` high (+4) · `w` wall · `r` ramp (auto-slopes between its differing flat neighbors)
- Markers: `P` player spawn · `B` blue base · `R` red base · `T` red turret · `S` enemy wave spawn — a marker sits on the same terrain as the tile to its **left**
- Rows must be equal length; comment lines start with `#`
- A level's first comment line doubles as its menu entry: `# TITLE — player-facing description`. The level-select screen (`flow.js`) builds from the imported `levels` array; picking one reloads with `?level=N` (or `?level=<name>` for non-numeric names), and the menu's orbit camera previews that map. On victory, the next bundle entry is offered as the next level
- Design rule: mechs can step up ramps and drop off ledges, but can never climb a ledge — any `l` region needs an `r` exit or things that drop in are stuck there forever

### Terrain is the single source of truth for physics

`world.js` exports the queries everything else uses; there is no obstacle list:

- `groundHeightAt(x, z)` — walking-surface height (walls return `WALL_H`, ramps interpolate)
- `collideTerrain(pos, r, y)` — pushes a walker's circle out of tiles too tall to step onto (> `STEP` above the ground at the contact edge, not at the walker's center — that distinction is what makes ramps walkable onto plateaus)
- `helpers.losBlocked(ax, ay, az, bx, by, bz)` — 3D line of sight, sampled against `groundHeightAt`; this is what makes a cliff rim block shots downward until the shooter reaches the edge
- Projectiles die when they dip below `groundHeightAt` (`projectiles.js`), so terrain, walls, and cliff sides all stop shots with one check

Walkers (player + mechs) carry `e.y`/`e.vy`; `helpers.updateVertical(e, dt)` glues them to the ground or applies gravity after a ledge drop. `e.group.position.y = e.y + walk bob`, so read heights from `group.position.y`, not a constant 0.

### Vertical aiming is automatic

Nothing manually elevates guns. All shooters (player aim assist in `player.js`, mechs and turrets in `ai.js`) aim at `helpers.aimYOf(target)` and check 3D LOS from their muzzle height. If you add a new weapon, use the same pair or it will shoot over/under targets on other levels.

### Entity model

One flat `entities` array (everything with hp); `kind` is `player | mech | turret | base`, `team` is `blue | red`. `registerEntity` adds to the array + scene and attaches the health-bar sprite. Death/damage flows through `projectiles.js` (`damageEntity`/`killEntity`), which also handles aggro retaliation, salvage rewards, and endgame. All red-side stats come from the difficulty tables in [core/state.js](game/core/state.js) — tune there, not with magic numbers in `ai.js`.

### Frame loop

`main.js` `animate()`: player → waves → per-entity AI → separation → projectiles → particles → HUD/minimap. AI is stateless-ish per frame with per-entity timers (`cool`, `retarget`, `detourT`…) stored on the entity object itself.
