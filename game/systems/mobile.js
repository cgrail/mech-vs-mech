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
              left/right strafes, hard forward runs; right half:
              drag to turn, hold to fire machine guns
   gyro     — compass (alpha) rotates 1:1 (physically turn around to
              look behind you), lean (beta) moves and a hard lean
              runs, side tilt (gamma) strafes; any touch fires

   On-screen buttons fire rockets / place turrets in both.

   Running is the boost the keyboard has on Shift, off the one
   input a thumb has left to give: how *far* the stick is pushed.
   Both schemes latch it (RUN_ON to engage, RUN_OFF to let go) so
   a thumb resting at the threshold can't stutter between walk
   and run — the same reason the movement axes have a deadzone.
============================================================ */
export const isTouchDevice = touch.active; // decided in core/state.js — the menu is built from it

const JOY_R = 48;         // knob travel radius in px
const DEAD = 0.25;        // normalized joystick deadzone
const RUN_ON = 0.85;      // forward stick travel that starts a run…
const RUN_OFF = 0.72;     // …and where it drops back to a walk
const LOOK_SENS = 0.005;  // radians per px of horizontal drag

const DEG = Math.PI / 180;
const LEAN_DEADZONE = 7;   // degrees of forward/back tilt before the mech moves
const STRAFE_DEADZONE = 9; // degrees of side tilt before the mech strafes
const LEAN_RUN_ON = 19;    // …and how far to lean to run with it
const LEAN_RUN_OFF = 15;

if (isTouchDevice) {
  document.body.classList.add('touch');

  /* No browser zoom, anywhere. `touch-action: pan-x pan-y` in style.css is
     what refuses the double tap and the pinch on every engine that honours
     it; iOS Safari zooms the page from its own `gesture*` events regardless,
     so those are refused here as well. Deliberately not a touchend guard —
     preventing a second tap would swallow the click with it, and tapping a
     stepper twice in a row is how a setting gets cycled. */
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }

  /* how hard the mech is being pushed forward, latched: on past `on`, off
     below `off`. Shared by both schemes so a run engages the same way
     whether it comes from a stick or from a lean. */
  let running = false;
  function runLatch(fwd, on, off) {
    if (running ? fwd < off : fwd > on) running = !running;
    touch.boost = running;
    return running;
  }
  const stopRunning = () => { running = false; touch.boost = false; };

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

    // lean: tilting the top edge away (forward) lowers beta — and leaning
    // hard into it is the gyro's version of pushing the stick to the rim
    const dBeta = e.beta - baseBeta;
    touch.move = dBeta < -LEAN_DEADZONE ? 1 : dBeta > LEAN_DEADZONE ? -1 : 0;
    runLatch(-dBeta, LEAN_RUN_ON, LEAN_RUN_OFF);

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
        // pushed to the rim and pointing forward: run. The knob says so, since
        // nothing else on a phone can (no Shift key to see held down).
        joyEl.classList.toggle('run', runLatch(-ny, RUN_ON, RUN_OFF));
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
        stopRunning();
        joyEl.classList.remove('on', 'run');
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
