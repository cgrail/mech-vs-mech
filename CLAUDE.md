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

Levels live in the single bundle `levels/levels.txt`; a name not found there falls back to a standalone `levels/<name>.txt` (useful for drafts). To open one directly, `?level=2` / `?level=<name>` still works as a **one-shot deep link** — see [The address bar holds no state](#the-address-bar-holds-no-state).

**Do not run tests through Chrome or any headless browser — the user does all in-browser testing themselves.** Report what should be verified manually instead. Syntax-checking a module is fine:

```bash
node --input-type=module --check < game/systems/ai.js
```

`window.__mech` (player, game, entities) is exposed in [main.js](game/main.js) as a console hook for the user's manual testing — keep it working.

## Web and iOS must stay in lockstep

[ios/](ios/) is a native Swift/SceneKit port of this same game ([ios/README.md](ios/README.md) has the file-by-file mapping to the JS modules) and it connects to **the same lobby server**, so web and iOS players share rooms and land in the same match. Treat them as one product: gameplay rules, the difficulty tables ([core/state.js](game/core/state.js) ↔ `Engine/State.swift`), relay message shapes and the ownership model all have to change on both sides in the same commit, or the two builds disagree mid-match.

**Levels are the sharpest edge.** [ios/MechVsMech/Resources/levels.txt](ios/MechVsMech/Resources/levels.txt) is a verbatim copy of [levels/levels.txt](levels/levels.txt) — no build step copies it — so every level edit ends with:

```bash
cp levels/levels.txt ios/MechVsMech/Resources/levels.txt
```

(Same deal for [assets/](assets/) → `ios/MechVsMech/Resources/`.)

Why it can't be skipped: a match travels as a level *param*, and each client resolves it against whatever bundle it has. A level the iOS bundle doesn't have won't announce itself — `resolveLevel` in [ios/MechVsMech/AppModel.swift](ios/MechVsMech/AppModel.swift) silently falls back to whatever level that player last had selected, so they deploy onto a *different map* inside a shared match: wrong terrain, wrong spawns, replicas walking through walls. The browser fails louder (an unknown name 404s on the `levels/<name>.txt` fallback fetch) but is just as broken.

**Multiplayer no longer trusts the iOS copy**, because a phone can be running an App Store build older than the deployed web game. Two routes beside the static files in [server/server.js](server/server.js) close that gap, both answering out of the *deployed* `dist/levels/levels.txt`: `GET /levels` is the map list the lobby's picker offers, and `GET /level/<param>` returns one level's text, which iOS fetches at match boot and plays instead of its own copy (falling back to the bundle only if the server can't be reached). Browsers need neither: they already load the bundle from that same server. So a stale copy no longer splits a match across two maps — but it still decides what single player, the level-select menu and the map preview show. Copy it anyway.

Copy, don't merge: numeric levels travel as `?level=N`, which the **web resolves by name** (the level called `levelN`), the `/level/<param>` route likewise, while **iOS's offline fallback resolves by position** (the N-th entry of its bundle). Those agree only while the two files are identical and bundle order still matches the level numbering — so append new levels at the end, and never reorder, renumber, or hand-edit one copy alone.

## Architecture

### The address bar holds no state

**Nothing in the game ever writes a URL parameter.** Every setting the player picks (map, difficulty, mode, fog of war, controls, callsign) lives in `localStorage`; everything a *reload* has to carry to the next page load goes through the **boot handoff** in [game/core/boot.js](game/core/boot.js).

The handoff is one `sessionStorage` key, `mechBoot`, holding `{ screen, level, match }`. `bootReload(next)` writes it and reloads; the inline script at the top of [index.html](index.html) reads it **exactly once**, deletes it, and parks it on `window.__mechBoot` before any module runs (so `world.js` can pick a map and `net.js` can decide `MP` synchronously at module scope). The three fields:

- `screen` — `'menu'` (redeploy / next level, skipping the mode select) · `'match'` (booting into a multiplayer match) · `'lobby'` (coming back out of one). The same inline script unhides that screen pre-paint; `flow.js` and `lobby.js` read `BOOT.screen` again once they are up.
- `level` — the map to build. Absent, `world.js` falls back to `localStorage.mechLevel`, the map the level select last landed on (`rememberLevel`).
- `match` — the multiplayer credentials `net.js` used to read out of `?mp=1` plus a second sessionStorage key.

**Consumed once is the entire point**: a *manual* refresh finds nothing left and always starts on the entry screen (the mode select), on the remembered map. It cannot resume a match, and no state survives in a copied link. Consequences worth keeping in mind:

- Refreshing mid-match **leaves** the match rather than rejoining it. The server's rejoin-by-token path still exists and is what the match-boot reload itself uses.
- `?level=` is still honoured on the *first* load as a deep link: the inline script folds it into the boot object and then **strips `level` and `mp` out of the address bar** with `replaceState`. `?server=` is deliberately left alone — it is deployment config, not game state, and it has to survive every reload.
- Because there is no address bar to correct any more, a *remembered* map that has gone missing (a deleted editor map) must not brick the game — `world.js` falls back to the first district for that case only, and the fatal-error overlay's RESET & RELOAD clears `mechLevel`. A map handed over by a reload or a deep link still fails loudly, since that is a real mismatch.

### Menus are one column, and every row is the same size

The overlay screens are a 90s console option list, and the layout rule is not cosmetic — it is what makes them survive a small screen. **A menu grows down, never across.** `#overlay` scrolls vertically, so height is free; width is not, and a row that overflows has nowhere to go. Concretely:

- One vertical column, `min(430px, 92vw)` wide — the same width for the option rows, the level list, the mode-select buttons, DEPLOY and the lobby's room rows, so the whole overlay reads as one stack.
- **Never more than three controls in a row.** A setting is one row: `LABEL · VALUE` between `◂ ▸` steppers, cycling through its values ([game/ui/menu.js](game/ui/menu.js) `addOption`, `OptionRow` in `UI/Styles.swift`). One button per value is what used to overflow — four difficulty pills abreast, and a mode row that grew every time a mode was added. Adding a setting adds a row, which costs nothing.
- Every row is the same height (`--optH` / `OPT_H`) and squared off (2px radius). The small-screen media query shrinks the **height** and the type, never the width.

Keyboard navigation falls out of the same structure: **selection is DOM focus**, so the keyboard, the mouse and touch can never disagree about what is highlighted. `↑ ↓` walk the visible screen's controls (steppers are skipped — they are what `← →` drive), `← →` press the focused row's own steppers, `Enter`/`Space` is the browser's own button activation. A `MutationObserver` on `.screen` class changes focuses the first row of whatever screen just opened, so every path in (flow.js, lobby.js, editor.js) gets it without calling in. The highlight styles `:focus`, deliberately not `:focus-visible`: that focus is moved programmatically, and a menu cursor that is sometimes not drawn is worse than one that lingers after a click.

### Boot order — the level loads before everything else

[game/world/world.js](game/world/world.js) has a **top-level await** that fetches and parses the level file. Every other module imports it (directly or via `core/helpers.js`), so by the time any module body runs, `ARENA`, `LEVEL` (spawn points, marker positions), and the terrain grid are populated. Entities are then created **at module scope**: `entities.js` builds the bases and red turrets from `LEVEL` markers on import, `player.js` builds the player. There is no reset logic — restart is a reload (`bootReload` in `flow.js`), which hands the map and the screen to open on to the next load.

The **one** exception is changing which *map* is on screen, which happens without a reload — [game/core/mapswitch.js](game/core/mapswitch.js) `switchMap(name)` is the single path, used both by the level select and by the lobby to show a room's map. It flies the old map out (`scene.position.y`, the camera isn't in the scene), calls `rebuildWorld` (world.js) to re-parse into the same `LEVEL`/`ARENA`/grid and swap the terrain group, moves the bases, marker turrets and player mech onto the new ground, then flies the new map in. `levelName` is an exported **`let`** that `rebuildWorld` moves along — importers read it as a live binding, so treat it as "the map right now", not a boot constant.

This is a map swap, not a game reset: it is only safe from the `menu` state, and every path out of a finished game still reloads. Two things ride on it — the level select calls `rememberLevel` so `localStorage.mechLevel` follows the map on screen (REDEPLOY reloads with that map in the handoff), while the lobby deliberately does not (the room's map is server state; a refresh drops you back on your own map). If you add module-scope state derived from `LEVEL`, either derive it live or reset it in `switchMap`.

Multiplayer rides on this: a match is a reload whose boot handoff carries the map and the credentials (matchId, token, playerId, team, roster), so [game/net/net.js](game/net/net.js) can decide `MP` (active, playerId, myTeam/enemyTeam, roster) **synchronously at module load** and the module-scope entity creation just branches on it (blue players fan out around the `P` marker, red players rotate through the `S` markers — `spawnPointFor(team, idx)` with `teamIndexOf` — no marker turrets in PvP).

### Multiplayer (team PvP, up to 5v5)

- [server/server.js](server/server.js) is a dumb lobby + relay — it never simulates the game. It's hardened for internet deployment (CSP + security headers, WS origin check, connection caps, rate limits, 4 KB `maxPayload`) with env knobs `TRUST_PROXY`, `ALLOWED_ORIGINS`, `MAX_CLIENTS`, `MAX_CONNS_PER_IP` — see the README's deployment section. TLS termination and restarts belong to the platform, not the server. The CSP inline-script hashes are computed from `dist/index.html` at startup, so new inline scripts in [index.html](index.html) keep working — but any new *external* resource (CDN script, remote font) needs a CSP update. Lobby: `join`(name) → `createRoom`/`joinRoom` (matches are staged per room, so several run in parallel; empty rooms are deleted) → `setLevel` / `setMode` (the room's **creator** picks the map and the mode — assault or ctf; the server holds both on the room, validates the map against its own bundle, and hands the room to the longest-standing member if the owner leaves) → `team`(blue/red/null, max 5 per side per room) → `startMatch` (anyone on a team in the room, once both sides have ≥1 pilot); the server mints a match from that room's teams (one token per player, the **room's** map and mode — not the starter's) and every rostered client reloads into it, `rejoin`s by token, and starts on an all-ready `ready` → `go` handshake ([game/ui/lobby.js](game/ui/lobby.js) drives all of this UI). A pre-start sweep forfeits slots that never reconnect so the handshake can't deadlock. When a match ends, `nextMatch` (the end screen's NEXT MAP) mints a **follow-up match from the finished one**: same roster minus whoever already left, next map in the server's bundle order, new tokens, delivered as a `matchStart` over the *finished* match's still-open sockets — so a rematch needs no lobby round trip. The first request mints it (`match.next`), later ones re-send it — which is what makes the **10-second countdown** on the end screen safe: every client fires `nextMatch` at roughly the same moment and they all land in the one match the first request created. Nobody has to press anything to keep a session going; the button is for whoever wants it sooner and BACK TO LOBBY for whoever wants out. `relay` messages fan out to every other player in the match, **stamped server-side with the sender's `from` playerId** — clients trust `from`, never a sender id inside the payload.
- `net.js` is **import-clean** (its only import is `core/boot.js`, which imports nothing) — anything may import it without cycles. It holds `MP`, the socket, and `netRegistry` (netId → entity; `registerEntity` auto-registers anything with a `netId`).
- Ownership model ([game/systems/remote.js](game/systems/remote.js)): ownership is **per player**, not per team — `e.owner` is the simulating client's playerId (netIds: `player:<pid>`, `t:<pid>:<n>`). Each client simulates only what it owns; everyone else's entities (teammates included) are replicas (`e.remote = true` — excluded from local AI and from `separateMechs` pushes). Projectiles replicate as `cosmetic` (visuals only); a hit on another player's entity is sent as `hit` and **applied only by its owner** (`projectiles.js` `applyHit`), who echoes authoritative `hp`/`die` to everyone. **Bases are shared and unowned**: the shooter applies base damage locally and broadcasts `bhit`, which every other client mirrors — hp converges because each client applies each `bhit` exactly once, and every client detects the base death (→ `killEntity`/`endGame`) on its own.
- Keep PvP symmetric: no `applyDifficulty`, fixed salvage trickle, blue-profile turrets and zero turret aim-lead for both teams in MP. Kill bounties pay out on every enemy-team client (team-wide, still symmetric). Anything difficulty-scaled must stay SP-only (`!MP.active`).

### Level files

All levels are in **one bundle, `levels/levels.txt`** — a `=== <name>` line starts a level, bundle order is play order. `world.js` fetches it once at boot and exports `levels` (`[{ name, text }]`); the level-select menu and next-level flow read from that array, so the whole game makes a single level-related HTTP request. Within a level: one character per 8×8 tile, first row is the enemy (north, −z) end:

- Terrain: `g` ground (y 0) · `l` low (−4) · `h` high (+4) · `w` wall · `r` ramp (auto-slopes between its differing flat neighbors) · `v` chasm (**no floor at all**)
- Markers: `P` player spawn · `B` blue base · `R` red base · `T` red turret · `S` enemy wave spawn — a marker sits on the same terrain as the tile to its **left**
- Rows must be equal length; comment lines start with `#`
- A level's first comment line doubles as its menu entry: `# TITLE — player-facing description`. The level-select screen (`flow.js`) builds from the imported `levels` array; picking one flies the chosen map in without a reload (`switchMap`, above) and remembers it in `localStorage`, and the menu's orbit camera previews that map. On victory, the next bundle entry is offered as the next level
- `v` is the one tile with nothing to stand on: `groundHeightAt` returns `VOID_H` (−1000), so `collideTerrain` never pushes anything out of it, walkers fall through and die past `FALL_DEATH_Y`, and shots fly across it. Four things follow from that and must stay in step — a level containing one **skips the single ground plane** and builds its lowest tier from merged tile rects instead (`hasVoid` in `createWorld` / `buildWorld`), the AI probe `freeDist` treats a chasm under *any* part of the mech as a wall (they walk off ledges happily, but this one has no bottom), a flag dropped over one goes home instead of being lost, and turret building already refuses it (the footing check compares heights). Levels can run a chasm out to the map border, which is how a player falls *off the level* — level59 does exactly that
- Design rule: AI mechs can step up ramps and drop off ledges, but can never climb a ledge — any `l` region needs an `r` exit or the mechs that drop in are stuck there forever. (Players can jump a tier since jump jets landed, so a pit is not a *player* trap — keep the ramps anyway, the AI has no jump)
- The `S` markers double as red-team spawn points in multiplayer (blue fans out around `P`), so maps meant for 5v5 should carry ~5 spread-out `S` markers — the XL maps at the end of the bundle (level53+) are built that way, growing to 55×71 tiles at level58
- `npm run check-levels` ([tools/check-levels.mjs](tools/check-levels.mjs)) re-implements the parse and the walk rules (`STEP` climbs, free drops, `JUMP_REACH` jumps) off-line and flood-fills the map: it reports markers that ended up in a wall, anything unreachable from the player spawn, and **one-way traps** (walkable into, not back out of). Run it after every level edit — both trap classes below are invisible to the eye
- The bundle is shared with the iOS port and mismatches break cross-play — after editing it, copy it over as described in [Web and iOS must stay in lockstep](#web-and-ios-must-stay-in-lockstep)

#### The map editor writes this same format

[game/ui/editor.js](game/ui/editor.js) (MAP EDITOR on the mode screen, web only) paints the character grid directly — the level file *is* its document model. Two things it hooks into:

- `validateLevel(text, name)` in `world.js` is every check `parseLevel` makes, hoisted out and made pure, so a draft is rejected with the same messages a broken bundle entry gets and is never half-loaded. `parseLevel` calls it first and only then touches `LEVEL`/`ARENA`/`cells`.
- Saved maps go to `localStorage` (`mechUserLevels`) and are appended to the exported `levels` array at boot with `user: true`, so the level select, `switchMap` and the next-level flow treat them like bundle maps. `lobby.js` filters `user` maps *out* of the map picker: the server serves its own bundle, so a match can never be staged on a map only one player has. COPY TEXT emits the `=== name` block to paste into `levels/levels.txt` (then copy to iOS) — that is the only way an editor map becomes real for multiplayer and for the iOS build.

Because the list can change while the menu is up, `flow.js` **rebuilds** the level-select list on the `mech:levelchanged` event rather than only re-marking it.

#### Base compounds

Both bases sit in an identical walled fort so that **a base can only be shot from inside its own courtyard** — no sniping it across the map. Written relative to the base tile, with `dr` running toward the enemy:

```
dr −2   w w w w w w w w w   map border, doubles as the back wall
dr −1   w . . . . . . . w   courtyard
dr  0   w . . . B . . . w   courtyard (base)
dr +1   w . . . . . . . w   courtyard
dr +2   w . . . . . . . w   courtyard
dr +3   w . . w w w . . w   inner screen — walk-through slots at dc ±2/±3
dr +4   w . . . . . . . w   antechamber
dr +5   w w w . . . w w w   outer wall, 3-tile gate on the base's axis
```

The screen and the gate are deliberately offset from each other: a shot lined up through a screen slot runs into the side wall, one lined up through the gate runs into the screen. Three measurements drive the rest of the geometry:

- The base platform is **16 units across** — a full tile either side of centre — so it already spills half way into its neighbouring tiles. It takes **two** clear rows in front (12 units of daylight) before the screen stops reading as part of the building; with one it still looks embedded. The back is the map border and only clears the platform by 4 units — the base marker would have to move a row inward to fix that.
- The base's `hitRadius` is **9.5**, wider than a tile, so the screen slots have to be ≥2 tiles off-axis; a 1-tile offset still lets a bullet clip the base on its way past.
- The whole footprint is levelled to the base's own tier, because a ramp or tier change caught inside the walls becomes a step nothing can climb. Where that cuts a plateau, the gate row gets a ramp causeway and up to two ramps per side are re-cut outside the walls.

Keep `T` markers out of the gate and the screen slots — a turret's collision circle would plug them — and `S` markers outside the fort entirely, or a wave deploys into its own courtyard and files out through the slots one mech at a time.

Consequences to preserve when editing maps: the fort needs a ramp up to its gate if it stands on a plateau (see level6, where the gate tiles themselves are the ramp), the blue `P` marker lives in the blue antechamber, and mid-field cover blocks are placed in mirrored pairs with ≥2 tiles between them so mechs — which wall-follow rather than pathfind — always have a lane.

Two traps worth knowing, both found by validating rather than by eye: the side walls can fence a flank corridor off against a plateau nobody can climb, making a pit you fall into and never leave, so **check reachability in both directions** (a plain flood fill from `P` will not see it, because ledge drops are one-way); and when clearing a marker off a tile, backfill with the terrain that was actually there, since a stray `g` on an `h` plateau is exactly such a pit.

### Game modes

`game.mode` ([core/state.js](game/core/state.js), the `MODES` table) is `assault` (the original: waves + kill the enemy base) or `ctf`. It is a **single-player menu choice** (`#modeRow`, remembered in `localStorage`); in multiplayer it comes from the match credentials (`MP.mode`), so a match plays its room's mode and the menu row is hidden.

[systems/ctf.js](game/systems/ctf.js) is the whole of capture the flag. Nothing about it is level data: each flag's stand is **derived from the base marker**, 13 units toward the enemy base — clear of the base's 9.5 hitRadius and its 16-unit platform, short of the compound's inner screen, so a flag always sits in its own courtyard and stealing it means walking into the fort. `tools/check-levels.mjs` re-derives both stands and asserts they are walkable and reachable on every map.

- A flag is **not an entity** (nothing can shoot it, so it has no hp and never enters `entities`) but it is *shaped* like one — `kind: 'flag'`, `team`, `alive`, `group`, `hitRadius` — so `ai.js` can steer at it with the code it uses for a base. `f.stand` is a second such object marking home. Flag targets are walked onto, not shot at: `attackRange` drops to 3 and the fire block is skipped for `kind === 'flag'`
- Rules: touch the enemy flag to carry it, reach your own stand to score (whether or not your own flag is home — arcade rules, no stalling), dying drops it, touching your own dropped flag returns it, and an untouched drop goes home after 25 s. `CAPTURES_TO_WIN` captures win — base destruction still ends a match too, so the modes stack rather than replace each other
- Multiplayer: flags are **shared and unowned like the bases**. Only the client that simulates a mech reports what it did with a flag (`fgrab`/`fdrop`/`fret`/`fcap`), everyone else mirrors it; the capture message carries the absolute score so a dropped packet can't leave the sides disagreeing. The return-home countdown needs no message — every client runs it off the same drop event
- Single-player AI: `ctfGoal(e)` decides what a red mech wants (carry it home > hunt whoever took ours > fetch theirs if it is a `flagRunner` > recover ours if it is loose). `updateWaves` marks every other mech of a wave a runner, so a wave never abandons the fight entirely

### Terrain is the single source of truth for physics

`world.js` exports the queries everything else uses; there is no obstacle list:

- `groundHeightAt(x, z)` — walking-surface height (walls return `WALL_H`, ramps interpolate)
- `collideTerrain(pos, r, y)` — pushes a walker's circle out of tiles too tall to step onto (> `STEP` above the ground at the contact edge, not at the walker's center — that distinction is what makes ramps walkable onto plateaus)
- `helpers.losBlocked(ax, ay, az, bx, by, bz)` — 3D line of sight, sampled against `groundHeightAt`; this is what makes a cliff rim block shots downward until the shooter reaches the edge
- Projectiles die when they dip below `groundHeightAt` (`projectiles.js`), so terrain, walls, and cliff sides all stop shots with one check

Walkers (player + mechs) carry `e.y`/`e.vy`; `helpers.updateVertical(e, dt)` glues them to the ground or applies gravity after a ledge drop — except while `e.vy > 0`, which is a jump on its way up and must not be glued back down. `e.group.position.y = e.y + walk bob`, so read heights from `group.position.y`, not a constant 0.

**Jump jets** (player only — `jump()` in `player.js` / `Player.swift`, Ctrl or the ⬆ button) are the one thing that beats a ledge: `JUMP_V`/`GRAVITY` in `helpers.js` peak at 4.84 units, just over the 4-unit tier step and far under `WALL_H`. Nothing else was needed to make it work — `collideTerrain` already tests the *walker's* height, so a tier stops blocking once the jump is above it, and multiplayer already replicates `y`.

### The look is tone-mapped, not lit brighter

[world/scene.js](game/world/scene.js) ↔ `GameEngine.swift`'s camera setup are one decision made twice: the web renderer runs **ACES filmic tone mapping** at `toneMappingExposure` 1.25, SceneKit runs `wantsHDR` with a restrained bloom. Both roll the top end off, which is why the lights look over-bright on paper (hemisphere 1.15, sun 2.1) — **change the lights and the tone mapping together, or the district goes flat/blown out**. Anything that must stay hot despite tone mapping (tracers, sparks, muzzle flashes) sets `toneMapped: false`.

Two more pieces of the look are shared: the sky is a vertical gradient drawn behind everything (a plain background texture, so it costs one quad and never moves when a map switch flies the scene), and `scene.fog` takes that gradient's **horizon colour** so distant terrain melts into it. Muzzle flashes come out of a fixed ring of 28 sprites/billboards (`spawnFlash`) — a dozen shooters at several shots a second must not allocate. The vignette is pure CSS (`#hud.active::before`) / a SwiftUI gradient, never a render pass.

### Vertical aiming is automatic

Nothing manually elevates guns. All shooters (player aim assist in `player.js`, mechs and turrets in `ai.js`) aim at `helpers.aimYOf(target)` and check 3D LOS from their muzzle height. If you add a new weapon, use the same pair or it will shoot over/under targets on other levels.

### Entity model

One flat `entities` array (everything with hp); `kind` is `player | mech | turret | base`, `team` is `blue | red`. `registerEntity` adds to the array + scene and attaches the health-bar sprite. Death/damage flows through `projectiles.js` (`damageEntity`/`killEntity`), which also handles aggro retaliation, salvage rewards, and endgame. All red-side stats come from the difficulty tables in [core/state.js](game/core/state.js) — tune there, not with magic numbers in `ai.js`.

### Frame loop

`main.js` `animate()`: player → waves → per-entity AI → separation → projectiles → particles → HUD/minimap. AI is stateless-ish per frame with per-entity timers (`cool`, `retarget`, `detourT`…) stored on the entity object itself.

`systems/vision.js` (`Engine/Vision.swift`) is the optional fog of war: with `game.fogOfWar` on it tightens the render fog and hides enemy mechs/turrets that are out of sensor range or out of line of sight, marking each with `e.seen` (the minimap reads it). It is a **local view setting** — never sent over the wire, never affecting simulation — which is why it is allowed in PvP where difficulty scaling is not.

Two rules stop it reading as a glitch rather than as fog, and both have to hold on either side of a new feature:

- **Contact is faded, not switched.** The line-of-sight sweep is the expensive part, so it runs on its own budget (`TICK`) while the fade (`FADE`) runs every frame — which is also what hides the sweep's coarseness. Web sets `opacity` per material (models build their own, so it is safe per entity) and only turns `transparent` on *while* a fade runs; iOS just sets `node.opacity`, which cascades. An entity created between two sweeps has no verdict yet: teammates and bases default visible, enemies default hidden, so nothing ever flashes into view.
- **A shot from somewhere you can't see is not drawn either.** Muzzle flashes and tracers out of thin air gave away every hidden mech the moment it fired. `hiddenShooter(e)` gates the flash (free — it reads the sweep's verdict), `covertShot(pos, team)` marks the projectile, and `projectiles.js` re-tests a covert shot every 0.05 s so it appears the instant it clears cover. The projectile test is **team-based, not shooter-based**, because a replicated multiplayer shot arrives without its shooter.

### Enemy mechs navigate, they don't path-find

`ai.js` steering is three probes plus one piece of memory, and all of it is mirrored in `AI.swift`:

- `freeDist(e, yaw, max)` — how far the mech can walk along a heading. It samples the walker's **full width** (centre ±`MECH_R`), not a single ray; a centre-only probe calls a heading clear that clips a shoulder into a corner, which is what used to leave mechs grinding against walls.
- `steerAround` — when the direct line is blocked, the mech commits to a side (`e.detourSide`, protected by `e.detourT`) and follows the obstacle until the straight line opens again. The commitment is the whole trick: re-picking a side per frame oscillates. Getting stuck anyway flips the side rather than turning at random.
- `ledgeAhead` — a step within `JUMP_REACH` right in front is jumped (`JUMP_V`), not walked around, so high ground and pits are not AI-proof. Anything taller (walls are 10) is never jumpable, so compounds stay sealed.

A mech that can see and reach its target (`engaging`) keeps its guns on it and side-steps along the steering heading; only out-of-contact marching turns the body toward where it is walking.
