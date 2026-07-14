import * as THREE from 'three';
import { scene } from '../world/scene.js';
import { groundHeightAt } from '../world/world.js';
import { entities } from './entities.js';
import { game, stats, difficulty } from '../core/state.js';
import { distXZ } from '../core/helpers.js';
import { spawnExplosion, spawnSpark } from './particles.js';
import { boomSfx } from '../systems/audio.js';
import { player } from './player.js';
import { toggleBuildMode } from '../systems/build.js';
import { updateHud } from '../ui/hud.js';
import { endGame } from '../core/flow.js';

/* ============================================================
   Projectiles & damage
============================================================ */
export const projectiles = [];

const tracerGeoBlue = new THREE.BoxGeometry(0.18, 0.18, 1.6);
const tracerMatBlue = new THREE.MeshBasicMaterial({ color: 0xffe27a });
const tracerMatRed = new THREE.MeshBasicMaterial({ color: 0xff5a3a });
const rocketGeo = new THREE.CylinderGeometry(0.28, 0.28, 1.4, 6);
const rocketMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a });
const _look = new THREE.Vector3();

export function spawnProjectile(opts) {
  let mesh;
  if (opts.rocket) {
    mesh = new THREE.Mesh(rocketGeo, rocketMat);
    mesh.rotation.x = Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(mesh);
    mesh = holder;
  } else {
    mesh = new THREE.Mesh(tracerGeoBlue, opts.team === 'blue' ? tracerMatBlue : tracerMatRed);
  }
  mesh.position.copy(opts.pos);
  mesh.lookAt(_look.copy(opts.pos).add(opts.dir));
  scene.add(mesh);
  projectiles.push({
    mesh, pos: mesh.position,
    vel: opts.dir.clone().multiplyScalar(opts.speed),
    team: opts.team, damage: opts.damage, rocket: !!opts.rocket,
    src: opts.src || null, life: opts.life || 3,
  });
}

export function damageEntity(e, dmg, src) {
  if (!e.alive || game.state === 'over') return;
  e.hp -= dmg;
  // mechs retaliate against whoever shot them, even from outside sight range
  if (e.kind === 'mech' && src && src.alive && src.team !== e.team) {
    e.aggro = src;
    e.aggroT = 4;
  }
  if (e.bar) e.bar.set(e.hp / e.maxHp);
  if (e === player) {
    player.lastDamaged = game.elapsed;
    updateHud();
  }
  if (e.kind === 'base') updateHud();
  if (e.hp <= 0) killEntity(e);
}

export function killEntity(e) {
  e.alive = false;
  const p = e.group.position;
  const scale = e.kind === 'base' ? 3 : e.kind === 'turret' ? 1.2 : 1.6;
  spawnExplosion(p.x, e.hitHeight / 2, p.z, scale);
  boomSfx(e.kind === 'base' ? 0.5 : 0.3, e.kind === 'base' ? 0.8 : 0.4);

  if (e.team === 'red') {
    if (e.kind === 'mech') {
      stats.kills++;
      stats.salvage += 40 * difficulty().salvageMult;
      stats.rockets = Math.min(99, stats.rockets + 6);
      stats.ammo += 200;
    } else if (e.kind === 'turret') {
      stats.salvage += 80 * difficulty().salvageMult;
    }
    updateHud();
  }

  if (e.kind === 'base') {
    endGame(e.team === 'red');
    scene.remove(e.group);
    return;
  }

  if (e === player) {
    scene.remove(e.group);
    player.respawnAt = game.elapsed + 4;
    document.getElementById('respawn').style.display = 'block';
    if (game.buildMode) toggleBuildMode();
    return;
  }

  scene.remove(e.group);
  const i = entities.indexOf(e);
  if (i >= 0) entities.splice(i, 1);
}

export function splashDamage(pos, team, radius, maxDmg, src) {
  for (const e of entities) {
    if (!e.alive || e.team === team) continue;
    const ey = e.group.position.y;
    const dy = Math.max(0, Math.abs(pos.y - (ey + e.hitHeight * 0.5)) - e.hitHeight * 0.5);
    const d = distXZ(pos, e.group.position) - e.hitRadius + dy;
    if (d < radius) {
      damageEntity(e, maxDmg * (1 - Math.max(0, d) / radius), src);
    }
  }
}

export function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.pos.addScaledVector(p.vel, dt);
    p.life -= dt;
    let dead = p.life <= 0;
    let boom = false;

    // terrain: ground, walls and cliff sides all stop shots
    if (!dead && p.pos.y < groundHeightAt(p.pos.x, p.pos.z) + 0.15) { dead = true; boom = true; }

    if (!dead) {
      for (const e of entities) {
        if (!e.alive || e.team === p.team) continue;
        const ey = e.group.position.y;
        if (p.pos.y > ey + e.hitHeight + 1 || p.pos.y < ey - 1) continue;
        const dx = p.pos.x - e.group.position.x, dz = p.pos.z - e.group.position.z;
        const r = e.hitRadius + (p.rocket ? 0.6 : 0.25);
        if (dx * dx + dz * dz < r * r) {
          if (p.rocket) boom = true;
          else damageEntity(e, p.damage, p.src);
          dead = true;
          spawnSpark(p.pos);
          break;
        }
      }
    }

    if (dead) {
      if (p.rocket && boom) {
        splashDamage(p.pos, p.team, 9, p.damage, p.src);
        spawnExplosion(p.pos.x, Math.max(1, p.pos.y), p.pos.z, 0.9);
        boomSfx(0.22, 0.3);
      }
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }
}
