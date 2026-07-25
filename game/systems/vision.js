import { scene } from '../world/scene.js';
import { entities } from '../entities/entities.js';
import { player } from '../entities/player.js';
import { game } from '../core/state.js';
import { distXZ, losBlocked, aimYOf } from '../core/helpers.js';

/* ============================================================
   Fog of war — an optional, purely local view restriction

   With it on the district closes in: the render fog sits just
   past the mech, and enemy mechs and turrets are only drawn
   while they are inside VISION_R *and* in line of sight — step
   behind a wall and they are gone from the world and from the
   minimap (`e.seen`, read by ui/hud.js).

   Bases and everything on my own team are always visible: they
   are landmarks and teammates, not intel. Nothing here is sent
   over the wire — it can only ever hide things from the player
   who switched it on, so it is safe in multiplayer too.
============================================================ */
export const VISION_R = 78;          // how far the mech's sensors see
const FOG = { near: 26, far: 96 };   // render fog while fog of war is on
const CLEAR = { near: 90, far: 280 };// the normal in-game fog (flow.js)

/* the play fog for the current setting — called when a game starts and
   whenever the option is toggled */
export function applyFog() {
  const f = game.fogOfWar ? FOG : CLEAR;
  scene.fog.near = f.near;
  scene.fog.far = f.far;
}

let acc = 0;
let hiding = false;  // something out there is currently hidden

export function updateVision(dt) {
  if (!game.fogOfWar) {
    if (hiding) { // just switched off: put the whole district back
      hiding = false;
      for (const e of entities) { e.seen = true; e.group.visible = true; }
    }
    return;
  }
  hiding = true;
  acc -= dt;
  if (acc > 0) return;
  acc = 0.12; // a few frames' worth: LOS sampling is the expensive part
  const p = player.group.position;
  const eye = player.y + 5;
  for (const e of entities) {
    if (e.team === player.team || e.kind === 'base') { e.seen = true; e.group.visible = true; continue; }
    const q = e.group.position;
    e.seen = e.alive && distXZ(p, q) <= VISION_R && !losBlocked(p.x, eye, p.z, q.x, aimYOf(e), q.z);
    e.group.visible = e.seen;
  }
}
