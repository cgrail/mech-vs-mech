import * as THREE from 'three';
import { scene } from '../world/scene.js';
import { groundHeightAt } from '../world/world.js';

/* ============================================================
   Explosions / particles
============================================================ */
export const particles = [];

const fragGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
/* toneMapped: false keeps the hot colours hot — ACES (scene.js) would
   otherwise roll sparks and fire back toward the terrain's brightness */
const fragMats = [
  new THREE.MeshBasicMaterial({ color: 0xffd23c, toneMapped: false }),
  new THREE.MeshBasicMaterial({ color: 0xff7a2a, toneMapped: false }),
  new THREE.MeshBasicMaterial({ color: 0xff3a1a, toneMapped: false }),
  new THREE.MeshBasicMaterial({ color: 0x555555 }),
];

/* ---------- muzzle flashes ----------
   Every gun fires several times a second and there can be a dozen shooters,
   so the flashes come out of a fixed ring of sprites: no allocation per
   shot, no garbage, and an overrun just steals the oldest one. */
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,226,140,0.9)');
  grad.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  grad.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const FLASH_POOL = 28;
const flashMat = new THREE.SpriteMaterial({
  map: makeGlowTexture(), blending: THREE.AdditiveBlending,
  depthWrite: false, transparent: true, toneMapped: false,
});
const flashes = [];
let flashNext = 0;
for (let i = 0; i < FLASH_POOL; i++) {
  const sp = new THREE.Sprite(flashMat.clone());
  sp.visible = false;
  sp.renderOrder = 5;
  scene.add(sp);
  flashes.push({ sprite: sp, life: 0, max: 1 });
}

/* a short bloom of light at a muzzle; `scale` is its world size */
export function spawnFlash(pos, scale = 2.4, color = 0xffd9a0) {
  const f = flashes[flashNext];
  flashNext = (flashNext + 1) % FLASH_POOL;
  f.sprite.position.copy(pos);
  f.sprite.scale.setScalar(scale * (0.85 + Math.random() * 0.3));
  f.sprite.material.color.set(color);
  f.sprite.material.opacity = 1;
  f.sprite.visible = true;
  f.max = 0.07;
  f.life = f.max;
}

export function spawnExplosion(x, y, z, scale) {
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

export function spawnSpark(pos) {
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

export function updateParticles(dt) {
  for (const f of flashes) {
    if (f.life <= 0) continue;
    f.life -= dt;
    if (f.life <= 0) { f.sprite.visible = false; continue; }
    const k = f.life / f.max;
    f.sprite.material.opacity = k;
    f.sprite.scale.multiplyScalar(1 + dt * 6);
  }
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
    const floor = groundHeightAt(p.mesh.position.x, p.mesh.position.z) + 0.2;
    if (p.mesh.position.y < floor) { p.mesh.position.y = floor; p.vel.y *= -0.35; p.vel.x *= 0.7; p.vel.z *= 0.7; }
    if (p.life <= 0) { scene.remove(p.mesh); particles.splice(i, 1); }
  }
}
