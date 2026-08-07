import * as THREE from 'three';
import { scene, setNight } from '../world/scene.js';
import { entities } from '../entities/entities.js';
import { player } from '../entities/player.js';
import { game } from '../core/state.js';
import { fogShift } from '../core/view.js';
import { losBlocked, aimYOf } from '../core/helpers.js';

/* ============================================================
   Fog of war — an optional, purely local view restriction

   With it on the district closes in: night falls over it (the
   `night` look in world/scene.js), the render fog sits just past
   the mech, the mech's own sensor lamp is most of the light
   there is, and enemy mechs and turrets are drawn only as far as
   the sensors reach them.

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

/* ---------- the sensor lamp ----------
   What makes a dark district playable rather than a black screen: a spot
   mounted on the mech's sensor block, pointing where the mech is pointing,
   plus a dim omni so the mech itself is a machine rather than a silhouette.

   Two decisions worth keeping. It rides its own node instead of hanging off
   `player.group`, because the group is taken out of the scene while the
   mech is dead (projectiles.js) — a lamp parented to it would black the
   district out for the four seconds of the respawn wait, and would change
   the scene's light count on every death, which costs a shader rebuild.
   Left where it fell, it reads as the wreck still burning. And it is built
   the first time fog of war is switched on, never before: the day district
   must not pay for two lights it cannot see.

   The numbers are a low-mounted lamp's numbers. Grazing incidence does most
   of the falloff (the ground 40 units ahead catches the beam at ~8°), so
   `decay` is deliberately gentler than physical, and `reach` ends the pool
   exactly where the sensors stop caring. */
const LAMP = {
  color: 0xdbe8ff,
  intensity: 22,       // candela; tuned against the night look's exposure
  decay: 0.6,          // physical is 2 — far too dark at the rim to play
  reach: VISION_R,     // the lit pool ends where sensor contact does
  angle: 0.62,         // half-angle of the cone, radians
  penumbra: 0.65,      // soft rim: a hard cone edge reads as a texture bug
  fillColor: 0x9ab6ff,
  fillIntensity: 5,    // the omni at the cockpit, so the mech is lit at all
  fillReach: 22,       // kept short: this one is for the machine, not the ground
};

/* ---------- a damaged mech is a damaged lamp ----------
   Hits cost you light: the beam browns out and closes down toward these
   fractions of full at zero hp, and comes back with the self-repair, so a
   fight you are losing is one you can see less and less of. Purely a view
   effect — the sensors' own reach (VISION_R and the sweep) is untouched, so
   this changes what the district looks like and never what anyone knows,
   which is what keeps it safe in PvP.

   It eases rather than steps: a lamp that snapped a notch darker on every
   bullet would read as a rendering fault, while a brown-out reads as damage. */
const HURT = {
  dim: 0.34,     // intensity left at zero hp…
  narrow: 0.55,  // …and how far the cone has closed down
  ease: 0.7,     // seconds to settle after a hit (or a repair)
};
let rig = null;
let lampSpot = null, lampFill = null;
let hurt = 0;    // 0 = untouched, 1 = as dark and narrow as it gets

function lamp() {
  if (rig) return rig;
  rig = new THREE.Group();
  const spot = new THREE.SpotLight(LAMP.color, LAMP.intensity, LAMP.reach, LAMP.angle, LAMP.penumbra, LAMP.decay);
  lampSpot = spot;
  spot.position.set(0, 5.9, 0.6);          // the sensor block, above the cockpit
  spot.target.position.set(0, 0, 26);      // forward, tilted ~13° down
  spot.castShadow = true;                  // the sun handed its shadow pass over
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 1.5;           // far comes from the light's distance
  spot.shadow.bias = -0.0008;
  spot.shadow.normalBias = 0.5;            // tiles are 8 units; acne needs the slope bias
  const fill = new THREE.PointLight(LAMP.fillColor, LAMP.fillIntensity, LAMP.fillReach, 1);
  fill.position.set(0, 5, 0);
  lampFill = fill;
  rig.add(spot, spot.target, fill);
  return rig;
}

/* the beam for the hp the mech has left, eased. Called every frame the fog is
   on, including while the mech is dead — a wreck's lamp is a dying one. */
function hurtLamp(dt) {
  if (!lampSpot) return;
  const want = player.alive ? 1 - Math.max(0, Math.min(1, player.hp / player.maxHp)) : 1;
  const step = dt / HURT.ease;
  hurt = want > hurt ? Math.min(want, hurt + step) : Math.max(want, hurt - step);
  const dim = 1 - hurt * (1 - HURT.dim);
  lampSpot.intensity = LAMP.intensity * dim;
  lampSpot.angle = LAMP.angle * (1 - hurt * (1 - HURT.narrow));
  lampFill.intensity = LAMP.fillIntensity * dim;
}

/* ---------- friendly turret lamps ----------
   A turret of yours is an outpost at night, not a silhouette: it holds a lamp
   of its own, which is what makes the corner it covers readable before you
   walk into it. Only your own team's — an enemy emplacement lighting itself up
   would hand over exactly the intel the fog is there to withhold.

   Lights are the one thing here that cannot simply be per entity: a player can
   build turrets all match, and three.js recompiles every lit material whenever
   the *number* of lights in the scene changes. So the lamps are a fixed pool,
   lent to the nearest friendly turrets and dimmed to zero — never hidden, never
   removed — when there is no post for one. The count stays put; only the
   intensities move. A lamp is re-posted once it is dark, so a light never
   teleports across the district mid-glow. */
const TLAMP = {
  color: 0xbcd8ff,
  intensity: 15,       // candela, against the night look's exposure
  decay: 0.7,          // the sensor lamp's reasoning: physical is too dark to play
  reach: 34,           // a pool around the emplacement, not a second sun
  height: 4.6,         // just above the head, so the head is lit too
  pool: 4,             // lamps to go round
  ramp: 0.5,           // seconds a lamp takes to come up or go dark
};
let tRigs = null;

function turretLamps() {
  if (!tRigs) {
    tRigs = [];
    for (let i = 0; i < TLAMP.pool; i++) {
      const l = new THREE.PointLight(TLAMP.color, 0, TLAMP.reach, TLAMP.decay);
      l.at = null;   // the turret this lamp is currently posted on
      tRigs.push(l);
    }
  }
  return tRigs;
}

/* hand the pool to the nearest friendly turrets. Runs on the sensor sweep's
   budget — turrets do not move, so a lamp's position is set once, when it is
   posted. */
function postTurretLamps(px, pz) {
  if (!tRigs) return;
  const near = [];
  for (const e of entities) {
    if (e.kind !== 'turret' || !e.alive || e.team !== player.team) continue;
    const q = e.group.position;
    near.push({ d: (q.x - px) ** 2 + (q.z - pz) ** 2, e });
  }
  near.sort((a, b) => a.d - b.d);
  const want = near.slice(0, TLAMP.pool).map((n) => n.e);
  for (const l of tRigs) if (!want.includes(l.at)) l.at = null;
  for (const t of want) {
    if (tRigs.some((l) => l.at === t)) continue;
    const free = tRigs.find((l) => !l.at && l.intensity <= 0.01); // dark ones only
    if (!free) break;
    free.at = t;
    free.position.set(t.group.position.x, t.group.position.y + TLAMP.height, t.group.position.z);
  }
}

/* the lamp rides the mech — while it is alive. A dead mech's lamp stays
   where it fell rather than following the wreck out of the scene. `always`
   is the moment it is switched on, which puts it on the mech whatever state
   the mech is in, rather than leaving it out at the map's centre. */
function rideMech(always) {
  if (!rig || !(always || player.alive)) return;
  rig.position.copy(player.group.position);
  rig.rotation.y = player.yaw;
}

/* The fog band alone. Both numbers are distances from the *camera*, but what
   they describe is how far the mech can make out — so they slide out by
   whatever extra distance the current camera view rides at (core/view.js).
   Without that, climbing into the bird's eye would fog the district the mech
   is standing in rather than the horizon. */
function applyFogRange() {
  const f = game.fogOfWar ? FOG : CLEAR;
  const shift = fogShift();
  scene.fog.near = f.near + shift;
  scene.fog.far = f.far + shift;
}
window.addEventListener('mech:viewchanged', applyFogRange);

/* the play fog, the district's lighting and the lamp for the current
   setting — called when a game starts and whenever the option is toggled.
   All of it lands together, so the switch is one change of weather. */
export function applyFog() {
  const on = !!game.fogOfWar;
  applyFogRange();
  setNight(on);
  if (on) {
    scene.add(lamp());
    rideMech(true);   // in place for the first frame, not at the map's centre
    hurt = player.alive ? 1 - player.hp / player.maxHp : 1;  // no ease from a stale value
    hurtLamp(0);      // …and at the right strength for the first frame too
    for (const l of turretLamps()) scene.add(l);
    postTurretLamps(player.group.position.x, player.group.position.z);
  } else {
    if (rig) scene.remove(rig);
    for (const l of tRigs || []) { scene.remove(l); l.at = null; l.intensity = 0; }
  }
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

  rideMech();
  hurtLamp(dt);

  /* the turret lamps come up and go dark on their own clock, so a lamp being
     re-posted (or its turret blowing up) reads as a light powering down
     rather than as one blinking out */
  for (const l of tRigs || []) {
    const want = l.at && l.at.alive ? TLAMP.intensity : 0;
    const step = TLAMP.intensity * dt / TLAMP.ramp;
    l.intensity = want > l.intensity ? Math.min(want, l.intensity + step)
      : Math.max(want, l.intensity - step);
  }

  /* the sweep: the expensive part, so it runs on its own budget */
  acc -= dt;
  if (acc <= 0) {
    acc = TICK;
    const p = player.group.position;
    postTurretLamps(p.x, p.z);
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
