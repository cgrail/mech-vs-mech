# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running

No test suite. Plain ES modules with three.js; runs unbundled straight from the repo (three.js comes from the CDN importmap in [index.html](index.html)). Serve statically (modules and level-file `fetch` don't work from `file://`):

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

Vite is set up for dist builds only — `npm run build` emits `dist/` (`npm run dev` / `npm run preview` also work). [vite.config.js](vite.config.js) copies `levels/` and `assets/` verbatim (they're runtime `fetch`es, invisible to the bundler), strips the CDN importmap from the built HTML (the bundle uses the pinned npm `three`), targets es2022 for `world.js`'s top-level await, and uses `appType: 'mpa'` so the level-probe loop in `flow.js` gets real 404s. Keep the npm `three` version in lockstep with the importmap URL.

Pick a level with a URL param: `?level=2` or `?level=<name>` loads `levels/<name>.txt` (default `level1`).

**Do not run tests through Chrome or any headless browser — the user does all in-browser testing themselves.** Report what should be verified manually instead. Syntax-checking a module is fine:

```bash
node --input-type=module --check < game/systems/ai.js
```

`window.__mech` (player, game, entities) is exposed in [main.js](game/main.js) as a console hook for the user's manual testing — keep it working.

## Architecture

### Boot order — the level loads before everything else

[game/world/world.js](game/world/world.js) has a **top-level await** that fetches and parses the level file. Every other module imports it (directly or via `core/helpers.js`), so by the time any module body runs, `ARENA`, `LEVEL` (spawn points, marker positions), and the terrain grid are populated. Entities are then created **at module scope**: `entities.js` builds the bases and red turrets from `LEVEL` markers on import, `player.js` builds the player. There is no reset logic — restart is `location.reload()` (see `flow.js`), which also preserves the `?level=` param.

### Level files

`levels/*.txt`, one character per 8×8 tile, first row is the enemy (north, −z) end:

- Terrain: `g` ground (y 0) · `l` low (−4) · `h` high (+4) · `w` wall · `r` ramp (auto-slopes between its differing flat neighbors)
- Markers: `P` player spawn · `B` blue base · `R` red base · `T` red turret · `S` enemy wave spawn — a marker sits on the same terrain as the tile to its **left**
- Rows must be equal length; comment lines start with `#`
- The first comment line doubles as the level's menu entry: `# TITLE — player-facing description`. The level-select screen (`flow.js`) probes `level1.txt`, `level2.txt`, … in order (stops at the first gap) and lists title + description; picking one reloads with `?level=N`, and the menu's orbit camera previews that map
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
