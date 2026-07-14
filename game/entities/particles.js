import * as THREE from 'three';
import { scene } from '../world/scene.js';

/* ============================================================
   Explosions / particles
============================================================ */
export const particles = [];

const fragGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
const fragMats = [
  new THREE.MeshBasicMaterial({ color: 0xffd23c }),
  new THREE.MeshBasicMaterial({ color: 0xff7a2a }),
  new THREE.MeshBasicMaterial({ color: 0xff3a1a }),
  new THREE.MeshBasicMaterial({ color: 0x555555 }),
];

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
