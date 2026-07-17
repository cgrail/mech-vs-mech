import * as THREE from 'three';

/* ============================================================
   Renderer, scene, camera, lights
============================================================ */
const app = document.getElementById('app');
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d16);
scene.fog = new THREE.Fog(0x0b0d16, 90, 280);

export const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 40, 140);

/* Pointer lock is best-effort: browsers refuse it for benign reasons (no user
   activation — e.g. the MP go-handshake, re-locking too soon after Esc, iPadOS)
   as a sync throw or a rejected promise depending on engine. An unlocked
   pointer is already a handled state (clicking the canvas retries), so a
   refusal must never surface as a fatal error. */
export function lockPointer() {
  try {
    const p = renderer.domElement.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* stay unlocked */ }
}

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
