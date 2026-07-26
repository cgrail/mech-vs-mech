# MECH VS MECH — native iPhone port

A native Swift/SceneKit port of the web game one directory up. Single-player
campaign (vs. the AI waves) **and** team multiplayer (up to 5 v 5) against the web
game's own backend.

## Building

Requires Xcode 16 or newer (the project uses the synchronized-folder format).

1. `open ios/MechVsMech.xcodeproj`
2. Signing & Capabilities → pick your team (bundle id `de.grails.mechvsmech`).
3. Run on an iPhone or the simulator. Landscape only.

There are no dependencies — SceneKit, SwiftUI, AVFoundation, CoreMotion only.
Adding a Swift file anywhere under `MechVsMech/` automatically joins the target
(synchronized root group) — no project-file edits needed.

## Controls (same two schemes as the web mobile build)

- **Joystick** — left half of the screen: floating joystick (up/down moves,
  left/right strafes). Right half: drag to turn, hold to fire machine guns.
- **Gyro** — physically turn around to rotate the mech (compass is 1:1 by
  design), lean the phone forward/back to move, tilt sideways to strafe, touch
  anywhere to fire. Calibrated to your pose at the moment you tap DEPLOY.
- ⬆️ / 🚀 / 🛰️ buttons jump (free — the web build's Ctrl), fire rockets (🛢️ 20)
  and build a turret in front of you (🛢️ 100).

## Project layout

| | mirrors (web) |
|---|---|
| `MechVsMech/Engine/Levels.swift` + `Terrain.swift` | `game/world/world.js` |
| `MechVsMech/Engine/State.swift` | `game/core/state.js` (difficulty tables verbatim) |
| `MechVsMech/Engine/Helpers.swift` | `game/core/helpers.js` |
| `MechVsMech/Engine/Entities.swift`, `Player.swift`, `Projectiles.swift`, `Particles.swift` | `game/entities/*` |
| `MechVsMech/Engine/AI.swift`, `Build.swift`, `Audio.swift` | `game/systems/ai.js`, `build.js`, `audio.js` |
| `MechVsMech/Engine/CTF.swift` | `game/systems/ctf.js` (capture the flag) |
| `MechVsMech/Engine/GameEngine.swift` | `game/main.js` + `world/scene.js` + `core/flow.js` |
| `MechVsMech/TouchControls.swift` | `game/systems/mobile.js` |
| `MechVsMech/UI/*`, `AppModel.swift` | `game/ui/hud.js` + the overlay screens |
| `MechVsMech/Net/Net.swift`, `Net/Lobby.swift` | `game/net/net.js`, `game/ui/lobby.js` |
| `MechVsMech/Engine/Remote.swift` | `game/systems/remote.js` |

## Multiplayer

MULTIPLAYER from the mode screen opens the lobby and connects to the web game's
Node server at `wss://mech.grails.de/ws` (the same lobby the browser uses, so iOS
and web players share rooms). Flow mirrors the web: enter a callsign → create or
join a room → pick blue or red (max 5/side) → START MATCH once both sides have a
pilot → a READY handshake deploys everyone at once.

The room's creator picks its **map and its mode** (⚔ BASE ASSAULT or 🚩 CAPTURE
THE FLAG, `setMode`); both travel with the match credentials, so a phone and a
browser in the same room always play the same game. Capture the flag itself is
`Engine/CTF.swift` — flag stands derived from the base markers, flags shared and
unowned like the bases, and the `fgrab`/`fdrop`/`fret`/`fcap` relay events
identical to the web build's.

Point it at a different backend by setting the `mechServer` UserDefaults string
(e.g. `ws://192.168.1.20:8080/ws` for a local `npm start`). ATS allows the
default `wss://` (TLS); a plaintext `ws://` server needs an ATS exception.

The result screen's **▸ NEXT MAP** asks the server for a follow-up match on
the next map with the same roster (`nextMatch`); the answer is a plain
`matchStart`, so the app drops the finished engine and runs the usual boot
handshake — the web build does the same thing with a reload.

Ownership/replication is identical to the web build: each client simulates only
its own mech, turrets and shots; everyone else is a network replica. Bases are
shared and converge through mirrored `bhit` damage. The one structural difference
is match entry — the browser reloads the page into `?mp=1`, whereas iOS keeps the
same socket and `rejoin`s (the server has already released the lobby-client record
by then).

One `GameEngine` == one loaded level. Restart / level switch throws the engine
away and builds a new one — the native analog of the web version's
`location.reload()`; there is deliberately no reset logic.

`MechVsMech/Resources/levels.txt` and `rocky-musicloop.mp3` are **copies** of
`../levels/levels.txt` and `../assets/rocky-musicloop.mp3`. After editing levels
in the web repo, re-sync:

```bash
cp levels/levels.txt ios/MechVsMech/Resources/levels.txt
```

A **multiplayer** match doesn't use that copy: an installed app can be older
than the deployed web build, so both the map list and the map itself come from
the lobby server — `GET /levels` fills the room owner's map picker, and at match
boot `GET /level/<param>` returns the chosen level's text, which the app plays.
The bundled copy is the fallback if the server can't be reached — and it is
still what single player, level select and the menu preview read.

## Manual test list (this machine has no Xcode — code is syntax-checked and the
level parser is unit-run against all 56 bundle levels, but the app itself has
not been compiled)

- Build in Xcode; fix any small type errors the syntax check couldn't catch.
- Menu: map orbits behind the overlay; level select previews the chosen map.
- Deploy on level 1, joystick scheme: move/strafe/turn/fire, build a turret,
  fire a rocket, survive a wave, destroy the red base → VICTORY → NEXT LEVEL.
- **Capture the flag**: pick 🚩 CAPTURE THE FLAG in the mission menu — both
  courtyards should show a stand with a flag on it and the HUD a capture score.
  Walk onto the red flag, run it to your own stand (score), die carrying it
  (it drops, and goes home 25s later), and check that raiding mechs steal yours
  and run it back. Three captures ends the match.
- Ramps walkable, ledges block walking up but allow dropping down, cliff rims
  block shots until you reach the edge (all driven by the terrain grid).
- **Chasms** (level59 THE RIFT): the rift is a hole in the terrain mesh, not a
  dark floor; walking off its lip falls forever and kills the mech, shots cross
  it, enemy mechs refuse to walk in and funnel over the bridges instead.
- **Gyro scheme on a real device**: verify turn direction is 1:1 and correct,
  lean forward = move forward, right-edge-down = strafe right. The sign
  conventions live in `TouchControls.swift` (`GyroController`) and are the one
  part of the port that could not be validated off-device — flip the sign on
  `dLean` / `dTilt` / `dYaw` there if a direction is inverted.
- **Multiplayer** (needs two devices, or one device + the web client): open the
  lobby on both, create/join the same room, take opposite teams, START MATCH,
  DEPLOY on both. Check that the other pilot's mech moves smoothly (state easing),
  name tags show, shots from the other side land, kills pay salvage to the whole
  enemy team, and destroying a base ends the match for everyone. Also confirm the
  `Origin` header is accepted — if the socket closes immediately with a 1008, the
  server rejected the origin (see `Net.connect()`), which is the one networking
  detail that can only be confirmed against the live server.
- **Match map comes from the server**: edit one level in `dist/levels/levels.txt`
  on the server (move a wall somewhere obvious) *without* re-copying it into the
  app bundle, restart the server, and start a match on that level — the phone
  should show the server's version. Cutting the network right at match boot
  should still deploy, on the bundled copy, after a short "LOADING THE MAP…".
- **Map picker**: create a room and tap MAP — the list is the server's (`/levels`),
  so it should match the web level select, and picking one updates the room for
  everyone in it (check on a second device or the web client). A pilot who joins
  a room sees the map but no picker; the match plays the room's map, not whatever
  level the pilot who pressed START MATCH had selected. If the room's creator
  leaves, the picker moves to whoever has been in the room longest.
- **Map preview**: the map orbiting behind the lobby follows the room's map (the
  engine is rebuilt on the fetched level, as it is for level select) and goes back
  to the single-player choice on leaving the room. Check that this never happens
  mid-match — the preview is gated on the lobby screen being up.

## Known deviations from the web version

- Desktop keyboard/mouse controls and the minimap are omitted (the web build
  hides the minimap on phones anyway).
- Multiplayer match entry keeps the socket and `rejoin`s instead of reloading
  the page; there is no `?server=`/URL plumbing (use the `mechServer` default).
- The level-switch fly-in/out animation is a camera settle: the web flies the
  whole world out and back in (its camera sits outside the scene), while here
  terrain, entities and camera all hang off `rootNode`, so a newly built map
  eases down into the menu orbit instead. Same trigger on both — level select
  and the lobby following a room's map go through one path per platform.
- Hemisphere light approximated with an ambient light; light intensities are
  eyeballed equivalents, not physically matched.
- Sound effects are pre-rendered to buffers with the same synth parameters
  (sweep, bandpass laser, filtered-noise boom) instead of live WebAudio nodes.
- Turret base and antenna use untapered cylinders (SCNCylinder has one radius).
- Tapping 🚀 without salvage shows a hint text (web only beeps there).
