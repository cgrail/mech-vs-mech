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

No build step, no npm install — it's plain ES modules with three.js loaded from a CDN. You just need a local web server (browsers block module imports from `file://`):

```bash
# from the repo root, pick whichever you have:
python3 -m http.server 8080
# or
npx serve .
```

Then open [http://localhost:8080](http://localhost:8080), pick a difficulty, and hit **DEPLOY**.

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
game/
├── main.js         entry point & game loop
├── core/           game state, math helpers, start/end flow
├── world/          renderer, camera, arena and obstacles
├── entities/       player, enemies, projectiles, particles
├── systems/        enemy AI, build mode, input, sound
└── ui/             HUD, minimap, messages
```

## Credits

An homage to *Future Cop: LAPD* (1998) — the mech, the aim assist, and the base-assault mode are all a loving nod. Built with three.js; sound effects are synthesized live with the Web Audio API, so there are no assets to download.
