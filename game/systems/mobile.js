import { renderer } from '../world/scene.js';
import { game, touch } from '../core/state.js';
import { player, fireRocket } from '../entities/player.js';
import { placeTurretDirect } from './build.js';

/* ============================================================
   Mobile / touch controls — two schemes, picked on the menu's
   CONTROLS row (core/flow.js owns the row and the briefing
   legend that goes with it; persisted as mechControls in
   localStorage, read here as touch.scheme):

   joystick — left half: floating joystick, up/down moves,
              left/right strafes; right half: drag to turn,
              hold to fire machine guns
   gyro     — compass (alpha) rotates 1:1 (physically turn around to
              look behind you), lean (beta) moves,
              side tilt (gamma) strafes; any touch fires

   On-screen buttons fire rockets / place turrets in both.
============================================================ */
export const isTouchDevice = touch.active; // decided in core/state.js — the menu is built from it

const JOY_R = 48;         // knob travel radius in px
const DEAD = 0.25;        // normalized joystick deadzone
const LOOK_SENS = 0.005;  // radians per px of horizontal drag

const DEG = Math.PI / 180;
const LEAN_DEADZONE = 7;   // degrees of forward/back tilt before the mech moves
const STRAFE_DEADZONE = 9; // degrees of side tilt before the mech strafes

if (isTouchDevice) {
  document.body.classList.add('touch');

  /* ---------- gyro scheme: compass + lean ---------- */
  let baseAlpha = 0, baseBeta = 0, baseGamma = 0, baseYaw = 0;
  let needCalibration = true;

  function onOrientation(e) {
    if (touch.scheme !== 'gyro' || e.alpha == null || e.beta == null || game.state !== 'playing') return;
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
    if (touch.scheme !== 'gyro') return;
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
  document.getElementById('startBtn').addEventListener('click', enableOrientation);

  /* ---------- joystick scheme: left thumb stick, right thumb look/fire.
     With gyro, every touch is a fire touch instead. ---------- */
  const canvas = renderer.domElement;
  const joyEl = document.getElementById('joystick');
  const knobEl = document.getElementById('joyKnob');
  let joyId = null, joyCX = 0, joyCY = 0; // joystick touch + its anchor point
  let lookId = null, lookX = 0;           // look/fire touch + last x

  const setKnob = (dx, dy) => {
    knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (game.state !== 'playing') return;
    for (const t of e.changedTouches) {
      if (touch.scheme === 'joystick' && joyId === null && t.clientX < window.innerWidth * 0.5) {
        // the joystick base appears wherever the left thumb lands
        joyId = t.identifier;
        joyCX = t.clientX; joyCY = t.clientY;
        joyEl.style.left = `${joyCX}px`;
        joyEl.style.top = `${joyCY}px`;
        joyEl.classList.add('on');
        setKnob(0, 0);
      } else if (lookId === null) {
        lookId = t.identifier;
        lookX = t.clientX;
        game.mouseDown = true;
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        let dx = t.clientX - joyCX, dy = t.clientY - joyCY;
        const d = Math.hypot(dx, dy);
        if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }
        setKnob(dx, dy);
        const nx = dx / JOY_R, ny = dy / JOY_R;
        touch.strafe = Math.abs(nx) > DEAD ? nx : 0;
        touch.move = Math.abs(ny) > DEAD ? -ny : 0;
      } else if (t.identifier === lookId && touch.scheme === 'joystick') {
        if (game.state === 'playing' && player.alive) player.yaw -= (t.clientX - lookX) * LOOK_SENS;
        lookX = t.clientX;
      }
    }
  }, { passive: false });

  const endTouch = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        joyId = null;
        touch.move = touch.strafe = 0;
        joyEl.classList.remove('on');
      } else if (t.identifier === lookId) {
        lookId = null;
        game.mouseDown = false;
      }
    }
  };
  canvas.addEventListener('touchend', endTouch, { passive: false });
  canvas.addEventListener('touchcancel', endTouch, { passive: false });

  /* action buttons */
  document.getElementById('btnRocket').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (game.state === 'playing') fireRocket();
  }, { passive: false });
  document.getElementById('btnTurret').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (game.state === 'playing') placeTurretDirect();
  }, { passive: false });
  document.getElementById('btnJump').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (game.state === 'playing') touch.jump = true; // updatePlayer consumes it
  }, { passive: false });
}
