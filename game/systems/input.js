import { renderer, lockPointer } from '../world/scene.js';
import { game, touch } from '../core/state.js';
import { placeTurretDirect } from './build.js';
import { player, fireRocket, selectWeapon } from '../entities/player.js';
import { keys, actionOf } from './bindings.js';

/* ============================================================
   Input

   The listeners live here, what a key *means* lives in
   systems/bindings.js — every code below comes out of the
   bindings table, so the settings screen can move any of them.
   Held controls (move, fire, jump) are read by whoever needs
   them through `held`; the one-shots are dispatched here.
============================================================ */

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return; // typing in the lobby name field
  keys[e.code] = true;
  const act = actionOf(e.code);
  if (game.state !== 'playing') return;
  // a bound key belongs to the mech while the mech is being driven: no page
  // scrolling on Space, no tabbing out of the game
  if (act || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (act === 'rocket') fireRocket();
  else if (act === 'weapon1') selectWeapon(1);
  else if (act === 'weapon2') selectWeapon(2);
  else if (act === 'turret') { if (placeTurretDirect()) selectWeapon(1); }
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());

renderer.domElement.addEventListener('mousedown', (e) => {
  if (game.state !== 'playing' || touch.active) return;
  if (!game.pointerLocked) { lockPointer(); return; }
  if (e.button === 0) game.mouseDown = true;
  else if (e.button === 2) fireRocket();
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) game.mouseDown = false; });

document.addEventListener('pointerlockchange', () => {
  game.pointerLocked = document.pointerLockElement === renderer.domElement;
  if (!game.pointerLocked) game.mouseDown = false;
});
document.addEventListener('mousemove', (e) => {
  if (!game.pointerLocked || game.state !== 'playing' || !player.alive) return;
  player.yaw -= e.movementX * 0.0026;
});
