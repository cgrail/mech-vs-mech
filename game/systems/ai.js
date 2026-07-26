import * as THREE from 'three';
import { LEVEL, STEP, VOID_EDGE, FALL_DEATH_Y, groundHeightAt } from '../world/world.js';
import { entities, blueBase, redBase, makeEnemyMech } from '../entities/entities.js';
import { game, stats, difficulty } from '../core/state.js';
import { distXZ, losBlocked, localToWorld, nearestEnemyOf, collideCircle, updateVertical, aimYOf, animateWalk, JUMP_V } from '../core/helpers.js';
import { spawnProjectile, killEntity } from '../entities/projectiles.js';
import { spawnFlash } from '../entities/particles.js';
import { hiddenShooter } from './vision.js';
import { ctfOn, ctfGoal } from './ctf.js';
import { beep, laserSfx } from './audio.js';
import { player } from '../entities/player.js';
import { showMessage } from '../ui/hud.js';
import { MP } from '../net/net.js';

/* ============================================================
   AI: turrets + enemy mechs + waves
============================================================ */
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function angDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

/* ---------- navigation probes ----------
   Mechs don't path-find; they look ahead along a heading and hug whatever
   they run into. Every probe samples the mech's full width, not just a
   centre ray — a ray-only probe calls a heading clear that clips the mech's
   shoulder into a corner, which is how they used to grind to a halt. */
const MECH_R = 2.2;      // collision radius the probes have to fit through
const PROBE = 12;        // how far ahead a mech looks for a lane
const JUMP_REACH = 4.5;  // tallest ledge jump jets clear (JUMP_V vs GRAVITY)

/* how far e can walk along `yaw` before a wall or a too-tall ledge stops it.
   Walking down (dropping off an edge) is always allowed. */
function freeDist(e, yaw, max) {
  const p = e.group.position;
  const sx = Math.sin(yaw), cz = Math.cos(yaw);
  const rx = cz, rz = -sx;   // perpendicular: the mech's width
  let y = e.y;
  for (let s = 1.2; s <= max; s += 1.2) {
    const x = p.x + sx * s, z = p.z + cz * s;
    const hc = groundHeightAt(x, z);
    const hl = groundHeightAt(x + rx * MECH_R, z + rz * MECH_R);
    const hr = groundHeightAt(x - rx * MECH_R, z - rz * MECH_R);
    if (Math.max(hc, hl, hr) > y + STEP) return s - 1.2;
    // a chasm under any part of the mech is as impassable as a wall — mechs
    // drop off ledges happily, but there is no bottom to this one
    if (Math.min(hc, hl, hr) < VOID_EDGE) return s - 1.2;
    y = hc;                  // ramps: the walking surface is the centre line
  }
  return max;
}

function clearDir(e, yaw, dist) { return freeDist(e, yaw, dist) >= dist; }

/* the height of the ledge blocking the next few steps along `yaw`, or 0 when
   the way is walkable. Only the first tiles matter: a mech jumps when it is
   about to hit the step, not when it spots one across the map. */
function ledgeAhead(e, yaw) {
  const p = e.group.position;
  const sx = Math.sin(yaw), cz = Math.cos(yaw);
  let y = e.y;
  for (let s = 1.2; s <= 3.6; s += 1.2) {
    const h = groundHeightAt(p.x + sx * s, p.z + cz * s);
    if (h > y + STEP) return h - e.y;
    y = h;
  }
  return 0;
}

/* Steering: walk at the target, and when something is in the way commit to
   one side and follow the obstacle until the straight line opens up again.
   The commitment (e.detourSide, held for at least e.detourT) is what keeps a
   mech from oscillating in front of a wall — the old code re-picked a side
   every frame and jittered until the stuck timer fired a random turn. */
function steerAround(e, desired, dt) {
  if (e.detourT > 0) e.detourT -= dt;
  if (clearDir(e, desired, PROBE)) {
    if (e.detourT <= 0) { e.detourSide = 0; return desired; }
  }
  if (!e.detourSide) {
    // take the roomier side; a tie is broken at random and then stuck with
    const l = freeDist(e, desired + 1.2, PROBE), r = freeDist(e, desired - 1.2, PROBE);
    e.detourSide = l > r ? 1 : r > l ? -1 : (Math.random() < 0.5 ? 1 : -1);
    e.detourT = 0.8;
  }
  for (const off of [0.45, 0.9, 1.35, 1.8, 2.25]) {
    const yaw = desired + e.detourSide * off;
    if (clearDir(e, yaw, PROBE * 0.7)) return yaw;
  }
  return desired + e.detourSide * Math.PI / 2;  // boxed in: slide along the wall
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
    // red turrets lead moving targets on higher difficulties (never in PvP)
    const lead = e.team === 'red' && !MP.active ? difficulty().mech.aimLead : 0;
    const tof = dXZ / 100;
    const ax = tp.x + (e.target.velX || 0) * tof * lead;
    const az = tp.z + (e.target.velZ || 0) * tof * lead;
    const dir = _v.set(ax, aimYOf(e.target), az).sub(muzzle).normalize().clone();
    spawnProjectile({ pos: muzzle, dir, speed: 100, damage: e.damage, team: e.team, life: 1, src: e });
    // fog of war: a flash at a mech I can't see would advertise it (vision.js)
    if (!hiddenShooter(e)) spawnFlash(muzzle, 2.2, e.team === 'blue' ? 0xbfe6ff : 0xffb37a);
    if (e.team === 'blue') laserSfx(0.03, 2200);
    else laserSfx(0.03, 1300);
  }
}

export function updateEnemyMech(e, dt) {
  const cfg = difficulty().mech;
  e.cool -= dt;
  e.retarget -= dt;
  e.jumpCool -= dt;
  if (e.aggroT > 0) {
    e.aggroT -= dt;
    if (!e.aggro || !e.aggro.alive) { e.aggro = null; e.aggroT = 0; }
  }
  if (e.retarget <= 0) {
    e.retarget = cfg.retarget;
    // priority: whoever shot us recently > player in sight > close / already-damaged blue turret > blue base
    let t = e.aggroT > 0 ? e.aggro : null;
    // capture the flag: the objective outranks everything but retaliation —
    // runners fetch the enemy flag, a carrier runs it home, the rest hunt
    // whoever is carrying ours (systems/ctf.js decides which of those it is)
    if (!t && ctfOn()) t = ctfGoal(e);
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
  // a flag (or a flag stand) is walked onto, not shot at, so it pulls the
  // mech all the way in — the pickup/capture radius does the rest
  const attackRange = e.target.kind === 'base' ? 32 : e.target.kind === 'flag' ? 3 : e.range;
  // open fire on the player as soon as they're spotted, while still closing to preferred range
  const fireRange = e.target === player ? cfg.sight : attackRange;
  const clear = !losBlocked(e.group.position.x, e.y + 4.5, e.group.position.z, tp.x, aimYOf(e.target), tp.z);
  const desired = Math.atan2(tp.x - e.group.position.x, tp.z - e.group.position.z);

  const shouldMove = d > attackRange * 0.85 || !clear;

  // steering: head for the target, hugging obstacles in the way. A ledge the
  // jump jets clear is hopped instead of walked around, so high ground and
  // pits stop being AI-proof; mid-jump the mech keeps its nose on the target
  // so it lands where it aimed.
  let steerYaw = desired;   // mid-jump this stays put: fly on toward the target
  if (e.onGround) {
    const rise = shouldMove ? ledgeAhead(e, desired) : 0;
    if (rise > STEP && rise <= JUMP_REACH && e.jumpCool <= 0) {
      e.vy = JUMP_V;
      e.onGround = false;
      e.jumpCool = 1.4;
      e.detourSide = 0;
    } else {
      steerYaw = steerAround(e, desired, dt);
    }
  }
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

  // in a firefight the guns stay on the target and the mech side-steps along
  // its steering heading; out of contact it faces where it is marching
  const engaging = clear && d < fireRange;
  const faceYaw = shouldMove && !engaging ? steerYaw : desired;
  const turn = 3.2 * dt;
  const fd = angDiff(faceYaw, e.yaw);
  e.yaw += Math.max(-turn, Math.min(turn, fd));
  e.group.rotation.y = e.yaw;

  if (stepYaw !== null) {
    const spd = shouldMove ? e.speed : e.speed * 0.6;
    // marching mechs walk where they look; anything else sidesteps
    const moveYaw = shouldMove && !engaging ? e.yaw : stepYaw;
    e.group.position.x += Math.sin(moveYaw) * spd * dt;
    e.group.position.z += Math.cos(moveYaw) * spd * dt;
    collideCircle(e.group.position, 2.2, e.y);

    // barely moving? the side it committed to is a dead end — follow the wall
    // the other way round instead of grinding into it
    const stepped = Math.hypot(e.group.position.x - e.px, e.group.position.z - e.pz);
    if (shouldMove && stepped < spd * dt * 0.25) {
      e.stuckT += dt;
      if (e.stuckT > 0.6) {
        e.stuckT = 0;
        e.detourSide = -(e.detourSide || (Math.random() < 0.5 ? 1 : -1));
        e.detourT = 1.2;
      }
    } else {
      e.stuckT = 0;
    }
  }
  const onGround = updateVertical(e, dt);
  e.onGround = onGround;
  if (e.y < FALL_DEATH_Y) { killEntity(e); return; }   // pushed into a chasm

  // stride off what the mech covered, not off what it tried to do: one holding
  // its ground in a firefight, or leaning on a wall, plants its feet — and one
  // side-stepping a target shuffles sideways rather than marching in place
  const amp = animateWalk(e, e.group.position.x - e.px, e.group.position.z - e.pz, dt, 7);
  e.group.position.y = e.y + (onGround ? Math.abs(Math.sin(e.walkPhase)) * 0.25 * amp : 0);
  e.px = e.group.position.x;
  e.pz = e.group.position.z;

  // fire: lead moving targets, tighter spread on harder difficulties
  const aimDiff = Math.abs(angDiff(desired, e.yaw));
  if (d < fireRange && clear && aimDiff < 0.25 && e.cool <= 0 && e.target.kind !== 'flag') {
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
    if (!hiddenShooter(e)) spawnFlash(muzzle, 2.2, 0xffb37a); // hidden shooter: no flash (vision.js)
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
    let m;
    if (w.flank && stats.wave >= 2 && pts.length > 1 && i % 3 === 2) {
      const p = pts[1 + i % (pts.length - 1)];
      m = makeEnemyMech(p.x + (Math.random() - 0.5) * 6, p.z + (Math.random() - 0.5) * 6);
    } else {
      const x = (i - (n - 1) / 2) * 7;
      m = makeEnemyMech(pts[0].x + x + (Math.random() - 0.5) * 3, pts[0].z + (Math.random() - 0.5) * 4);
    }
    // capture the flag: every other mech of a wave goes for the flag, the
    // rest fight — a whole wave rushing the stand leaves nobody defending
    m.flagRunner = i % 2 === 0;
  }
  showMessage(`WAVE ${stats.wave} INCOMING`, '#ff9a5a');
  beep(90, 55, 0.6, 'sawtooth', 0.12);
}
