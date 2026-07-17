import { renderer, lockPointer } from '../world/scene.js';
import { game, touch } from '../core/state.js';
import { placeTurretDirect } from './build.js';
import { player, fireRocket, selectWeapon } from '../entities/player.js';

/* ============================================================
   Input
============================================================ */
export const keys = {};

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return; // typing in the lobby name field
  keys[e.code] = true;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (game.state !== 'playing') return;
  if (e.code === 'KeyQ') fireRocket();
  else if (e.code === 'Digit1' || e.code === 'Numpad1') selectWeapon(1);
  else if (e.code === 'Digit2' || e.code === 'Numpad2') selectWeapon(2);
  else if (e.code === 'Digit3' || e.code === 'Numpad3' || e.code === 'KeyT' || e.code === 'KeyB') {
    if (placeTurretDirect()) selectWeapon(1);
  }
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
