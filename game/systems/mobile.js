import { renderer } from '../world/scene.js';
import { game, touch } from '../core/state.js';
import { player, fireRocket } from '../entities/player.js';
import { placeTurretDirect } from './build.js';

/* ============================================================
   Mobile / touch controls — two schemes, picked on the menu
   (#ctrlRow, persisted as mechControls in localStorage):

   joystick — left half: floating joystick, up/down moves,
              left/right strafes; right half: drag to turn,
              hold to fire machine guns
   gyro     — compass (alpha) rotates, lean (beta) moves,
              side tilt (gamma) strafes; any touch fires

   On-screen buttons fire rockets / place turrets in both.
============================================================ */
export const isTouchDevice = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
touch.active = isTouchDevice;

const JOY_R = 48;         // knob travel radius in px
const DEAD = 0.25;        // normalized joystick deadzone
const LOOK_SENS = 0.005;  // radians per px of horizontal drag

const DEG = Math.PI / 180;
const LEAN_DEADZONE = 7;   // degrees of forward/back tilt before the mech moves
const STRAFE_DEADZONE = 9; // degrees of side tilt before the mech strafes

if (isTouchDevice) {
  document.body.classList.add('touch');

  /* ---------- scheme picker on the main menu ---------- */
  const ctrlBtns = [...document.querySelectorAll('#ctrlRow button')];
  function reflectScheme() {
    for (const b of ctrlBtns) b.classList.toggle('selected', b.dataset.ctrl === touch.scheme);
  }
  for (const b of ctrlBtns) {
    b.addEventListener('click', () => {
      touch.scheme = b.dataset.ctrl;
      localStorage.setItem('mechControls', touch.scheme);
      reflectScheme();
      updateBriefing();
      b.blur();
    });
  }

  /* touch-friendly briefing, matching the chosen scheme */
  const TURRET_ICO = `<svg class="turretIco" viewBox="0 0 32 32" aria-hidden="true"><rect x="7" y="25" width="18" height="4" rx="1.5" fill="#55617a"/><path d="M10 25l2-5h8l2 5z" fill="#7c8aa8"/><circle cx="16" cy="17" r="5.5" fill="#a7b4cc"/><rect x="14.2" y="2.5" width="3.8" height="14" rx="1.6" fill="#93a2bd" transform="rotate(35 16 17)"/><path d="M24.1 2.1l1.1 2.4 2.4 1.1-2.4 1.1-1.1 2.4-1.1-2.4-2.4-1.1 2.4-1.1z" fill="#ffd23c"/></svg>`;
  function updateBriefing() {
    const controls = touch.scheme === 'gyro'
      ? `<kbd>🧭 Turn phone</kbd> rotate mech &nbsp; <kbd>📱 Lean</kbd> forward / back to move<br>
         <kbd>📱 Tilt sideways</kbd> strafe left / right &nbsp; <kbd>👆 Touch screen</kbd> machine guns<br>`
      : `<kbd>👈 Left thumb</kbd> joystick — move &amp; strafe<br>
         <kbd>👉 Right thumb</kbd> drag to turn · hold to fire machine guns<br>`;
    document.getElementById('briefing').innerHTML =
      `<b style="color:#ffd23c">MISSION:</b> Destroy the <b style="color:#ff8a7a">red enemy base</b> at the far end of the
      district before enemy assault mechs destroy <b style="color:#8ab4ff">yours</b>.<br>
      Enemy waves march on your base — build turrets to hold them off.<br><br>` +
      controls +
      `<kbd>🚀</kbd> rockets (<span style="color:#ffd23c">🛢️ 20</span>) &nbsp;
      <kbd>${TURRET_ICO}</kbd> build turret in front of you (<span style="color:#ffd23c">🛢️ 100 salvage</span>)`;
  }
  reflectScheme();
  updateBriefing();

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
}
