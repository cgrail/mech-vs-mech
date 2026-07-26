import { scene } from '../world/scene.js';
import { entities } from '../entities/entities.js';
import { player } from '../entities/player.js';
import { game } from '../core/state.js';
import { losBlocked, aimYOf } from '../core/helpers.js';

/* ============================================================
   Fog of war — an optional, purely local view restriction

   With it on the district closes in: the render fog sits just
   past the mech, and enemy mechs and turrets are only drawn
   while they are inside VISION_R *and* in line of sight — step
   behind a wall and they are gone from the world and from the
   minimap (`e.seen`, read by ui/hud.js).

   Two things keep that from reading as a glitch:

   - contact is *faded*, not switched. A mech coming round a
     corner takes FADE seconds to materialise instead of
     appearing between two frames, which also hides the fact
     that the line-of-sight sweep only runs every TICK seconds.
   - a shot fired from somewhere I cannot see is not drawn
     either (`covertShot` / `hiddenShooter`). Muzzle flashes and
     tracers blooming out of thin air used to give away every
     hidden mech the moment it opened fire — the fog hid the
     shooter and then advertised it.

   Bases and everything on my own team are always visible: they
   are landmarks and teammates, not intel. Nothing here is sent
   over the wire — it can only ever hide things from the player
   who switched it on, so it is safe in multiplayer too.
============================================================ */
export const VISION_R = 78;          // how far the mech's sensors see
const FOG = { near: 26, far: 96 };   // render fog while fog of war is on
const CLEAR = { near: 90, far: 280 };// the normal in-game fog (flow.js)
const TICK = 0.08;                   // seconds between line-of-sight sweeps
const FADE = 0.15;                   // seconds an enemy takes to fade in or out

/* the play fog for the current setting — called when a game starts and
   whenever the option is toggled */
export function applyFog() {
  const f = game.fogOfWar ? FOG : CLEAR;
  scene.fog.near = f.near;
  scene.fog.far = f.far;
}

/* ---------- sensor contact with a bare world point ----------
   The eye is the mech's sensor block, the same height the guns check LOS
   from, so what the player can see and what they can shoot agree. */
export function inSight(x, y, z) {
  const p = player.group.position;
  const dx = p.x - x, dz = p.z - z;
  return dx * dx + dz * dz <= VISION_R * VISION_R
    && !losBlocked(p.x, player.y + 5, p.z, x, y, z);
}

/* An enemy shot spawned where I can't see it: drawn only once it clears
   whatever the shooter is behind (projectiles.js keeps re-testing it).
   Team-based rather than shooter-based so a replicated multiplayer shot,
   which arrives without its shooter, is covered by the same rule. */
export function covertShot(pos, team) {
  return !!(game.fogOfWar && team !== player.team && !inSight(pos.x, pos.y, pos.z));
}

/* the muzzle flash of an enemy I cannot see. Free: it reads the sweep's own
   verdict rather than casting another ray (ai.js, at every fire point) */
export function hiddenShooter(e) {
  return !!(game.fogOfWar && e && e.seen === false);
}

/* ---------- fading a whole entity in and out ----------
   Every model builds its own materials (entities.js), so opacity can be set
   per entity without touching anything else. `transparent` is only switched
   on while a fade is actually running: leaving it on would put every mech
   into the transparent pass for good, and with it into depth-sort order. */
function applyFade(e, v) {
  if (e.fadeAt === v) return;
  e.fadeAt = v;
  e.group.visible = v > 0.002;
  if (!e.group.visible) return;
  const solid = v > 0.998;
  e.group.traverse((o) => {
    const m = o.material;
    if (!m) return;
    if (m.opaqueBase === undefined) m.opaqueBase = m.transparent; // health bars are natively transparent
    m.transparent = solid ? m.opaqueBase : true;
    m.opacity = solid ? 1 : v;
  });
}

let acc = 0;
let hiding = false;  // something out there is currently hidden

export function updateVision(dt) {
  if (!game.fogOfWar) {
    if (hiding) { // just switched off: put the whole district back
      hiding = false;
      for (const e of entities) { e.seen = true; e.fade = 1; applyFade(e, 1); }
    }
    return;
  }
  hiding = true;

  /* the sweep: the expensive part, so it runs on its own budget */
  acc -= dt;
  if (acc <= 0) {
    acc = TICK;
    const p = player.group.position;
    for (const e of entities) {
      if (e.team === player.team || e.kind === 'base') { e.seen = true; continue; }
      const q = e.group.position;
      const dx = p.x - q.x, dz = p.z - q.z;
      e.seen = e.alive && dx * dx + dz * dz <= VISION_R * VISION_R
        && !losBlocked(p.x, player.y + 5, p.z, q.x, aimYOf(e), q.z);
    }
  }

  /* the fade: every frame, so contact reads as smooth however coarse the
     sweep above is */
  for (const e of entities) {
    // created since the last sweep, so it has no verdict yet: teammates and
    // landmarks are never hidden, an enemy is out of contact until the sweep
    // says otherwise — either way it settles without flashing into view
    if (e.seen === undefined) e.seen = e.team === player.team || e.kind === 'base';
    const want = e.seen ? 1 : 0;
    if (e.fade === undefined) e.fade = want;   // first frame for it: snap, don't fade
    else if (e.fade !== want) {
      const step = dt / FADE;
      e.fade = want ? Math.min(1, e.fade + step) : Math.max(0, e.fade - step);
    }
    applyFade(e, e.fade);
  }
}
