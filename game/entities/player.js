import * as THREE from 'three';
import { scene } from '../world/scene.js';
import { BLUE, entities, makeBar, makeMech, registerEntity } from './entities.js';
import { game, stats, touch } from '../core/state.js';
import { keys } from '../systems/input.js';
import { LEVEL, groundHeightAt } from '../world/world.js';
import { forwardOf, localToWorld, losBlocked, collideCircle, updateVertical, aimYOf } from '../core/helpers.js';
import { spawnProjectile } from './projectiles.js';
import { beep, laserSfx } from '../systems/audio.js';
import { updateHud, showMessage } from '../ui/hud.js';

/* ============================================================
   Player entity
============================================================ */
export const playerModel = makeMech(BLUE);
const playerBar = makeBar(5);
const SPAWN = LEVEL.playerSpawn;
const spawnYaw = Math.atan2(LEVEL.redBase.x - SPAWN.x, LEVEL.redBase.z - SPAWN.z); // face the enemy base
export const player = registerEntity({
  kind: 'player', team: 'blue', group: playerModel.group, model: playerModel,
  hp: 300, maxHp: 300, alive: true,
  hitRadius: 2.4, hitHeight: 7, bar: playerBar, barHeight: 8.2,
  yaw: spawnYaw, walkPhase: 0, velX: 0, velZ: 0,
  y: groundHeightAt(SPAWN.x, SPAWN.z), vy: 0,
  gunCool: 0, rocketCool: 0, lastDamaged: -99, respawnAt: 0,
});
player.group.position.set(SPAWN.x, player.y, SPAWN.z);

/* ============================================================
   Player combat & movement
============================================================ */
function findAimTarget(muzzle, yaw) {
  // Future-Cop style aim assist: snap to best enemy in a narrow cone
  let best = null, bestAng = 0.16;
  for (const e of entities) {
    if (!e.alive || e.team === 'blue') continue;
    const dx = e.group.position.x - muzzle.x, dz = e.group.position.z - muzzle.z;
    const d = Math.hypot(dx, dz);
    if (d > 75 || d < 2) continue;
    const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - yaw), Math.cos(Math.atan2(dx, dz) - yaw)));
    if (ang < bestAng + (e.kind === 'base' ? 0.1 : 0)) {
      if (losBlocked(muzzle.x, muzzle.y, muzzle.z, e.group.position.x, aimYOf(e), e.group.position.z)) continue;
      bestAng = ang; best = e;
    }
  }
  return best;
}

export function selectWeapon(n) {
  if (n === 2 && stats.rockets <= 0) {
    beep(140, 90, 0.15, 'square', 0.1);
    showMessage('OUT OF ROCKETS', '#ff8a7a');
    return;
  }
  if (game.weapon !== n) beep(700, 1000, 0.05, 'sine', 0.06);
  game.weapon = n;
  updateHud();
}

let gunSide = 1;
export function firePlayerGun() {
  if (player.gunCool > 0 || stats.ammo <= 0) return;
  player.gunCool = 0.11;
  stats.ammo--;
  gunSide = -gunSide;
  const muzzle = localToWorld(player, 2.2 * gunSide, 4.5, 2.7);
  const target = findAimTarget(muzzle, player.yaw);
  const dir = new THREE.Vector3();
  if (target) {
    // guns auto-pitch to the target's level
    dir.set(target.group.position.x, aimYOf(target), target.group.position.z).sub(muzzle).normalize();
  } else {
    dir.copy(forwardOf(player.yaw));
  }
  spawnProjectile({ pos: muzzle, dir, speed: 130, damage: 9, team: 'blue', life: 1.2, src: player });
  laserSfx(0.06, 1800);
  updateHud();
}

export function fireRocket() {
  if (!player.alive || player.rocketCool > 0 || stats.rockets <= 0 || game.buildMode) return;
  player.rocketCool = 0.55;
  stats.rockets--;
  if (stats.rockets <= 0 && game.weapon === 2) {
    game.weapon = 1;
    showMessage('OUT OF ROCKETS — MACHINE GUNS', '#8ab4ff');
  }
  const muzzle = localToWorld(player, 0, 4.8, 2.2);
  const target = findAimTarget(muzzle, player.yaw);
  const dir = new THREE.Vector3();
  if (target) {
    dir.set(target.group.position.x, aimYOf(target), target.group.position.z).sub(muzzle).normalize();
  } else {
    dir.copy(forwardOf(player.yaw));
  }
  spawnProjectile({ pos: muzzle, dir, speed: 60, damage: 60, team: 'blue', rocket: true, life: 3, src: player });
  beep(160, 40, 0.35, 'sawtooth', 0.12);
  updateHud();
}

export function updatePlayer(dt) {
  if (!player.alive) {
    if (game.elapsed >= player.respawnAt) respawnPlayer();
    return;
  }
  const boost = keys['ShiftLeft'] || keys['ShiftRight'] ? 1.65 : 1;
  const speed = 16 * boost;
  if (keys['ArrowLeft']) player.yaw += 2.4 * dt;
  if (keys['ArrowRight']) player.yaw -= 2.4 * dt;
  if (touch.yaw !== null) {
    // ease toward the compass heading along the shortest arc
    const d = Math.atan2(Math.sin(touch.yaw - player.yaw), Math.cos(touch.yaw - player.yaw));
    player.yaw += d * Math.min(1, 10 * dt);
  }
  const fwd = forwardOf(player.yaw).clone();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const move = new THREE.Vector3();
  if (keys['KeyW'] || keys['ArrowUp'] || touch.move > 0) move.add(fwd);
  if (keys['KeyS'] || keys['ArrowDown'] || touch.move < 0) move.sub(fwd);
  if (keys['KeyA'] || touch.strafe < 0) move.sub(right);
  if (keys['KeyD'] || touch.strafe > 0) move.add(right);

  const moving = move.lengthSq() > 0;
  if (moving) {
    move.normalize();
    player.group.position.addScaledVector(move, speed * dt);
    player.walkPhase += dt * 9 * boost;
  }
  // tracked so enemy AI can lead its shots
  player.velX = moving ? move.x * speed : 0;
  player.velZ = moving ? move.z * speed : 0;
  collideCircle(player.group.position, 2.2, player.y);
  const onGround = updateVertical(player, dt);
  player.group.rotation.y = player.yaw;

  // walk animation + bob
  const sw = moving ? Math.sin(player.walkPhase) * 0.55 : 0;
  playerModel.legL.rotation.x = sw;
  playerModel.legR.rotation.x = -sw;
  player.group.position.y = player.y + (moving && onGround ? Math.abs(Math.sin(player.walkPhase)) * 0.25 : 0);

  // police light blink
  const blink = Math.sin(game.elapsed * 10) > 0;
  playerModel.lampR.material.emissiveIntensity = blink ? 3 : 0.3;
  playerModel.lampB.material.emissiveIntensity = blink ? 0.3 : 3;

  player.gunCool -= dt;
  player.rocketCool -= dt;
  if ((game.mouseDown || keys['Space']) && !game.buildMode) {
    if (game.weapon === 2) fireRocket(); else firePlayerGun();
  }

  // slow self-repair after 5s without damage
  if (player.hp < player.maxHp && game.elapsed - player.lastDamaged > 5) {
    player.hp = Math.min(player.maxHp, player.hp + 9 * dt);
    player.bar.set(player.hp / player.maxHp);
    updateHud();
  }
}

function respawnPlayer() {
  player.alive = true;
  player.hp = player.maxHp;
  player.bar.set(1);
  player.yaw = spawnYaw;
  player.y = groundHeightAt(SPAWN.x, SPAWN.z);
  player.vy = 0;
  player.group.position.set(SPAWN.x, player.y, SPAWN.z);
  scene.add(player.group);
  document.getElementById('respawn').style.display = 'none';
  showMessage('MECH REDEPLOYED', '#8ab4ff');
  updateHud();
}
