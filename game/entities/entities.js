import * as THREE from 'three';
import { scene } from '../world/scene.js';
import { difficulty } from '../core/state.js';

export const BLUE = { body: 0x2b4fd8, accent: 0x6fd2ff };
export const RED = { body: 0xa42a20, accent: 0xffb03a };

export const entities = [];        // everything with hp

/* ============================================================
   Health bars (canvas sprites)
============================================================ */
export function makeBar(width) {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 10;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(width, width * 10 / 64, 1);
  sp.renderOrder = 10;
  function set(f) {
    f = Math.max(0, Math.min(1, f));
    ctx.clearRect(0, 0, 64, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, 64, 10);
    const r = Math.floor(255 * Math.min(1, 2 - 2 * f));
    const g = Math.floor(255 * Math.min(1, 2 * f));
    ctx.fillStyle = `rgb(${r},${g},40)`;
    ctx.fillRect(2, 2, 60 * f, 6);
    tex.needsUpdate = true;
  }
  set(1);
  return { sprite: sp, set };
}

/* ============================================================
   Models: mech, turret, base
============================================================ */
export function makeMech(palette) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: palette.body, roughness: 0.55, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.7, metalness: 0.3 });
  const accent = new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.4, metalness: 0.3 });

  function box(w, h, d, mat, x, y, z, parent) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    (parent || g).add(m);
    return m;
  }

  // legs: pivot groups at hip height so they can swing
  const legL = new THREE.Group(); legL.position.set(-1.1, 2.6, 0); g.add(legL);
  const legR = new THREE.Group(); legR.position.set(1.1, 2.6, 0); g.add(legR);
  for (const leg of [legL, legR]) {
    box(0.8, 1.6, 1.0, dark, 0, -0.8, 0, leg);              // thigh
    box(0.7, 1.4, 0.8, body, 0, -2.0, 0.15, leg);           // shin
    box(1.1, 0.5, 1.8, dark, 0, -2.85, 0.35, leg);          // foot
  }

  box(2.8, 1.0, 2.0, dark, 0, 2.9, 0);                      // pelvis
  const torso = box(3.4, 1.8, 2.6, body, 0, 4.2, 0);        // torso
  box(1.6, 0.9, 1.2, accent, 0, 5.4, 0.6);                  // cockpit
  box(1.2, 0.35, 0.9, dark, 0, 5.95, 0.4);                  // sensor block

  // shoulder gun pods
  box(1.0, 1.0, 2.4, dark, -2.2, 4.5, 0.4);
  box(1.0, 1.0, 2.4, dark, 2.2, 4.5, 0.4);
  box(0.3, 0.3, 1.6, accent, -2.2, 4.5, 1.9);               // barrels
  box(0.3, 0.3, 1.6, accent, 2.2, 4.5, 1.9);

  // police lights (blink in update)
  const lampR = box(0.35, 0.3, 0.35, new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2222, emissiveIntensity: 2 }), -0.45, 6.3, 0.4);
  const lampB = box(0.35, 0.3, 0.35, new THREE.MeshStandardMaterial({ color: 0x000033, emissive: 0x2244ff, emissiveIntensity: 2 }), 0.45, 6.3, 0.4);

  return { group: g, legL, legR, torso, lampR, lampB };
}

export function makeTurretModel(palette) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: palette.body, roughness: 0.55, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d34, roughness: 0.7 });
  const accent = new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.4 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.0, 1.2, 8), dark);
  base.position.y = 0.6; base.castShadow = true; g.add(base);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.2, 8), body);
  neck.position.y = 1.7; neck.castShadow = true; g.add(neck);

  const head = new THREE.Group(); head.position.y = 2.7; g.add(head);
  const hd = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 1.6), body);
  hd.castShadow = true; head.add(hd);
  for (const sx of [-0.45, 0.45]) {
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 2.2), accent);
    barrel.position.set(sx, 0.05, 1.4); barrel.castShadow = true; head.add(barrel);
  }
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: palette.accent, emissiveIntensity: 2 }));
  eye.position.set(0, 0.35, 0.85); head.add(eye);
  return { group: g, head };
}

export function makeBaseModel(palette) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: palette.body, roughness: 0.6, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x333842, roughness: 0.8 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: palette.accent, emissiveIntensity: 1.6 });

  const plat = new THREE.Mesh(new THREE.BoxGeometry(16, 2, 16), dark);
  plat.position.y = 1; plat.castShadow = plat.receiveShadow = true; g.add(plat);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(8, 9, 8), body);
  tower.position.y = 6.5; tower.castShadow = true; g.add(tower);
  const top = new THREE.Mesh(new THREE.BoxGeometry(5, 2.5, 5), dark);
  top.position.y = 12.2; top.castShadow = true; g.add(top);
  const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 5, 6), dark);
  spike.position.y = 16; g.add(spike);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), glow);
  beacon.position.y = 18.6; g.add(beacon);

  for (const [px, pz] of [[-6.5, -6.5], [6.5, -6.5], [-6.5, 6.5], [6.5, 6.5]]) {
    const pil = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2), body);
    pil.position.set(px, 4, pz); pil.castShadow = true; g.add(pil);
  }
  // glowing core panels
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.5, 0.3), glow);
    panel.position.set(Math.sin(ry) * 4.1, 6.2, Math.cos(ry) * 4.1);
    panel.rotation.y = ry;
    g.add(panel);
  }
  const light = new THREE.PointLight(palette.accent, 60, 45);
  light.position.y = 8;
  g.add(light);
  return { group: g };
}

/* ============================================================
   Entity factories
============================================================ */
export function registerEntity(e) {
  entities.push(e);
  scene.add(e.group);
  if (e.bar) {
    e.bar.sprite.position.y = e.barHeight;
    e.group.add(e.bar.sprite);
  }
  return e;
}

export function makeBaseEntity(team, z) {
  const palette = team === 'blue' ? BLUE : RED;
  const model = makeBaseModel(palette);
  model.group.position.set(0, 0, z);
  const bar = makeBar(14);
  return registerEntity({
    kind: 'base', team, group: model.group,
    hp: 1200, maxHp: 1200, alive: true,
    hitRadius: 9.5, hitHeight: 14, bar, barHeight: 16,
    yaw: 0,
  });
}

export function makeTurretEntity(team, x, z) {
  const palette = team === 'blue' ? BLUE : RED;
  const model = makeTurretModel(palette);
  model.group.position.set(x, 0, z);
  const bar = makeBar(5);
  return registerEntity({
    kind: 'turret', team, group: model.group, head: model.head,
    hp: team === 'blue' ? 260 : 320, maxHp: team === 'blue' ? 260 : 320, alive: true,
    hitRadius: 2.2, hitHeight: 4, bar, barHeight: 5.2,
    range: team === 'blue' ? 48 : 44, damage: 8,
    fireInterval: team === 'blue' ? 0.28 : 0.34,
    cool: Math.random() * 0.4, retarget: 0, target: null, yaw: 0,
  });
}

export function makeEnemyMech(x, z) {
  const model = makeMech(RED);
  model.group.position.set(x, 0, z);
  const bar = makeBar(5);
  const m = difficulty().mech;
  return registerEntity({
    kind: 'mech', team: 'red', group: model.group, model,
    hp: m.hp, maxHp: m.hp, alive: true,
    hitRadius: 2.4, hitHeight: 7, bar, barHeight: 8.2,
    speed: m.speed + Math.random() * 2, range: m.range, damage: m.damage,
    fireInterval: m.fireInterval, cool: 1 + Math.random(),
    retarget: 0, target: null, yaw: 0, walkPhase: Math.random() * 6,
    strafeDir: 1, strafeTimer: 0, stuckT: 0, detourT: 0, detourYaw: 0,
    px: x, pz: z,
  });
}

/* bases + enemy defense turrets */
export const blueBase = makeBaseEntity('blue', 112);
export const redBase = makeBaseEntity('red', -112);
makeTurretEntity('red', -17, -98);
makeTurretEntity('red', 17, -98);
makeTurretEntity('red', 0, -86);
