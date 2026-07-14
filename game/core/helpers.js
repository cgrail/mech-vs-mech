import * as THREE from 'three';
import { ARENA, obstacles } from '../world/world.js';
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

export function losBlocked(ax, az, bx, bz, y) {
  const dx = bx - ax, dz = bz - az;
  const dist = Math.hypot(dx, dz);
  const steps = Math.ceil(dist / 3);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + dx * t, z = az + dz * t;
    for (const o of obstacles) {
      if (o.h > y && Math.abs(x - o.x) < o.hw && Math.abs(z - o.z) < o.hd) return true;
    }
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

/* circle vs obstacle AABBs + arena clamp */
export function collideCircle(pos, r) {
  for (const o of obstacles) {
    const cx = Math.max(o.x - o.hw, Math.min(pos.x, o.x + o.hw));
    const cz = Math.max(o.z - o.hd, Math.min(pos.z, o.z + o.hd));
    let dx = pos.x - cx, dz = pos.z - cz;
    let d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 < 1e-6) { // center inside: push along smallest axis
        const px = (o.hw - Math.abs(pos.x - o.x));
        const pz = (o.hd - Math.abs(pos.z - o.z));
        if (px < pz) pos.x += (pos.x >= o.x ? 1 : -1) * (px + r);
        else pos.z += (pos.z >= o.z ? 1 : -1) * (pz + r);
      } else {
        const d = Math.sqrt(d2);
        pos.x += dx / d * (r - d);
        pos.z += dz / d * (r - d);
      }
    }
  }
  // solid entities (bases, turrets) as circles
  for (const e of entities) {
    if (!e.alive || e.kind === 'mech' || e.kind === 'player') continue;
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

/* light mech-vs-mech separation */
export function separateMechs() {
  const mechs = entities.filter(e => e.alive && (e.kind === 'mech' || e.kind === 'player'));
  for (let i = 0; i < mechs.length; i++) {
    for (let j = i + 1; j < mechs.length; j++) {
      const a = mechs[i].group.position, b = mechs[j].group.position;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz), min = 4.4;
      if (d < min && d > 1e-4) {
        const push = (min - d) / 2;
        a.x -= dx / d * push; a.z -= dz / d * push;
        b.x += dx / d * push; b.z += dz / d * push;
      }
    }
  }
}
