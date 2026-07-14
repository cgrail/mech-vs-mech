import * as THREE from 'three';
import { ARENA, obstacles, createWorld } from './world.js';
import {
  BLUE, entities, initEntities, makeBar, makeMech, makeTurretModel,
  registerEntity, makeBaseEntity, makeTurretEntity, makeEnemyMech,
} from './entities.js';

/* ============================================================
   Basic setup
============================================================ */
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d16);
scene.fog = new THREE.Fog(0x0b0d16, 90, 280);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 40, 140);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* lights */
scene.add(new THREE.HemisphereLight(0x9db4d8, 0x2a2c22, 0.85));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
sun.position.set(60, 120, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -160; sun.shadow.camera.right = 160;
sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160;
sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0004;
scene.add(sun);

/* ============================================================
   World & entities
============================================================ */
initEntities(scene);
createWorld(scene);

/* ============================================================
   Audio (tiny synth)
============================================================ */
let AC = null;
function audioCtx() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  return AC;
}
function beep(f, f2, dur, type, vol) {
  try {
    const a = audioCtx();
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start(); o.stop(a.currentTime + dur);
  } catch (e) { /* audio unavailable */ }
}
function boomSfx(vol, dur) {
  try {
    const a = audioCtx();
    const src = a.createBufferSource();
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    src.buffer = buf;
    const g = a.createGain(); g.gain.value = vol;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  } catch (e) { /* audio unavailable */ }
}

const projectiles = [];
const particles = [];

/* bases + enemy defense turrets */
const blueBase = makeBaseEntity('blue', 112);
const redBase = makeBaseEntity('red', -112);
makeTurretEntity('red', -17, -98);
makeTurretEntity('red', 17, -98);
makeTurretEntity('red', 0, -86);

/* ============================================================
   Player
============================================================ */
const playerModel = makeMech(BLUE);
const playerBar = makeBar(5);
const player = registerEntity({
  kind: 'player', team: 'blue', group: playerModel.group, model: playerModel,
  hp: 300, maxHp: 300, alive: true,
  hitRadius: 2.4, hitHeight: 7, bar: playerBar, barHeight: 8.2,
  yaw: Math.PI, walkPhase: 0,
  gunCool: 0, rocketCool: 0, lastDamaged: -99, respawnAt: 0,
});
player.group.position.set(0, 0, 92);

const stats = {
  salvage: 150, ammo: 6552, rockets: 30,
  turretsBuilt: 0, kills: 0, wave: 0,
};

/* ============================================================
   Input
============================================================ */
const keys = {};
let mouseDown = false;
let pointerLocked = false;
let buildMode = false;
let state = 'menu'; // menu | playing | over

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (state !== 'playing') return;
  if (e.code === 'KeyB') toggleBuildMode();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());

renderer.domElement.addEventListener('mousedown', (e) => {
  if (state !== 'playing') return;
  if (!pointerLocked) { renderer.domElement.requestPointerLock(); return; }
  if (e.button === 0) {
    if (buildMode) { tryPlaceTurret(); return; }
    mouseDown = true;
  } else if (e.button === 2) {
    if (buildMode) { toggleBuildMode(); return; }
    fireRocket();
  }
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  if (!pointerLocked) mouseDown = false;
});
document.addEventListener('mousemove', (e) => {
  if (!pointerLocked || state !== 'playing' || !player.alive) return;
  player.yaw -= e.movementX * 0.0026;
});

/* ============================================================
   Helpers
============================================================ */
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function forwardOf(yaw) { return _v1.set(Math.sin(yaw), 0, Math.cos(yaw)); }

function localToWorld(e, ox, oy, oz, out) {
  const s = Math.sin(e.yaw), c = Math.cos(e.yaw);
  return (out || new THREE.Vector3()).set(
    e.group.position.x + ox * c + oz * s,
    e.group.position.y + oy,
    e.group.position.z - ox * s + oz * c
  );
}

function distXZ(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

function losBlocked(ax, az, bx, bz, y) {
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

function nearestEnemyOf(team, pos, range, opts) {
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
function collideCircle(pos, r) {
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
function separateMechs() {
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

/* ============================================================
   Projectiles & damage
============================================================ */
const tracerGeoBlue = new THREE.BoxGeometry(0.18, 0.18, 1.6);
const tracerMatBlue = new THREE.MeshBasicMaterial({ color: 0xffe27a });
const tracerMatRed = new THREE.MeshBasicMaterial({ color: 0xff5a3a });
const rocketGeo = new THREE.CylinderGeometry(0.28, 0.28, 1.4, 6);
const rocketMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a });

function spawnProjectile(opts) {
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
  mesh.lookAt(_v2.copy(opts.pos).add(opts.dir));
  scene.add(mesh);
  projectiles.push({
    mesh, pos: mesh.position,
    vel: opts.dir.clone().multiplyScalar(opts.speed),
    team: opts.team, damage: opts.damage, rocket: !!opts.rocket,
    life: opts.life || 3,
  });
}

function damageEntity(e, dmg) {
  if (!e.alive || state === 'over') return;
  e.hp -= dmg;
  if (e.bar) e.bar.set(e.hp / e.maxHp);
  if (e === player) {
    player.lastDamaged = elapsed;
    updateHud();
  }
  if (e.kind === 'base') updateHud();
  if (e.hp <= 0) killEntity(e);
}

function killEntity(e) {
  e.alive = false;
  const p = e.group.position;
  const scale = e.kind === 'base' ? 3 : e.kind === 'turret' ? 1.2 : 1.6;
  spawnExplosion(p.x, e.hitHeight / 2, p.z, scale);
  boomSfx(e.kind === 'base' ? 0.5 : 0.3, e.kind === 'base' ? 0.8 : 0.4);

  if (e.team === 'red') {
    if (e.kind === 'mech') {
      stats.kills++;
      stats.salvage += 40;
      stats.rockets = Math.min(99, stats.rockets + 6);
      stats.ammo += 200;
    } else if (e.kind === 'turret') {
      stats.salvage += 80;
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
    player.respawnAt = elapsed + 4;
    document.getElementById('respawn').style.display = 'block';
    if (buildMode) toggleBuildMode();
    return;
  }

  scene.remove(e.group);
  const i = entities.indexOf(e);
  if (i >= 0) entities.splice(i, 1);
}

function splashDamage(pos, team, radius, maxDmg) {
  for (const e of entities) {
    if (!e.alive || e.team === team) continue;
    const d = distXZ(pos, e.group.position) - e.hitRadius;
    if (d < radius) {
      damageEntity(e, maxDmg * (1 - Math.max(0, d) / radius));
    }
  }
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.pos.addScaledVector(p.vel, dt);
    p.life -= dt;
    let dead = p.life <= 0;
    let boom = false;

    if (!dead && p.pos.y < 0.15) { dead = true; boom = true; }

    if (!dead) {
      for (const o of obstacles) {
        if (p.pos.y < o.h && Math.abs(p.pos.x - o.x) < o.hw && Math.abs(p.pos.z - o.z) < o.hd) {
          dead = true; boom = true; break;
        }
      }
    }

    if (!dead) {
      for (const e of entities) {
        if (!e.alive || e.team === p.team) continue;
        if (p.pos.y > e.hitHeight + 1) continue;
        const dx = p.pos.x - e.group.position.x, dz = p.pos.z - e.group.position.z;
        const r = e.hitRadius + (p.rocket ? 0.6 : 0.25);
        if (dx * dx + dz * dz < r * r) {
          if (p.rocket) boom = true;
          else damageEntity(e, p.damage);
          dead = true;
          spawnSpark(p.pos);
          break;
        }
      }
    }

    if (dead) {
      if (p.rocket && boom) {
        splashDamage(p.pos, p.team, 9, p.damage);
        spawnExplosion(p.pos.x, Math.max(1, p.pos.y), p.pos.z, 0.9);
        boomSfx(0.22, 0.3);
      }
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }
}

/* ============================================================
   Explosions / particles
============================================================ */
const fragGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
const fragMats = [
  new THREE.MeshBasicMaterial({ color: 0xffd23c }),
  new THREE.MeshBasicMaterial({ color: 0xff7a2a }),
  new THREE.MeshBasicMaterial({ color: 0xff3a1a }),
  new THREE.MeshBasicMaterial({ color: 0x555555 }),
];

function spawnExplosion(x, y, z, scale) {
  const n = Math.floor(10 * scale) + 6;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(fragGeo, fragMats[Math.floor(Math.random() * fragMats.length)]);
    m.position.set(x, y, z);
    m.scale.setScalar(scale * (0.5 + Math.random()));
    scene.add(m);
    particles.push({
      mesh: m,
      vel: new THREE.Vector3((Math.random() - 0.5) * 18 * scale, Math.random() * 16 * scale + 4, (Math.random() - 0.5) * 18 * scale),
      spin: (Math.random() - 0.5) * 10,
      life: 0.7 + Math.random() * 0.5,
    });
  }
  const light = new THREE.PointLight(0xffa040, 300 * scale, 40 * scale);
  light.position.set(x, y + 2, z);
  scene.add(light);
  particles.push({ light, life: 0.25 });
}

function spawnSpark(pos) {
  const m = new THREE.Mesh(fragGeo, fragMats[0]);
  m.position.copy(pos);
  m.scale.setScalar(0.5);
  scene.add(m);
  particles.push({
    mesh: m,
    vel: new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8),
    spin: 8, life: 0.25,
  });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.light) {
      p.light.intensity *= Math.max(0, p.life / 0.25);
      if (p.life <= 0) { scene.remove(p.light); particles.splice(i, 1); }
      continue;
    }
    p.vel.y -= 40 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.rotation.x += p.spin * dt;
    p.mesh.rotation.y += p.spin * dt * 0.7;
    if (p.mesh.position.y < 0.2) { p.mesh.position.y = 0.2; p.vel.y *= -0.35; p.vel.x *= 0.7; p.vel.z *= 0.7; }
    if (p.life <= 0) { scene.remove(p.mesh); particles.splice(i, 1); }
  }
}

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
      if (losBlocked(muzzle.x, muzzle.z, e.group.position.x, e.group.position.z, 3)) continue;
      bestAng = ang; best = e;
    }
  }
  return best;
}

let gunSide = 1;
function firePlayerGun() {
  if (player.gunCool > 0 || stats.ammo <= 0) return;
  player.gunCool = 0.11;
  stats.ammo--;
  gunSide = -gunSide;
  const muzzle = localToWorld(player, 2.2 * gunSide, 4.5, 2.7);
  const target = findAimTarget(muzzle, player.yaw);
  const dir = new THREE.Vector3();
  if (target) {
    dir.set(target.group.position.x, Math.min(3.5, target.hitHeight * 0.55), target.group.position.z).sub(muzzle).normalize();
  } else {
    dir.copy(forwardOf(player.yaw));
  }
  spawnProjectile({ pos: muzzle, dir, speed: 130, damage: 9, team: 'blue', life: 1.2 });
  beep(300, 90, 0.07, 'square', 0.05);
  updateHud();
}

function fireRocket() {
  if (!player.alive || player.rocketCool > 0 || stats.rockets <= 0 || buildMode) return;
  player.rocketCool = 0.55;
  stats.rockets--;
  const muzzle = localToWorld(player, 0, 4.8, 2.2);
  const target = findAimTarget(muzzle, player.yaw);
  const dir = new THREE.Vector3();
  if (target) {
    dir.set(target.group.position.x, Math.min(4, target.hitHeight * 0.5), target.group.position.z).sub(muzzle).normalize();
  } else {
    dir.copy(forwardOf(player.yaw));
  }
  spawnProjectile({ pos: muzzle, dir, speed: 60, damage: 60, team: 'blue', rocket: true, life: 3 });
  beep(160, 40, 0.35, 'sawtooth', 0.12);
  updateHud();
}

function updatePlayer(dt) {
  if (!player.alive) {
    if (elapsed >= player.respawnAt) respawnPlayer();
    return;
  }
  const boost = keys['ShiftLeft'] || keys['ShiftRight'] ? 1.65 : 1;
  const speed = 16 * boost;
  const fwd = forwardOf(player.yaw).clone();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const move = new THREE.Vector3();
  if (keys['KeyW']) move.add(fwd);
  if (keys['KeyS']) move.sub(fwd);
  if (keys['KeyA']) move.sub(right);
  if (keys['KeyD']) move.add(right);

  const moving = move.lengthSq() > 0;
  if (moving) {
    move.normalize();
    player.group.position.addScaledVector(move, speed * dt);
    player.walkPhase += dt * 9 * boost;
  }
  collideCircle(player.group.position, 2.2);
  player.group.rotation.y = player.yaw;

  // walk animation + bob
  const sw = moving ? Math.sin(player.walkPhase) * 0.55 : 0;
  playerModel.legL.rotation.x = sw;
  playerModel.legR.rotation.x = -sw;
  player.group.position.y = moving ? Math.abs(Math.sin(player.walkPhase)) * 0.25 : 0;

  // police light blink
  const blink = Math.sin(elapsed * 10) > 0;
  playerModel.lampR.material.emissiveIntensity = blink ? 3 : 0.3;
  playerModel.lampB.material.emissiveIntensity = blink ? 0.3 : 3;

  player.gunCool -= dt;
  player.rocketCool -= dt;
  if (mouseDown && !buildMode) firePlayerGun();

  // slow self-repair after 5s without damage
  if (player.hp < player.maxHp && elapsed - player.lastDamaged > 5) {
    player.hp = Math.min(player.maxHp, player.hp + 9 * dt);
    player.bar.set(player.hp / player.maxHp);
    updateHud();
  }
}

function respawnPlayer() {
  player.alive = true;
  player.hp = player.maxHp;
  player.bar.set(1);
  player.yaw = Math.PI;
  player.group.position.set(0, 0, 92);
  scene.add(player.group);
  document.getElementById('respawn').style.display = 'none';
  showMessage('MECH REDEPLOYED', '#8ab4ff');
  updateHud();
}

/* ============================================================
   Build mode
============================================================ */
const TURRET_COST = 100;
let ghost = null;
const ghostOk = new THREE.MeshBasicMaterial({ color: 0x39d353, transparent: true, opacity: 0.45 });
const ghostBad = new THREE.MeshBasicMaterial({ color: 0xd33939, transparent: true, opacity: 0.45 });
const buildHintEl = document.getElementById('buildHint');

function toggleBuildMode() {
  buildMode = !buildMode;
  if (buildMode && !player.alive) { buildMode = false; return; }
  if (buildMode) {
    const model = makeTurretModel(BLUE);
    model.group.traverse((o) => { if (o.isMesh) { o.material = ghostOk; o.castShadow = false; } });
    ghost = model.group;
    scene.add(ghost);
    buildHintEl.style.display = 'block';
    beep(600, 900, 0.08, 'sine', 0.08);
  } else {
    if (ghost) scene.remove(ghost);
    ghost = null;
    buildHintEl.style.display = 'none';
  }
}

function ghostPos() {
  return localToWorld(player, 0, 0, 9, _v2).clone();
}

function buildPosValid(p) {
  if (Math.abs(p.x) > ARENA.hw - 4 || Math.abs(p.z) > ARENA.hd - 4) return false;
  for (const o of obstacles) {
    if (Math.abs(p.x - o.x) < o.hw + 2.5 && Math.abs(p.z - o.z) < o.hd + 2.5) return false;
  }
  for (const e of entities) {
    if (!e.alive || e === player) continue;
    if (distXZ(p, e.group.position) < e.hitRadius + 4) return false;
  }
  return true;
}

function updateGhost() {
  if (!buildMode || !ghost) return;
  const p = ghostPos();
  ghost.position.set(p.x, 0, p.z);
  const valid = buildPosValid(p);
  const afford = stats.salvage >= TURRET_COST;
  const mat = valid && afford ? ghostOk : ghostBad;
  ghost.traverse((o) => { if (o.isMesh) o.material = mat; });
  buildHintEl.classList.toggle('bad', !(valid && afford));
  buildHintEl.textContent = !afford
    ? `NOT ENOUGH SALVAGE — NEED 🛢️ ${TURRET_COST}`
    : valid
      ? `BUILD TURRET HERE — LMB TO CONFIRM (🛢️ ${TURRET_COST})`
      : 'INVALID POSITION — TOO CLOSE TO STRUCTURE';
}

function tryPlaceTurret() {
  const p = ghostPos();
  if (!buildPosValid(p) || stats.salvage < TURRET_COST) { beep(140, 90, 0.15, 'square', 0.1); return; }
  stats.salvage -= TURRET_COST;
  stats.turretsBuilt++;
  makeTurretEntity('blue', p.x, p.z);
  spawnSpark(new THREE.Vector3(p.x, 2, p.z));
  beep(500, 1100, 0.15, 'sine', 0.12);
  toggleBuildMode();
  updateHud();
}

/* ============================================================
   AI: turrets + enemy mechs + waves
============================================================ */
function updateTurret(e, dt) {
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
  let diff = desired - e.yaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const turn = 4 * dt;
  e.yaw += Math.max(-turn, Math.min(turn, diff));
  e.head.rotation.y = e.yaw;

  if (Math.abs(diff) < 0.15 && e.cool <= 0) {
    e.cool = e.fireInterval;
    const muzzle = localToWorld(e, 0, 3.0, 2.2);
    const dir = _v2.set(tp.x, Math.min(3.5, e.target.hitHeight * 0.55), tp.z).sub(muzzle).normalize().clone();
    spawnProjectile({ pos: muzzle, dir, speed: 100, damage: e.damage, team: e.team, life: 1 });
    if (e.team === 'blue') beep(340, 120, 0.05, 'square', 0.03);
    else beep(240, 80, 0.05, 'square', 0.03);
  }
}

function updateEnemyMech(e, dt) {
  e.cool -= dt;
  e.retarget -= dt;
  if (e.retarget <= 0) {
    e.retarget = 0.5;
    // priority: player nearby > blue turret nearby > blue base
    let t = null;
    if (player.alive && distXZ(e.group.position, player.group.position) < 52) t = player;
    if (!t) {
      let bd = 42;
      for (const o of entities) {
        if (!o.alive || o.team !== 'blue' || o.kind !== 'turret') continue;
        const d = distXZ(e.group.position, o.group.position);
        if (d < bd) { bd = d; t = o; }
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

  // face target / travel direction
  const desired = Math.atan2(tp.x - e.group.position.x, tp.z - e.group.position.z);
  let diff = desired - e.yaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const turn = 3.2 * dt;
  e.yaw += Math.max(-turn, Math.min(turn, diff));
  e.group.rotation.y = e.yaw;

  const shouldMove = d > attackRange * 0.85 || !clear;
  if (shouldMove) {
    e.group.position.x += Math.sin(e.yaw) * e.speed * dt;
    e.group.position.z += Math.cos(e.yaw) * e.speed * dt;
    collideCircle(e.group.position, 2.2);
    e.walkPhase += dt * 7;
    const sw = Math.sin(e.walkPhase) * 0.55;
    e.model.legL.rotation.x = sw;
    e.model.legR.rotation.x = -sw;
    e.group.position.y = Math.abs(Math.sin(e.walkPhase)) * 0.25;
  } else {
    e.group.position.y = 0;
  }

  if (d < attackRange && clear && Math.abs(diff) < 0.25 && e.cool <= 0) {
    e.cool = e.fireInterval * (0.8 + Math.random() * 0.5);
    const muzzle = localToWorld(e, (Math.random() < 0.5 ? -2.2 : 2.2), 4.5, 2.7);
    const spread = (Math.random() - 0.5) * 0.06;
    const dir = _v2.set(tp.x - muzzle.x, 0, tp.z - muzzle.z).normalize().clone();
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
    dir.y = (Math.min(3.5, e.target.hitHeight * 0.5) - muzzle.y) / Math.max(d, 1);
    dir.normalize();
    spawnProjectile({ pos: muzzle, dir, speed: 70, damage: e.damage, team: 'red', life: 1.4 });
    beep(200, 70, 0.05, 'square', 0.025);
  }
}

/* waves */
let nextWaveAt = 5;
function updateWaves() {
  if (elapsed < nextWaveAt || !redBase.alive) return;
  nextWaveAt = elapsed + 22;
  const alive = entities.filter(e => e.kind === 'mech' && e.team === 'red').length;
  if (alive >= 12) return;
  stats.wave++;
  const n = Math.min(2 + Math.floor(stats.wave / 2), 6);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 7;
    makeEnemyMech(x + (Math.random() - 0.5) * 3, -96 + Math.random() * 4);
  }
  showMessage(`WAVE ${stats.wave} INCOMING`, '#ff9a5a');
  beep(90, 55, 0.6, 'sawtooth', 0.12);
}

/* ============================================================
   HUD / minimap / messages
============================================================ */
const hpFill = document.getElementById('hpFill');
const salvageVal = document.getElementById('salvageVal');
const ammoVal = document.getElementById('ammoVal');
const rocketVal = document.getElementById('rocketVal');
const turretVal = document.getElementById('turretVal');
const baseBlueFill = document.getElementById('baseBlueFill');
const baseRedFill = document.getElementById('baseRedFill');
const msgEl = document.getElementById('msg');
let msgTimer = null;

function updateHud() {
  hpFill.style.height = `${Math.max(0, player.hp / player.maxHp * 100)}%`;
  salvageVal.textContent = Math.floor(stats.salvage);
  ammoVal.textContent = Math.max(0, Math.floor(stats.ammo));
  rocketVal.textContent = stats.rockets;
  turretVal.textContent = entities.filter(e => e.alive && e.team === 'blue' && e.kind === 'turret').length;
  baseBlueFill.style.width = `${Math.max(0, blueBase.hp / blueBase.maxHp * 100)}%`;
  baseRedFill.style.width = `${Math.max(0, redBase.hp / redBase.maxHp * 100)}%`;
}

function showMessage(text, color) {
  msgEl.textContent = text;
  msgEl.style.color = color || '#ffd23c';
  msgEl.style.opacity = 1;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { msgEl.style.opacity = 0; }, 2600);
}

const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');
function drawMinimap() {
  const w = mini.width, h = mini.height;
  mctx.clearRect(0, 0, w, h);
  mctx.fillStyle = 'rgba(10,14,22,0.85)';
  mctx.fillRect(0, 0, w, h);
  const px = (x) => (x + ARENA.hw) / (ARENA.hw * 2) * w;
  const pz = (z) => (z + ARENA.hd) / (ARENA.hd * 2) * h;
  mctx.fillStyle = '#39414f';
  for (const o of obstacles) {
    mctx.fillRect(px(o.x - o.hw), pz(o.z - o.hd), (o.hw * 2) / (ARENA.hw * 2) * w, (o.hd * 2) / (ARENA.hd * 2) * h);
  }
  for (const e of entities) {
    if (!e.alive) continue;
    const x = px(e.group.position.x), y = pz(e.group.position.z);
    if (e.kind === 'base') {
      mctx.fillStyle = e.team === 'blue' ? '#4d8dff' : '#ff5040';
      mctx.fillRect(x - 4, y - 4, 8, 8);
    } else if (e.kind === 'turret') {
      mctx.fillStyle = e.team === 'blue' ? '#8fd0ff' : '#ffb060';
      mctx.fillRect(x - 2, y - 2, 4, 4);
    } else if (e === player) {
      mctx.fillStyle = '#7CFF6B';
      mctx.beginPath(); mctx.arc(x, y, 3.4, 0, 7); mctx.fill();
    } else {
      mctx.fillStyle = '#ff4535';
      mctx.beginPath(); mctx.arc(x, y, 2.6, 0, 7); mctx.fill();
    }
  }
  mctx.strokeStyle = '#4a5578';
  mctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

/* ============================================================
   Camera
============================================================ */
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const p = player.group.position;
  const yaw = player.yaw;
  const behind = 21, up = 26;
  const cx = p.x - Math.sin(yaw) * behind;
  const cz = p.z - Math.cos(yaw) * behind;
  const k = 1 - Math.exp(-8 * dt);
  camera.position.x += (cx - camera.position.x) * k;
  camera.position.y += (up - camera.position.y) * k;
  camera.position.z += (cz - camera.position.z) * k;
  camTarget.set(p.x + Math.sin(yaw) * 10, 2, p.z + Math.cos(yaw) * 10);
  camera.lookAt(camTarget);
}

/* ============================================================
   Game flow
============================================================ */
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');

function endGame(victory) {
  if (state === 'over') return;
  state = 'over';
  document.exitPointerLock();
  setTimeout(() => {
    overlay.classList.remove('hidden');
    overlay.querySelector('h1').textContent = victory ? 'VICTORY' : 'BASE LOST';
    overlay.querySelector('h1').style.color = victory ? '#7CFF6B' : '#ff5040';
    overlay.querySelector('h2').textContent = victory
      ? 'ENEMY BASE DESTROYED — DISTRICT SECURED'
      : 'YOUR BASE WAS DESTROYED';
    document.getElementById('briefing').innerHTML =
      `<b>MISSION REPORT</b><br>Kills: <b>${stats.kills}</b> · Waves survived: <b>${stats.wave}</b> · Turrets built: <b>${stats.turretsBuilt}</b><br>` +
      (victory ? 'Outstanding work, officer.' : 'The district has fallen. Redeploy and try again.');
    document.getElementById('startBtn').textContent = 'REDEPLOY';
  }, 1400);
  showMessage(victory ? 'ENEMY BASE DESTROYED' : 'YOUR BASE HAS FALLEN', victory ? '#7CFF6B' : '#ff5040');
  boomSfx(0.5, 1.2);
}

document.getElementById('startBtn').addEventListener('click', () => {
  if (state === 'over') { location.reload(); return; }
  audioCtx();
  overlay.classList.add('hidden');
  hud.classList.add('active');
  state = 'playing';
  renderer.domElement.requestPointerLock();
  showMessage('DESTROY THE ENEMY BASE', '#ffd23c');
  updateHud();
});

/* ============================================================
   Main loop
============================================================ */
const clock = new THREE.Clock();
let elapsed = 0;
let salvageTrickle = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state === 'playing') {
    elapsed += dt;

    updatePlayer(dt);
    updateWaves();
    for (const e of entities) {
      if (!e.alive) continue;
      if (e.kind === 'turret') updateTurret(e, dt);
      else if (e.kind === 'mech') updateEnemyMech(e, dt);
    }
    separateMechs();
    updateProjectiles(dt);
    updateGhost();

    // passive salvage income
    salvageTrickle += dt;
    if (salvageTrickle >= 1) {
      salvageTrickle -= 1;
      stats.salvage += 3;
      updateHud();
    }
  }

  updateParticles(dt);
  if (state !== 'menu') {
    updateCamera(dt);
    drawMinimap();
  } else {
    // idle menu camera orbit
    const t = performance.now() * 0.0002;
    camera.position.set(Math.sin(t) * 100, 55, Math.cos(t) * 100);
    camera.lookAt(0, 0, 0);
  }

  renderer.render(scene, camera);
}
animate();
