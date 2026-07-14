import * as THREE from 'three';
import { LEVEL, STEP, groundHeightAt } from '../world/world.js';
import { entities, blueBase, redBase, makeEnemyMech } from '../entities/entities.js';
import { game, stats, difficulty } from '../core/state.js';
import { distXZ, losBlocked, localToWorld, nearestEnemyOf, collideCircle, updateVertical, aimYOf } from '../core/helpers.js';
import { spawnProjectile } from '../entities/projectiles.js';
import { beep, laserSfx } from './audio.js';
import { player } from '../entities/player.js';
import { showMessage } from '../ui/hud.js';

/* ============================================================
   AI: turrets + enemy mechs + waves
============================================================ */
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function angDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

/* can e walk `dist` units along `yaw`? Ledges too tall to step up block;
   walking down (dropping off an edge) is always allowed. */
function clearDir(e, yaw, dist) {
  const p = e.group.position;
  const sx = Math.sin(yaw), cz = Math.cos(yaw);
  let y = e.y;
  for (let s = 1.2; s <= dist; s += 1.2) {
    const h = groundHeightAt(p.x + sx * s, p.z + cz * s);
    if (h > y + STEP) return false;
    y = h;
  }
  return true;
}

export function updateTurret(e, dt) {
  e.cool -= dt;
  e.retarget -= dt;
  if (e.retarget <= 0) {
    e.retarget = 0.4;
    const p = e.group.position;
    const t = nearestEnemyOf(e.team, p, e.range, { exclude: ['base'] });
    e.target = (t && !losBlocked(p.x, p.y + 3, p.z, t.group.position.x, aimYOf(t), t.group.position.z)) ? t : null;
  }
  if (!e.target || !e.target.alive) { e.target = null; return; }

  const tp = e.target.group.position;
  const desired = Math.atan2(tp.x - e.group.position.x, tp.z - e.group.position.z);
  const diff = angDiff(desired, e.yaw);
  const turn = 4 * dt;
  e.yaw += Math.max(-turn, Math.min(turn, diff));
  e.head.rotation.y = e.yaw;
  // pitch the head toward the target's level
  const dXZ = distXZ(e.group.position, tp);
  e.head.rotation.x = -Math.atan2(aimYOf(e.target) - (e.group.position.y + 3), Math.max(dXZ, 1));

  if (Math.abs(diff) < 0.15 && e.cool <= 0) {
    e.cool = e.fireInterval;
    const muzzle = localToWorld(e, 0, 3.0, 2.2);
    // red turrets lead moving targets on higher difficulties
    const lead = e.team === 'red' ? difficulty().mech.aimLead : 0;
    const tof = dXZ / 100;
    const ax = tp.x + (e.target.velX || 0) * tof * lead;
    const az = tp.z + (e.target.velZ || 0) * tof * lead;
    const dir = _v.set(ax, aimYOf(e.target), az).sub(muzzle).normalize().clone();
    spawnProjectile({ pos: muzzle, dir, speed: 100, damage: e.damage, team: e.team, life: 1, src: e });
    if (e.team === 'blue') laserSfx(0.03, 2200);
    else laserSfx(0.03, 1300);
  }
}

export function updateEnemyMech(e, dt) {
  const cfg = difficulty().mech;
  e.cool -= dt;
  e.retarget -= dt;
  if (e.aggroT > 0) {
    e.aggroT -= dt;
    if (!e.aggro || !e.aggro.alive) { e.aggro = null; e.aggroT = 0; }
  }
  if (e.retarget <= 0) {
    e.retarget = cfg.retarget;
    // priority: whoever shot us recently > player in sight > close / already-damaged blue turret > blue base
    let t = e.aggroT > 0 ? e.aggro : null;
    if (!t && player.alive && distXZ(e.group.position, player.group.position) < cfg.sight) t = player;
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
  // open fire on the player as soon as they're spotted, while still closing to preferred range
  const fireRange = e.target === player ? cfg.sight : attackRange;
  const clear = !losBlocked(e.group.position.x, e.y + 4.5, e.group.position.z, tp.x, aimYOf(e.target), tp.z);
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
    collideCircle(e.group.position, 2.2, e.y);
    e.walkPhase += dt * 7;
    const sw = Math.sin(e.walkPhase) * 0.55;
    e.model.legL.rotation.x = sw;
    e.model.legR.rotation.x = -sw;

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
  }
  const onGround = updateVertical(e, dt);
  e.group.position.y = e.y + (stepYaw !== null && onGround ? Math.abs(Math.sin(e.walkPhase)) * 0.25 : 0);
  e.px = e.group.position.x;
  e.pz = e.group.position.z;

  // fire: lead moving targets, tighter spread on harder difficulties
  const aimDiff = Math.abs(angDiff(desired, e.yaw));
  if (d < fireRange && clear && aimDiff < 0.25 && e.cool <= 0) {
    e.cool = e.fireInterval * (0.8 + Math.random() * 0.5);
    const muzzle = localToWorld(e, (Math.random() < 0.5 ? -2.2 : 2.2), 4.5, 2.7);
    const tof = d / 70;
    const ax = tp.x + (e.target.velX || 0) * tof * cfg.aimLead;
    const az = tp.z + (e.target.velZ || 0) * tof * cfg.aimLead;
    const spread = (Math.random() - 0.5) * cfg.spread;
    // auto-pitch to the target's level, spread only sideways
    const dir = _v.set(ax - muzzle.x, aimYOf(e.target) - muzzle.y, az - muzzle.z).normalize().clone();
    dir.applyAxisAngle(UP, spread);
    spawnProjectile({ pos: muzzle, dir, speed: 70, damage: e.damage, team: 'red', life: 1.4, src: e });
    laserSfx(0.025, 1100);
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
  // spawn at the level's S markers — main force at the one nearest the red
  // base, flankers rotating through the others
  const rb = redBase.group.position;
  const pts = (LEVEL.enemySpawns.length ? LEVEL.enemySpawns : [{ x: rb.x, z: rb.z + 16 }])
    .slice().sort((a, b) => distXZ(a, rb) - distXZ(b, rb));
  for (let i = 0; i < n; i++) {
    if (w.flank && stats.wave >= 2 && pts.length > 1 && i % 3 === 2) {
      const p = pts[1 + i % (pts.length - 1)];
      makeEnemyMech(p.x + (Math.random() - 0.5) * 6, p.z + (Math.random() - 0.5) * 6);
    } else {
      const x = (i - (n - 1) / 2) * 7;
      makeEnemyMech(pts[0].x + x + (Math.random() - 0.5) * 3, pts[0].z + (Math.random() - 0.5) * 4);
    }
  }
  showMessage(`WAVE ${stats.wave} INCOMING`, '#ff9a5a');
  beep(90, 55, 0.6, 'sawtooth', 0.12);
}
