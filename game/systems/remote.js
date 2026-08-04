import * as THREE from 'three';
import { scene } from '../world/scene.js';
import { MP, on, sendGame, netRegistry } from '../net/net.js';
import { entities, makeBar, makeMech, makeTurretEntity, registerEntity, blueBase, redBase, BLUE, RED } from '../entities/entities.js';
import { player } from '../entities/player.js';
import { spawnProjectile, killEntity, damageEntity } from '../entities/projectiles.js';
import { spawnPointFor, teamIndexOf, animateWalk } from '../core/helpers.js';
import { onFlagMsg } from './ctf.js';
import { groundHeightAt } from '../world/world.js';
import { game } from '../core/state.js';
import { showMessage } from '../ui/hud.js';
import { endGame } from '../core/flow.js';

/* ============================================================
   Multiplayer match sync — up to 5 players per team

   Ownership model: each client simulates only what it owns — its
   player mech, the turrets it built, its projectiles. Everyone
   else's entities exist locally as replicas driven by network
   events (the server stamps each relayed event with the sender's
   playerId, so `from` is trustworthy):

     s        15 Hz state (position/yaw/velocity/hp + turret yaws)
     shot     a projectile was fired → spawn a cosmetic copy
     hit      my projectile hit an entity YOU own → you apply it
     hp       authoritative hp echo after a hit was applied
     bhit     damage to a base — bases are shared (unowned), so the
              shooter applies it and everyone else mirrors it
     build    a turret was built
     die      an entity its owner simulates died → mirror it
     respawn  a player redeployed
     fgrab/fdrop/fret/fcap
              capture the flag: what the sender's mech did with a
              flag. Flags are shared and unowned like the bases, so
              only the client simulating that mech reports it and
              everyone else mirrors it (systems/ctf.js)

   Damage to owned entities is shooter-reported but owner-applied,
   so hp has exactly one authority. Base hp converges because every
   client applies every bhit exactly once.
============================================================ */

/* playerId -> {id, name, team, idx, ent, st, connected} */
export const peers = new Map();

if (MP.active) initMatch();

/* floating pilot name so team fights stay readable */
function makeNameTag(text, team) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 40;
  const ctx = cv.getContext('2d');
  ctx.font = '700 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 5;
  ctx.fillStyle = team === 'red' ? '#ffb3a6' : '#a9c9ff';
  ctx.fillText(text, 128, 21);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false }));
  sp.scale.set(9, 9 * 40 / 256, 1);
  sp.renderOrder = 10;
  return sp;
}

function makePeer(p) {
  const idx = teamIndexOf(p.id, p.team, MP.roster);
  const sp = spawnPointFor(p.team, idx);
  const y = groundHeightAt(sp.pos.x, sp.pos.z);
  const model = makeMech(p.team === 'red' ? RED : BLUE);
  model.group.position.set(sp.pos.x, y, sp.pos.z);
  const yaw = Math.atan2(sp.face.x - sp.pos.x, sp.face.z - sp.pos.z);
  const ent = registerEntity({
    kind: 'mech', team: p.team, group: model.group, model, remote: true, owner: p.id,
    netId: `player:${p.id}`,
    hp: 300, maxHp: 300, alive: true,
    hitRadius: 2.4, hitHeight: 7, bar: makeBar(5), barHeight: 8.2,
    yaw, walkPhase: 0, stride: 0, strideF: 1, strideL: 0, y, vy: 0, velX: 0, velZ: 0,
    anchorX: sp.pos.x, anchorZ: sp.pos.z,
  });
  const tag = makeNameTag(p.name, p.team);
  tag.position.y = 9.6;
  ent.group.add(tag);
  peers.set(p.id, {
    id: p.id, name: p.name, team: p.team, idx, ent, connected: true,
    st: { x: sp.pos.x, z: sp.pos.z, y, yaw, vx: 0, vz: 0, moving: false, age: 0 },
  });
}

function initMatch() {
  for (const p of MP.roster) if (p.id !== MP.playerId) makePeer(p);

  on('game', onGameMsg);
  on('peerLeft', (m) => onPeerLeft(m.id, m.name));
  on('peerJoined', (m) => {
    const p = MP.roster.find((r) => r.id === m.id);
    const peer = peers.get(m.id);
    if (!p || (peer && peer.connected)) return;
    makePeer(p); // fresh replica — the rejoining client restarted from scratch
    if (game.state === 'playing') showMessage(`${p.name} RECONNECTED`, '#8ab4ff');
  });
  on('close', () => {
    if (game.state === 'playing') endGame(false, 'CONNECTION TO SERVER LOST');
  });
}

function onPeerLeft(id, name) {
  const peer = peers.get(id);
  if (!peer || !peer.connected) return;
  peer.connected = false;
  // despawn everything the leaver owned — nobody is left to simulate it,
  // and hits on it would never be applied
  for (const e of [...entities]) {
    if (e.owner === id) {
      e.alive = false;
      scene.remove(e.group);
      const i = entities.indexOf(e);
      if (i >= 0) entities.splice(i, 1);
    }
  }
  if (game.state !== 'playing') return;
  showMessage(`${name || peer.name} DISCONNECTED`, peer.team === MP.myTeam ? '#ff8a7a' : '#8ab4ff');
  if (peer.team === MP.enemyTeam
    && ![...peers.values()].some((o) => o.team === MP.enemyTeam && o.connected)) {
    endGame(true, 'ALL OPPONENTS DISCONNECTED — DISTRICT SECURED');
  }
}

function onGameMsg(d, from) {
  const peer = peers.get(from);
  switch (d.t) {
    case 's': { // a player's state tick
      if (!peer) return;
      const st = peer.st;
      st.x = d.x; st.z = d.z; st.y = d.y; st.yaw = d.yaw;
      st.vx = d.vx; st.vz = d.vz; st.moving = !!d.m; st.age = 0;
      const e = peer.ent;
      if (e.alive && typeof d.hp === 'number') {
        e.hp = d.hp;
        e.bar.set(d.hp / e.maxHp);
      }
      for (const [id, yaw] of d.tu || []) {
        const t = netRegistry.get(id);
        if (t && t.alive && t.head && t.owner === from) { t.yaw = yaw; t.head.rotation.y = yaw; }
      }
      break;
    }
    case 'shot': // cosmetic: real damage arrives as 'hit'/'bhit' from the shooter
      spawnProjectile({
        pos: new THREE.Vector3(d.x, d.y, d.z),
        dir: new THREE.Vector3(d.dx, d.dy, d.dz),
        speed: d.s, damage: 0, team: d.tm, rocket: !!d.r, life: d.l, cosmetic: true,
      });
      break;
    case 'hit': { // a projectile hit an entity I own — I apply it
      const e = netRegistry.get(d.id);
      if (e && e.alive && e.owner === MP.playerId) damageEntity(e, d.d, peer ? peer.ent : null);
      break;
    }
    case 'bhit': { // base damage — shared entity, everyone mirrors the event
      const base = d.tm === 'blue' ? blueBase : redBase;
      if (base.alive) damageEntity(base, d.d, peer ? peer.ent : null);
      break;
    }
    case 'hp': { // authoritative hp of another player's entity after a hit
      const e = netRegistry.get(d.id);
      if (e && e.alive && e.owner === from) {
        e.hp = d.hp;
        if (e.bar) e.bar.set(e.hp / e.maxHp);
      }
      break;
    }
    case 'build': {
      if (!peer || netRegistry.has(d.id)) break;
      const t = makeTurretEntity(peer.team, d.x, d.z, d.id, from);
      t.remote = true;
      break;
    }
    case 'die': { // an entity died on its owner's client — mirror it
      const e = netRegistry.get(d.id);
      if (e && e.alive && e.owner === from) killEntity(e);
      break;
    }
    case 'fgrab': case 'fdrop': case 'fret': case 'fcap':
      onFlagMsg(d); // capture the flag — shared, unowned state
      break;
    case 'respawn': {
      if (!peer) return;
      const e = peer.ent;
      const sp = spawnPointFor(peer.team, peer.idx);
      e.alive = true;
      e.hp = e.maxHp;
      e.bar.set(1);
      e.y = groundHeightAt(sp.pos.x, sp.pos.z);
      e.vy = 0;
      Object.assign(peer.st, { x: sp.pos.x, z: sp.pos.z, y: e.y, vx: 0, vz: 0, moving: false, age: 0 });
      e.group.position.set(sp.pos.x, e.y, sp.pos.z);
      if (!entities.includes(e)) entities.push(e); // killEntity spliced it out
      scene.add(e.group);
      break;
    }
  }
}

/* ---------- per-frame: send my state, animate every replica ---------- */
let sendAcc = 0;
const SEND_DT = 1 / 15;

export function remoteUpdate(dt) {
  if (!MP.active) return;

  if (game.state !== 'menu') {
    sendAcc += dt;
    if (sendAcc >= SEND_DT) {
      sendAcc %= SEND_DT;
      sendState();
    }
  }

  const blink = Math.sin(game.elapsed * 10) > 0;
  for (const peer of peers.values()) {
    const e = peer.ent;
    if (!e.alive) continue;
    const st = peer.st;

    // ease toward the last packet, extrapolated briefly along its velocity
    st.age = Math.min(st.age + dt, 0.25);
    const tx = st.x + st.vx * st.age, tz = st.z + st.vz * st.age;
    const p = e.group.position;
    if (Math.hypot(tx - p.x, tz - p.z) > 14) { p.x = tx; p.z = tz; e.y = st.y; } // snap after teleports
    const k = 1 - Math.exp(-12 * dt);
    p.x += (tx - p.x) * k;
    p.z += (tz - p.z) * k;
    e.y += (st.y - e.y) * Math.min(1, 14 * dt);
    const dyaw = Math.atan2(Math.sin(st.yaw - e.yaw), Math.cos(st.yaw - e.yaw));
    e.yaw += dyaw * Math.min(1, 12 * dt);
    e.group.rotation.y = e.yaw;

    // a replica walks on the ground it actually covers, so legs stop the moment
    // the packets stop coming — a stale "moving" flag can't outlive it — and a
    // strafing peer shuffles sideways just like the pilot flying it sees
    const amp = animateWalk(e, dt, 9);
    // …but the owner's own velocity beats the one measured off the easing
    e.velX = st.vx;
    e.velZ = st.vz;
    p.y = e.y + Math.abs(Math.sin(e.walkPhase)) * 0.25 * amp;

    e.model.lampR.material.emissiveIntensity = blink ? 3 : 0.3;
    e.model.lampB.material.emissiveIntensity = blink ? 0.3 : 3;
  }
}

function sendState() {
  const p = player.group.position;
  const tu = [];
  for (const e of entities) {
    if (e.alive && e.kind === 'turret' && e.owner === MP.playerId && e.netId) {
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
