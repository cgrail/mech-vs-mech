import { scene } from '../world/scene.js';
import { entities } from '../entities/entities.js';
import { player } from '../entities/player.js';
import { game } from '../core/state.js';
import { losBlocked, aimYOf } from '../core/helpers.js';

/* ============================================================
   Fog of war — an optional, purely local view restriction

   With it on the district closes in: the render fog sits just
   past the mech, and enemy mechs and turrets are drawn only as
   far as the sensors reach them.

   Contact is a *strength*, never a flag — that is the whole
   design, and what an earlier boolean version got wrong. A
   yes/no verdict from one ray to one point flips the moment the
   ray clips a corner, so a mech edging round cover strobed, and
   one at the rim of the sensor circle blinked with every step.
   Instead `e.contact` is 0…1:

   - five rays per target (three up its body, two straddling it
     at shoulder width) — half a mech behind a wall reads half
     seen and sits there steadily instead of flickering;
   - the outer FALLOFF units of the sensor circle are a fade
     rather than a cliff, so range contact comes up gradually;
   - contact is faded into `e.fade` fast (FADE_IN) and out slowly
     (FADE_OUT) after a HOLD of sensor lock, so a target that
     ducks behind a pillar for a moment never disappears at all,
     and one that really breaks contact dissolves rather than
     vanishing. Fast in / slow out is also what hides the fact
     that the sweep only runs every TICK seconds.
   - a lost contact leaves a mark where it was last solid, which
     the minimap keeps for GHOST seconds (`e.ghost`) — losing a
     mech costs you its position, not the memory of it.

   And a shot fired from somewhere I cannot see is not drawn
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
const FALLOFF = 22;                  // the outer band of that circle, faded not cut
const FOG = { near: 26, far: 96 };   // render fog while fog of war is on
const CLEAR = { near: 90, far: 280 };// the normal in-game fog (flow.js)
const TICK = 0.08;                   // seconds between line-of-sight sweeps
const FADE_IN = 0.12;                // seconds a contact takes to materialise
const FADE_OUT = 0.5;                // …and to dissolve once it is really gone
const HOLD = 0.4;                    // sensor lock: contact is kept this long after it breaks
const GHOST = 6;                     // seconds a lost contact stays on the minimap

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
   verdict rather than casting another ray (ai.js, at every fire point).
   `seen` is "drawn at all", not "drawn solidly" — a mech I can make out as a
   silhouette must be allowed to flash, or it would fire invisibly. */
export function hiddenShooter(e) {
  return !!(game.fogOfWar && e && e.seen === false);
}

/* ---------- how much of a target the sensors have ----------
   Five rays: up the body (a mech behind a low wall is seen head-first) and
   out to either side of it (a mech edging round a corner is seen shoulder
   first). The fraction that get through, scaled by how far into the sensor
   circle it is — both are what make contact a strength rather than a flip. */
function contactOf(e, px, py, pz) {
  const q = e.group.position;
  const dx = q.x - px, dz = q.z - pz;
  const d2 = dx * dx + dz * dz;
  if (d2 > VISION_R * VISION_R) return 0;
  const d = Math.sqrt(d2);
  const range = Math.min(1, (VISION_R - d) / FALLOFF);
  // perpendicular to the line of sight, so the pair straddles whatever cover
  // is between us rather than lying along it
  const s = d > 0.01 ? e.hitRadius * 0.8 / d : 0;
  const ox = -dz * s, oz = dx * s;
  const mid = aimYOf(e);
  const clear = (x, y, z) => (losBlocked(px, py, pz, x, y, z) ? 0 : 1);
  const hits = clear(q.x, mid, q.z)                        // torso
    + clear(q.x, q.y + e.hitHeight * 0.9, q.z)             // head
    + clear(q.x, q.y + e.hitHeight * 0.25, q.z)            // legs
    + clear(q.x + ox, mid, q.z + oz)                       // one shoulder
    + clear(q.x - ox, mid, q.z - oz);                      // the other
  return range * hits / 5;
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
      for (const e of entities) { e.seen = true; e.contact = 1; e.fade = 1; e.ghost = 0; applyFade(e, 1); }
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
      if (e.team === player.team || e.kind === 'base') { e.contact = 1; continue; }
      e.contact = e.alive ? contactOf(e, p.x, player.y + 5, p.z) : 0;
      // solid contact is worth remembering: the minimap keeps the spot
      if (e.contact > 0.5) { e.markX = e.group.position.x; e.markZ = e.group.position.z; e.markT = game.elapsed; }
    }
  }

  /* the fade: every frame, so contact reads as smooth however coarse the
     sweep above is. Rising is quick, falling waits out the sensor lock and
     then takes its time — a target is never lost between two frames. */
  for (const e of entities) {
    // created since the last sweep, so it has no verdict yet: teammates and
    // landmarks are never hidden, an enemy is out of contact until the sweep
    // says otherwise — either way it settles without flashing into view
    if (e.contact === undefined) e.contact = e.team === player.team || e.kind === 'base' ? 1 : 0;
    if (e.hold === undefined) e.hold = HOLD;
    if (e.fade === undefined) e.fade = e.contact;        // first frame for it: snap, don't fade
    else if (e.fade < e.contact) {
      e.fade = Math.min(e.contact, e.fade + dt / FADE_IN);
      e.hold = HOLD;
    } else if (e.fade > e.contact) {
      e.hold -= dt;
      if (e.hold <= 0) e.fade = Math.max(e.contact, e.fade - dt / FADE_OUT);
    } else e.hold = HOLD;
    // "drawn at all" — what the minimap and the muzzle-flash gate ask about
    e.seen = e.fade > 0.02;
    // and where it was when we last had it properly, fading off the minimap
    e.ghost = e.markT === undefined ? 0 : Math.max(0, 1 - (game.elapsed - e.markT) / GHOST);
    applyFade(e, e.fade);
  }
}
