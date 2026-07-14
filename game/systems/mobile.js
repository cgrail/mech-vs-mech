import { renderer } from '../world/scene.js';
import { game, touch } from '../core/state.js';
import { player, fireRocket } from '../entities/player.js';
import { placeTurretDirect } from './build.js';

/* ============================================================
   Mobile / touch controls
   - compass (alpha) rotates the mech
   - gyro lean (beta) moves forward / backward
   - gyro side tilt (gamma) strafes left / right
   - touching the display fires the machine guns
   - on-screen buttons fire rockets and place turrets
============================================================ */
export const isTouchDevice = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
touch.active = isTouchDevice;

const DEG = Math.PI / 180;
const LEAN_DEADZONE = 7;   // degrees of forward/back tilt before the mech moves
const STRAFE_DEADZONE = 9; // degrees of side tilt before the mech strafes

/* ---------- device orientation: compass + gyro lean ---------- */
let baseAlpha = 0, baseBeta = 0, baseGamma = 0, baseYaw = 0;
let needCalibration = true;

function onOrientation(e) {
  if (e.alpha == null || e.beta == null || game.state !== 'playing') return;
  if (needCalibration) {
    // current pose becomes "facing forward, standing still"
    baseAlpha = e.alpha;
    baseBeta = e.beta;
    baseGamma = e.gamma ?? 0;
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

  // side tilt: gamma grows when the right edge dips down
  const dGamma = (e.gamma ?? baseGamma) - baseGamma;
  touch.strafe = dGamma > STRAFE_DEADZONE ? 1 : dGamma < -STRAFE_DEADZONE ? -1 : 0;
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
    <kbd>📱 Tilt sideways</kbd> strafe left / right<br>
    <kbd>👆 Touch screen</kbd> machine guns &nbsp; <kbd>🚀</kbd> rockets (<span style="color:#ffd23c">🛢️ 20</span>)<br>
    <kbd><svg class="turretIco" viewBox="0 0 32 32" aria-hidden="true"><rect x="7" y="25" width="18" height="4" rx="1.5" fill="#55617a"/><path d="M10 25l2-5h8l2 5z" fill="#7c8aa8"/><circle cx="16" cy="17" r="5.5" fill="#a7b4cc"/><rect x="14.2" y="2.5" width="3.8" height="14" rx="1.6" fill="#93a2bd" transform="rotate(35 16 17)"/><path d="M24.1 2.1l1.1 2.4 2.4 1.1-2.4 1.1-1.1 2.4-1.1-2.4-2.4-1.1 2.4-1.1z" fill="#ffd23c"/></svg></kbd> build turret in front of you (<span style="color:#ffd23c">🛢️ 100 salvage</span>)`;

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
