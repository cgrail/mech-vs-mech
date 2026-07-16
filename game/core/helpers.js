import * as THREE from 'three';
import { ARENA, LEVEL, groundHeightAt, collideTerrain } from '../world/world.js';
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

/* where a player mech deploys, per team (multiplayer gives each side one).
   Blue uses the level's P marker; red uses the first enemy-wave S marker,
   falling back to just in front of the red base. `face` is what the mech
   should look at on spawn (the enemy base). */
export function spawnPointFor(team) {
  if (team === 'blue') return { pos: LEVEL.playerSpawn, face: LEVEL.redBase };
  const s = LEVEL.enemySpawns[0];
  if (s) return { pos: s, face: LEVEL.blueBase };
  const rb = LEVEL.redBase, bb = LEVEL.blueBase;
  const d = Math.hypot(bb.x - rb.x, bb.z - rb.z) || 1;
  return { pos: { x: rb.x + (bb.x - rb.x) / d * 16, z: rb.z + (bb.z - rb.z) / d * 16 }, face: bb };
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

/* circle vs terrain tiles + solid entities + arena clamp; y = walker's height */
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
  pos.x = Math.max(-ARENA.hw + r, Math.min(ARENA.hw - r, pos.x));
  pos.z = Math.max(-ARENA.hd + r, Math.min(ARENA.hd - r, pos.z));
}

/* keep e.y glued to the ground, or fall once it walks off an edge.
   Returns true while on the ground. */
export function updateVertical(e, dt) {
  const gh = groundHeightAt(e.group.position.x, e.group.position.z);
  if (gh >= e.y - 0.9) { // ground contact, incl. walking up/down ramps
    e.y = gh; e.vy = 0;
    return true;
  }
  e.vy -= 50 * dt;
  e.y = Math.max(gh, e.y + e.vy * dt);
  if (e.y === gh) { e.vy = 0; return true; }
  return false;
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
