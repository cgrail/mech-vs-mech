import { renderer } from '../world/scene.js';
import { game, touch } from '../core/state.js';
import { player, fireRocket } from '../entities/player.js';
import { placeTurretDirect } from './build.js';

/* ============================================================
   Mobile / touch controls
   - compass (alpha) rotates the mech
   - gyro lean (beta) moves forward / backward
   - touching the display fires the machine guns
   - on-screen buttons fire rockets and place turrets
============================================================ */
export const isTouchDevice = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
touch.active = isTouchDevice;

const DEG = Math.PI / 180;
const LEAN_DEADZONE = 7; // degrees of forward/back tilt before the mech moves

/* ---------- device orientation: compass + gyro lean ---------- */
let baseAlpha = 0, baseBeta = 0, baseYaw = 0;
let needCalibration = true;

function onOrientation(e) {
  if (e.alpha == null || e.beta == null || game.state !== 'playing') return;
  if (needCalibration) {
    // current pose becomes "facing forward, standing still"
    baseAlpha = e.alpha;
    baseBeta = e.beta;
    baseYaw = player.yaw;
    needCalibration = false;
  }
  // compass: alpha grows counterclockwise, same sense as yaw
  let dAlpha = e.alpha - baseAlpha;
  if (dAlpha > 180) dAlpha -= 360;
  else if (dAlpha < -180) dAlpha += 360;
  touch.yaw = baseYaw + dAlpha * DEG;

  // lean: tilting the top edge away (forward) lowers beta
  const dBeta = e.beta - baseBeta;
  touch.move = dBeta < -LEAN_DEADZONE ? 1 : dBeta > LEAN_DEADZONE ? -1 : 0;
}

async function enableOrientation() {
  try {
    // iOS needs an explicit permission request from a user gesture
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') return;
    }
    needCalibration = true;
    window.addEventListener('deviceorientation', onOrientation);
  } catch { /* sensor unavailable — touch fire/buttons still work */ }
}

if (isTouchDevice) {
  document.body.classList.add('touch');

  document.getElementById('startBtn').addEventListener('click', enableOrientation);

  /* touch-friendly briefing */
  document.getElementById('briefing').innerHTML =
    `<b style="color:#ffd23c">MISSION:</b> Destroy the <b style="color:#ff8a7a">red enemy base</b> at the far end of the
    district before enemy assault mechs destroy <b style="color:#8ab4ff">yours</b>.<br>
    Enemy waves march on your base — build turrets to hold them off.<br><br>
    <kbd>🧭 Turn phone</kbd> rotate mech &nbsp; <kbd>📱 Lean</kbd> forward / back to move<br>
    <kbd>👆 Touch screen</kbd> machine guns &nbsp; <kbd>🚀</kbd> rockets<br>
    <kbd>🗼</kbd> build turret in front of you (<span style="color:#ffd23c">🛢️ 100 salvage</span>)`;

  /* touching the display fires the machine guns */
  const canvas = renderer.domElement;
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (game.state !== 'playing') return;
    game.mouseDown = true;
  }, { passive: false });
  const stopFire = (e) => {
    e.preventDefault();
    if (e.touches.length === 0) game.mouseDown = false;
  };
  canvas.addEventListener('touchend', stopFire, { passive: false });
  canvas.addEventListener('touchcancel', stopFire, { passive: false });

  /* action buttons */
  document.getElementById('btnRocket').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (game.state === 'playing') fireRocket();
  }, { passive: false });
  document.getElementById('btnTurret').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (game.state === 'playing') placeTurretDirect();
  }, { passive: false });
}
