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
/* filmic tone mapping: the neon accents and the muzzle flashes are far
   brighter than the district, and without it they clip to flat white.
   Lights below are tuned against this exposure — change them together. */
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
app.appendChild(renderer.domElement);

/* Sky: a vertical gradient drawn behind everything (three stretches a plain
   background texture over the screen, so this costs one quad and never
   moves with the map — the scene itself is flown up and down on a level
   switch). The fog takes the horizon colour, so distant terrain melts into
   it instead of ending in a hard silhouette. */
const HORIZON = 0x2a3350;
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#070a14');    // zenith
  grad.addColorStop(0.55, '#151d33');
  grad.addColorStop(0.82, '#2a3350'); // haze band above the horizon
  grad.addColorStop(1, '#3b3a4a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const scene = new THREE.Scene();
scene.background = makeSkyTexture();
scene.fog = new THREE.Fog(HORIZON, 90, 280);

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

/* lights — brighter than they read on paper because ACES tone mapping
   rolls the top end off (see toneMappingExposure above) */
scene.add(new THREE.HemisphereLight(0x9db4d8, 0x2a2c22, 1.15));
const sun = new THREE.DirectionalLight(0xfff2d8, 2.1);
sun.position.set(60, 120, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -160; sun.shadow.camera.right = 160;
sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160;
sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0004;
scene.add(sun);
