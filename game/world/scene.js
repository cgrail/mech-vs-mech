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
   The lights are tuned against this exposure and both move together —
   that pairing is the LOOK table below, and the exposure it sets. */
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);   // the exposure comes from the look, below

/* ============================================================
   The two looks

   A district is lit one of two ways, and the whole look moves in
   one piece: sky gradient, fog colour, both lights and the tone
   mapping exposure. `day` is the game as it has always looked.
   `night` is what fog of war switches the district into — the
   light version of it: the district itself goes dark and the
   mech carries the only lamp worth the name (systems/vision.js),
   instead of a lit district with contacts faded out of it.

   Why one table rather than a couple of dimmed lights: ACES
   rolls the top end off, so lights that read as over-bright on
   paper are what a lit district needs — and dimming them without
   lifting the exposure with them gives a muddy district, not a
   dark one. The night sun is kept on as a cool moonlight fill
   (silhouettes, so nobody walks into a wall they cannot see) and
   it hands its shadow map to the mech's lamp: at 0.28 intensity
   its own shadows are invisible anyway, so the district still
   pays for exactly one shadow pass.

   Change any one line of a look and retune the rest of it.
============================================================ */
const LOOK = {
  day: {
    sky: ['#070a14', '#151d33', '#2a3350', '#3b3a4a'],  // zenith → horizon haze → ground haze
    horizon: 0x2a3350,
    hemiSky: 0x9db4d8, hemiGround: 0x2a2c22, hemi: 1.15,
    sunColor: 0xfff2d8, sun: 2.1, sunShadow: true,
    exposure: 1.25,
  },
  night: {
    sky: ['#01020a', '#040712', '#0b1020', '#14161f'],
    horizon: 0x0b1020,
    hemiSky: 0x2c3b63, hemiGround: 0x07080e, hemi: 0.2,
    sunColor: 0x8fa8e0, sun: 0.28, sunShadow: false,
    exposure: 1.55,
  },
};

/* Sky: a vertical gradient drawn behind everything (three stretches a plain
   background texture over the screen, so this costs one quad and never
   moves with the map — the scene itself is flown up and down on a level
   switch). The fog takes the horizon colour, so distant terrain melts into
   it instead of ending in a hard silhouette. Both gradients are built once
   and kept: switching the look is a swap, not a repaint. */
const skies = {};
function skyTexture(look) {
  if (skies[look]) return skies[look];
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  const stops = LOOK[look].sky;
  grad.addColorStop(0, stops[0]);     // zenith
  grad.addColorStop(0.55, stops[1]);
  grad.addColorStop(0.82, stops[2]);  // haze band above the horizon
  grad.addColorStop(1, stops[3]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  skies[look] = tex;
  return tex;
}

export const scene = new THREE.Scene();
// near/far are the game's (flow.js pulls them back for the menu, vision.js
// closes them in for fog of war); the colour belongs to the look
scene.fog = new THREE.Fog(LOOK.day.horizon, 90, 280);

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
   rolls the top end off (see toneMapping above). Colour, intensity and the
   shadow switch all come from the look; nothing here but their geometry. */
const hemi = new THREE.HemisphereLight();
scene.add(hemi);
const sun = new THREE.DirectionalLight();
sun.position.set(60, 120, 40);
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -160; sun.shadow.camera.right = 160;
sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160;
sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0004;
scene.add(sun);

/* Switch the district between the two looks. The only caller is
   `applyFog` (systems/vision.js), which owns the rest of the fog-of-war
   view — the render fog's near/far and the mech's lamp — so the whole
   look lands in one frame. The menu keeps the day rig whatever the
   setting says: the orbit camera is previewing a map, not flying it. */
export function setNight(on) {
  const look = on ? LOOK.night : LOOK.day;
  scene.background = skyTexture(on ? 'night' : 'day');
  scene.fog.color.setHex(look.horizon);
  hemi.color.setHex(look.hemiSky);
  hemi.groundColor.setHex(look.hemiGround);
  hemi.intensity = look.hemi;
  sun.color.setHex(look.sunColor);
  sun.intensity = look.sun;
  sun.castShadow = look.sunShadow;
  renderer.toneMappingExposure = look.exposure;
}
setNight(false);   // the district starts in daylight, by the same path
