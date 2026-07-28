import * as THREE from 'three';
import { LEVEL, groundHeightAt, collideTerrain } from '../world/world.js';
import { entities } from '../entities/entities.js';

/* ============================================================
   Math / collision helpers
============================================================ */
const _v1 = new THREE.Vector3();

export function forwardOf(yaw) { return _v1.set(Math.sin(yaw), 0, Math.cos(yaw)); }

export function localToWorld(e, ox, oy, oz, out) {
  const s = Math.sin(e.yaw), c = Math.cos(e.yaw);
  return (out || new THREE.Vector3()).set(
    e.group.position.x + ox * c + oz * s,
    e.group.position.y + oy,
    e.group.position.z - ox * s + oz * c
  );
}

export function distXZ(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/* where guns auto-point on a target (torso height above its ground) */
export function aimYOf(e) {
  return e.group.position.y + Math.min(3.5, e.hitHeight * 0.55);
}

/* fan teammates out around a shared spawn marker: idx 0 is the marker
   itself, higher indices take the idx-th nearby spot on the same terrain
   height. Deterministic, so every client places every player identically. */
const SPAWN_RING = [[-7, 0], [7, 0], [0, 7], [-7, 7], [7, 7], [0, -7], [-7, -7], [7, -7]];
function offsetSpawn(p, idx) {
  if (!idx) return p;
  const h = groundHeightAt(p.x, p.z);
  let n = 0;
  for (const [ox, oz] of SPAWN_RING) {
    const q = { x: p.x + ox, z: p.z + oz };
    if (Math.abs(groundHeightAt(q.x, q.z) - h) < 0.5 && ++n === idx) return q;
  }
  return p; // every spot taken/invalid — mech separation will nudge them apart
}

/* where a player mech deploys: team + index within that team (multiplayer
   teams hold up to 5 players). Blue fans out around the level's P marker;
   red rotates through the enemy-wave S markers, falling back to just in
   front of the red base. `face` is what the mech should look at on spawn
   (the enemy base). */
export function spawnPointFor(team, idx = 0) {
  if (team === 'blue') return { pos: offsetSpawn(LEVEL.playerSpawn, idx), face: LEVEL.redBase };
  const s = LEVEL.enemySpawns;
  if (s.length) {
    return { pos: offsetSpawn(s[idx % s.length], Math.floor(idx / s.length)), face: LEVEL.blueBase };
  }
  const rb = LEVEL.redBase, bb = LEVEL.blueBase;
  const d = Math.hypot(bb.x - rb.x, bb.z - rb.z) || 1;
  const p = { x: rb.x + (bb.x - rb.x) / d * 16, z: rb.z + (bb.z - rb.z) / d * 16 };
  return { pos: offsetSpawn(p, idx), face: bb };
}

/* my position within my team's roster (0 in single player), used to pick
   a spawn spot that no teammate occupies */
export function teamIndexOf(playerId, team, roster) {
  return Math.max(0, roster.filter((p) => p.team === team)
    .sort((a, b) => a.id - b.id).findIndex((p) => p.id === playerId));
}

/* 3D line of sight: blocked where the ray dips into terrain or walls.
   A cliff rim naturally blocks shots down a level until the shooter
   steps up to the edge. */
export function losBlocked(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const steps = Math.ceil(Math.hypot(dx, dz) / 2);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (ay + dy * t < groundHeightAt(ax + dx * t, az + dz * t) + 0.25) return true;
  }
  return false;
}

export function nearestEnemyOf(team, pos, range, opts) {
  let best = null, bestD = range;
  for (const e of entities) {
    if (!e.alive || e.team === team) continue;
    if (opts && opts.exclude && opts.exclude.includes(e.kind)) continue;
    const d = distXZ(pos, e.group.position);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

/* circle vs terrain tiles + solid entities; y = walker's height. Nothing
   clamps to ARENA: the border is walkable off, and what happens past it is
   the terrain's business (groundHeightAt reports void, so it is a fall). */
export function collideCircle(pos, r, y) {
  collideTerrain(pos, r, y);
  // solid entities (bases, turrets) as circles
  for (const e of entities) {
    if (!e.alive || e.kind === 'mech' || e.kind === 'player') continue;
    if (Math.abs(e.group.position.y - y) > 6) continue; // different level
    const rr = r + e.hitRadius * 0.85;
    const dx = pos.x - e.group.position.x, dz = pos.z - e.group.position.z;
    const d = Math.hypot(dx, dz);
    if (d < rr && d > 1e-4) {
      pos.x += dx / d * (rr - d);
      pos.z += dz / d * (rr - d);
    }
  }
}

/* Jump-jet impulses, two of them, because a pilot and the AI are allowed onto
   different things. The player's peaks 11.56 units up against GRAVITY, over
   the 10-unit top of a wall — cover blocks and compound walls are perches to
   be taken, and the way into a fort is over it as well as through its gate.
   Mechs keep the old 4.84-unit hop: a tier step, never a wall, which is what
   still keeps the AI out of the compounds (see JUMP_REACH in ai.js). */
export const GRAVITY = 50;
export const JUMP_V = 34;
export const MECH_JUMP_V = 22;

/* keep e.y glued to the ground, or fall once it walks off an edge.
   Returns true while on the ground. */
export function updateVertical(e, dt) {
  const gh = groundHeightAt(e.group.position.x, e.group.position.z);
  // e.vy > 0 is a mech on its way up out of a jump — don't glue it back down
  if (e.vy <= 0 && gh >= e.y - 0.9) { // ground contact, incl. walking up/down ramps
    e.y = gh; e.vy = 0;
    return true;
  }
  e.vy -= GRAVITY * dt;
  e.y = Math.max(gh, e.y + e.vy * dt);
  if (e.y === gh) { e.vy = 0; return true; }
  return false;
}

/* Walk animation, driven by where the walker is *getting to* — never by what
   the controls (or the last packet) asked for. A mech leaning into a wall, a
   joystick whose release was missed and a replica whose packets stopped all
   report "moving" while standing perfectly still, and striding on the spot is
   the most obvious thing in the game.

   The measurement is an eased anchor — where the walker was a moment ago.
   Walking drags it a fixed distance behind (speed / STRIDE_LAG); anything that
   *wobbles* leaves it sitting in the middle of the wobble. That distinction is
   the whole point and a per-frame delta cannot make it: a mech wedged between
   a wall and its own base is pushed both ways every frame, so it covers plenty
   of ground per frame while going nowhere, and gating on that made a standing
   mech twitch. Net displacement only counts the going-somewhere kind. It also
   costs nothing to smooth the velocity out of the same number, which is what
   enemy aim lead (and the wire) reads.

   The lag vector is split into the mech's own frame, so the legs move the way
   the mech does: fore-aft is the stride (and runs backwards when it backs up),
   sideways is a shuffle — both feet reach toward the direction of travel, half
   a cycle apart, so a strafing mech steps sideways instead of marching. Sets
   both leg poses; returns the amplitude (0..1) for the caller's body bob. */
const STRIDE_LAG = 8;         // 1/s: how fast the anchor catches up
const STRIDE_MIN = 0.55;      // lag (units) that counts as walking — ~4.4 u/s
const STRIDE_JUMPED = 8;      // …and past this it was no step: a spawn or a snap
const STRIDE_SWING = 0.55;    // fore-aft leg swing, radians
const SHUFFLE_REACH = 0.5;    // sideways leg reach, radians
export function animateWalk(e, dt, rate) {
  const p = e.group.position;
  e.anchorX += (p.x - e.anchorX) * (1 - Math.exp(-STRIDE_LAG * dt));
  e.anchorZ += (p.z - e.anchorZ) * (1 - Math.exp(-STRIDE_LAG * dt));
  let dx = p.x - e.anchorX, dz = p.z - e.anchorZ;
  let lag = Math.hypot(dx, dz);
  if (lag > STRIDE_JUMPED) {  // respawn, map switch, a replica's teleport snap
    e.anchorX = p.x; e.anchorZ = p.z;
    dx = 0; dz = 0; lag = 0;
  }
  e.velX = dx * STRIDE_LAG;
  e.velZ = dz * STRIDE_LAG;

  const walking = lag > STRIDE_MIN;
  if (walking) {
    e.walkPhase += dt * rate;
    // local +z is forward, local +x is the mech's left (see localToWorld)
    const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
    e.strideF = (dx * sy + dz * cy) / lag;
    e.strideL = (dx * cy - dz * sy) / lag;
  }
  const amp = e.stride += ((walking ? 1 : 0) - e.stride) * (1 - Math.exp(-14 * dt));
  const s = Math.sin(e.walkPhase);
  const swing = s * STRIDE_SWING * amp * e.strideF;
  const reach = SHUFFLE_REACH * amp * e.strideL;
  e.model.legL.rotation.x = swing;
  e.model.legR.rotation.x = -swing;
  e.model.legL.rotation.z = (0.5 + 0.5 * s) * reach;
  e.model.legR.rotation.z = (0.5 - 0.5 * s) * reach;
  return amp;
}

/* light mech-vs-mech separation */
export function separateMechs() {
  const mechs = entities.filter(e => e.alive && (e.kind === 'mech' || e.kind === 'player'));
  for (let i = 0; i < mechs.length; i++) {
    for (let j = i + 1; j < mechs.length; j++) {
      if (Math.abs(mechs[i].y - mechs[j].y) > 4) continue; // different level
      const a = mechs[i].group.position, b = mechs[j].group.position;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz), min = 4.4;
      if (d < min && d > 1e-4) {
        // a network-driven mech can't be pushed — its position is authoritative
        const ra = mechs[i].remote, rb = mechs[j].remote;
        if (ra && rb) continue;
        const push = ra || rb ? min - d : (min - d) / 2;
        if (!ra) { a.x -= dx / d * push; a.z -= dz / d * push; }
        if (!rb) { b.x += dx / d * push; b.z += dz / d * push; }
      }
    }
  }
}
