import * as THREE from 'three';
import { entities, blueBase, redBase, makeEnemyMech } from '../entities/entities.js';
import { game, stats, difficulty } from '../core/state.js';
import { distXZ, losBlocked, localToWorld, nearestEnemyOf, collideCircle } from '../core/helpers.js';
import { spawnProjectile } from '../entities/projectiles.js';
import { beep } from './audio.js';
import { player } from '../entities/player.js';
import { showMessage } from '../ui/hud.js';

/* ============================================================
   AI: turrets + enemy mechs + waves
============================================================ */
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function angDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

/* can e walk `dist` units along `yaw` without hitting a tall obstacle? */
function clearDir(e, yaw, dist) {
  const p = e.group.position;
  return !losBlocked(p.x, p.z, p.x + Math.sin(yaw) * dist, p.z + Math.cos(yaw) * dist, 3);
}

export function updateTurret(e, dt) {
  e.cool -= dt;
  e.retarget -= dt;
  if (e.retarget <= 0) {
    e.retarget = 0.4;
    const t = nearestEnemyOf(e.team, e.group.position, e.range, { exclude: ['base'] });
    e.target = (t && !losBlocked(e.group.position.x, e.group.position.z, t.group.position.x, t.group.position.z, 3)) ? t : null;
  }
  if (!e.target || !e.target.alive) { e.target = null; return; }

  const tp = e.target.group.position;
  const desired = Math.atan2(tp.x - e.group.position.x, tp.z - e.group.position.z);
  const diff = angDiff(desired, e.yaw);
  const turn = 4 * dt;
  e.yaw += Math.max(-turn, Math.min(turn, diff));
  e.head.rotation.y = e.yaw;

  if (Math.abs(diff) < 0.15 && e.cool <= 0) {
    e.cool = e.fireInterval;
    const muzzle = localToWorld(e, 0, 3.0, 2.2);
    // red turrets lead moving targets on higher difficulties
    const lead = e.team === 'red' ? difficulty().mech.aimLead : 0;
    const tof = distXZ(e.group.position, tp) / 100;
    const ax = tp.x + (e.target.velX || 0) * tof * lead;
    const az = tp.z + (e.target.velZ || 0) * tof * lead;
    const dir = _v.set(ax, Math.min(3.5, e.target.hitHeight * 0.55), az).sub(muzzle).normalize().clone();
    spawnProjectile({ pos: muzzle, dir, speed: 100, damage: e.damage, team: e.team, life: 1 });
    if (e.team === 'blue') beep(340, 120, 0.05, 'square', 0.03);
    else beep(240, 80, 0.05, 'square', 0.03);
  }
}

export function updateEnemyMech(e, dt) {
  const cfg = difficulty().mech;
  e.cool -= dt;
  e.retarget -= dt;
  if (e.retarget <= 0) {
    e.retarget = cfg.retarget;
    // priority: player nearby > close / already-damaged blue turret > blue base
    let t = null;
    if (player.alive && distXZ(e.group.position, player.group.position) < 52) t = player;
    if (!t) {
      let bs = Infinity;
      for (const o of entities) {
        if (!o.alive || o.team !== 'blue' || o.kind !== 'turret') continue;
        const d = distXZ(e.group.position, o.group.position);
        if (d > 46) continue;
        const score = d * (0.55 + 0.45 * (o.hp / o.maxHp)); // finish off weakened turrets
        if (score < bs) { bs = score; t = o; }
      }
    }
    if (!t) t = blueBase.alive ? blueBase : (player.alive ? player : null);
    e.target = t;
  }
  if (!e.target || !e.target.alive) return;

  const tp = e.target.group.position;
  const d = distXZ(e.group.position, tp);
  const attackRange = e.target.kind === 'base' ? 32 : e.range;
  const clear = !losBlocked(e.group.position.x, e.group.position.z, tp.x, tp.z, 3);
  const desired = Math.atan2(tp.x - e.group.position.x, tp.z - e.group.position.z);

  // steering: head for the target, swerving around obstacles in the way
  let steerYaw = desired;
  if (e.detourT > 0) {
    e.detourT -= dt;
    steerYaw = e.detourYaw;
  } else if (!clearDir(e, desired, 10)) {
    for (const off of [0.5, -0.5, 1, -1, 1.5, -1.5, 2.1, -2.1]) {
      if (clearDir(e, desired + off, 9)) { steerYaw = desired + off; break; }
    }
  }

  const shouldMove = d > attackRange * 0.85 || !clear;
  let stepYaw = null;
  if (shouldMove) {
    stepYaw = steerYaw;
  } else if (cfg.strafe && e.target === player) {
    // hold range but strafe sideways to dodge return fire
    e.strafeTimer -= dt;
    if (e.strafeTimer <= 0) {
      e.strafeTimer = 1.1 + Math.random() * 1.5;
      e.strafeDir = -e.strafeDir;
    }
    const sy = desired + (Math.PI / 2) * e.strafeDir;
    if (clearDir(e, sy, 5)) stepYaw = sy;
  }

  // face the travel direction while marching, the target while fighting
  const faceYaw = shouldMove ? steerYaw : desired;
  const turn = 3.2 * dt;
  const fd = angDiff(faceYaw, e.yaw);
  e.yaw += Math.max(-turn, Math.min(turn, fd));
  e.group.rotation.y = e.yaw;

  if (stepYaw !== null) {
    const spd = shouldMove ? e.speed : e.speed * 0.6;
    const moveYaw = shouldMove ? e.yaw : stepYaw; // strafing sidesteps without turning
    e.group.position.x += Math.sin(moveYaw) * spd * dt;
    e.group.position.z += Math.cos(moveYaw) * spd * dt;
    collideCircle(e.group.position, 2.2);
    e.walkPhase += dt * 7;
    const sw = Math.sin(e.walkPhase) * 0.55;
    e.model.legL.rotation.x = sw;
    e.model.legR.rotation.x = -sw;
    e.group.position.y = Math.abs(Math.sin(e.walkPhase)) * 0.25;

    // barely moving? take a random detour instead of grinding into the wall
    const stepped = Math.hypot(e.group.position.x - e.px, e.group.position.z - e.pz);
    if (shouldMove && stepped < spd * dt * 0.25) {
      e.stuckT += dt;
      if (e.stuckT > 0.7) {
        e.stuckT = 0;
        e.detourT = 0.9;
        e.detourYaw = e.yaw + (Math.random() < 0.5 ? 1 : -1) * (1.6 + Math.random());
      }
    } else {
      e.stuckT = 0;
    }
  } else {
    e.group.position.y = 0;
  }
  e.px = e.group.position.x;
  e.pz = e.group.position.z;

  // fire: lead moving targets, tighter spread on harder difficulties
  const aimDiff = Math.abs(angDiff(desired, e.yaw));
  if (d < attackRange && clear && aimDiff < 0.25 && e.cool <= 0) {
    e.cool = e.fireInterval * (0.8 + Math.random() * 0.5);
    const muzzle = localToWorld(e, (Math.random() < 0.5 ? -2.2 : 2.2), 4.5, 2.7);
    const tof = d / 70;
    const ax = tp.x + (e.target.velX || 0) * tof * cfg.aimLead;
    const az = tp.z + (e.target.velZ || 0) * tof * cfg.aimLead;
    const spread = (Math.random() - 0.5) * cfg.spread;
    const dir = _v.set(ax - muzzle.x, 0, az - muzzle.z).normalize().clone();
    dir.applyAxisAngle(UP, spread);
    dir.y = (Math.min(3.5, e.target.hitHeight * 0.5) - muzzle.y) / Math.max(d, 1);
    dir.normalize();
    spawnProjectile({ pos: muzzle, dir, speed: 70, damage: e.damage, team: 'red', life: 1.4 });
    beep(200, 70, 0.05, 'square', 0.025);
  }
}

/* waves */
let nextWaveAt = 5;
export function updateWaves() {
  if (game.elapsed < nextWaveAt || !redBase.alive) return;
  const w = difficulty().wave;
  nextWaveAt = game.elapsed + w.interval;
  const alive = entities.filter(e => e.kind === 'mech' && e.team === 'red').length;
  if (alive >= w.maxAlive) return;
  stats.wave++;
  const n = Math.min(w.base + Math.floor(stats.wave / w.growthDiv), w.maxPerWave);
  for (let i = 0; i < n; i++) {
    if (w.flank && stats.wave >= 2 && i % 3 === 2) {
      // flankers come down the side lanes instead of the middle
      const side = Math.random() < 0.5 ? -1 : 1;
      makeEnemyMech(side * (56 + Math.random() * 8), -66 + Math.random() * 8);
    } else {
      const x = (i - (n - 1) / 2) * 7;
      makeEnemyMech(x + (Math.random() - 0.5) * 3, -96 + Math.random() * 4);
    }
  }
  showMessage(`WAVE ${stats.wave} INCOMING`, '#ff9a5a');
  beep(90, 55, 0.6, 'sawtooth', 0.12);
}
