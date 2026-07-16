import * as THREE from 'three';
import { scene } from '../world/scene.js';
import { MP, on, sendGame, netRegistry } from '../net/net.js';
import { entities, makeBar, makeMech, makeTurretEntity, registerEntity, BLUE, RED } from '../entities/entities.js';
import { player } from '../entities/player.js';
import { spawnProjectile, killEntity, damageEntity } from '../entities/projectiles.js';
import { spawnPointFor } from '../core/helpers.js';
import { groundHeightAt } from '../world/world.js';
import { game } from '../core/state.js';
import { updateHud, showMessage } from '../ui/hud.js';
import { endGame } from '../core/flow.js';

/* ============================================================
   Multiplayer match sync

   Ownership model: each client simulates only its own side —
   its player, its turrets, its projectiles. The opponent's side
   exists locally as replicas driven by network events:

     s        15 Hz state (position/yaw/velocity/hp + turret yaws)
     shot     a projectile was fired → spawn a cosmetic copy
     hit      my projectile hit one of YOUR entities → you apply it
     hp       authoritative hp echo after a hit was applied
     build    a turret was built
     die      one of my entities died → play its death on your side
     respawn  my player redeployed

   Damage is therefore shooter-reported but owner-applied: nothing
   ever damages a replica locally, so both clients agree on hp.
============================================================ */

/* opponent replica: a mech whose position is driven by the network */
export let remotePlayer = null;
const rp = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, moving: false, age: 0 };

if (MP.active) initMatch();

function initMatch() {
  const sp = spawnPointFor(MP.enemyTeam);
  const y = groundHeightAt(sp.pos.x, sp.pos.z);
  const model = makeMech(MP.enemyTeam === 'red' ? RED : BLUE);
  model.group.position.set(sp.pos.x, y, sp.pos.z);
  remotePlayer = registerEntity({
    kind: 'mech', team: MP.enemyTeam, group: model.group, model, remote: true,
    netId: `player:${MP.enemyTeam}`,
    hp: 300, maxHp: 300, alive: true,
    hitRadius: 2.4, hitHeight: 7, bar: makeBar(5), barHeight: 8.2,
    yaw: Math.atan2(sp.face.x - sp.pos.x, sp.face.z - sp.pos.z),
    walkPhase: 0, y, vy: 0, velX: 0, velZ: 0,
  });
  Object.assign(rp, { x: sp.pos.x, z: sp.pos.z, y, yaw: remotePlayer.yaw });

  on('game', onGameMsg);
  on('opponentLeft', () => {
    if (game.state === 'playing') {
      showMessage('OPPONENT DISCONNECTED', '#7CFF6B');
      endGame(true, 'OPPONENT DISCONNECTED — DISTRICT SECURED');
    }
  });
  on('close', () => {
    if (game.state === 'playing') endGame(false, 'CONNECTION TO SERVER LOST');
  });
}

function onGameMsg(d) {
  switch (d.t) {
    case 's': { // opponent state tick
      rp.x = d.x; rp.z = d.z; rp.y = d.y; rp.yaw = d.yaw;
      rp.vx = d.vx; rp.vz = d.vz; rp.moving = !!d.m; rp.age = 0;
      if (remotePlayer.alive && typeof d.hp === 'number') {
        remotePlayer.hp = d.hp;
        remotePlayer.bar.set(d.hp / remotePlayer.maxHp);
      }
      for (const [id, yaw] of d.tu || []) {
        const t = netRegistry.get(id);
        if (t && t.alive && t.head) { t.yaw = yaw; t.head.rotation.y = yaw; }
      }
      break;
    }
    case 'shot': // cosmetic: real damage arrives as 'hit' from the shooter
      spawnProjectile({
        pos: new THREE.Vector3(d.x, d.y, d.z),
        dir: new THREE.Vector3(d.dx, d.dy, d.dz),
        speed: d.s, damage: 0, team: d.tm, rocket: !!d.r, life: d.l, cosmetic: true,
      });
      break;
    case 'hit': { // opponent's projectile hit one of MY entities — apply it
      const e = netRegistry.get(d.id);
      if (e && e.alive && e.team === MP.myTeam) damageEntity(e, d.d, remotePlayer);
      break;
    }
    case 'hp': { // authoritative hp of an opponent entity after my hit landed
      const e = netRegistry.get(d.id);
      if (e && e.alive && e.team === MP.enemyTeam) {
        e.hp = d.hp;
        if (e.bar) e.bar.set(e.hp / e.maxHp);
        if (e.kind === 'base') updateHud();
      }
      break;
    }
    case 'build': {
      if (netRegistry.has(d.id)) break;
      const t = makeTurretEntity(MP.enemyTeam, d.x, d.z, d.id);
      t.remote = true;
      break;
    }
    case 'die': { // an opponent entity died on its own client — mirror it
      const e = netRegistry.get(d.id);
      if (e && e.alive && e.team === MP.enemyTeam) killEntity(e);
      break;
    }
    case 'respawn': {
      const e = remotePlayer;
      const sp = spawnPointFor(MP.enemyTeam);
      e.alive = true;
      e.hp = e.maxHp;
      e.bar.set(1);
      e.y = groundHeightAt(sp.pos.x, sp.pos.z);
      e.vy = 0;
      Object.assign(rp, { x: sp.pos.x, z: sp.pos.z, y: e.y, vx: 0, vz: 0, moving: false, age: 0 });
      e.group.position.set(sp.pos.x, e.y, sp.pos.z);
      if (!entities.includes(e)) entities.push(e); // killEntity spliced it out
      scene.add(e.group);
      break;
    }
  }
}

/* ---------- per-frame: send my state, animate the replica ---------- */
let sendAcc = 0;
const SEND_DT = 1 / 15;

export function remoteUpdate(dt) {
  if (!MP.active || !remotePlayer) return;

  if (game.state !== 'menu') {
    sendAcc += dt;
    if (sendAcc >= SEND_DT) {
      sendAcc %= SEND_DT;
      sendState();
    }
  }

  const e = remotePlayer;
  if (!e.alive) return;

  // ease toward the last packet, extrapolated briefly along its velocity
  rp.age = Math.min(rp.age + dt, 0.25);
  const tx = rp.x + rp.vx * rp.age, tz = rp.z + rp.vz * rp.age;
  const p = e.group.position;
  if (Math.hypot(tx - p.x, tz - p.z) > 14) { p.x = tx; p.z = tz; e.y = rp.y; } // snap after teleports
  const k = 1 - Math.exp(-12 * dt);
  p.x += (tx - p.x) * k;
  p.z += (tz - p.z) * k;
  e.y += (rp.y - e.y) * Math.min(1, 14 * dt);
  const dyaw = Math.atan2(Math.sin(rp.yaw - e.yaw), Math.cos(rp.yaw - e.yaw));
  e.yaw += dyaw * Math.min(1, 12 * dt);
  e.group.rotation.y = e.yaw;
  e.velX = rp.vx;
  e.velZ = rp.vz;

  if (rp.moving) e.walkPhase += dt * 9;
  const sw = rp.moving ? Math.sin(e.walkPhase) * 0.55 : 0;
  e.model.legL.rotation.x = sw;
  e.model.legR.rotation.x = -sw;
  p.y = e.y + (rp.moving ? Math.abs(Math.sin(e.walkPhase)) * 0.25 : 0);

  const blink = Math.sin(game.elapsed * 10) > 0;
  e.model.lampR.material.emissiveIntensity = blink ? 3 : 0.3;
  e.model.lampB.material.emissiveIntensity = blink ? 0.3 : 3;
}

function sendState() {
  const p = player.group.position;
  const tu = [];
  for (const e of entities) {
    if (e.alive && e.kind === 'turret' && !e.remote && e.team === MP.myTeam && e.netId) {
      tu.push([e.netId, +e.yaw.toFixed(2)]);
    }
  }
  sendGame({
    t: 's',
    x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: +player.y.toFixed(2),
    yaw: +player.yaw.toFixed(3),
    vx: +player.velX.toFixed(1), vz: +player.velZ.toFixed(1),
    hp: Math.round(player.hp),
    m: player.velX || player.velZ ? 1 : 0,
    tu,
  });
}
