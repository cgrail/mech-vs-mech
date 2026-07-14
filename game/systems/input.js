import { renderer } from '../world/scene.js';
import { game, touch } from '../core/state.js';
import { toggleBuildMode, tryPlaceTurret, placeTurretDirect } from './build.js';
import { player, fireRocket, selectWeapon } from '../entities/player.js';

/* ============================================================
   Input
============================================================ */
export const keys = {};

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (game.state !== 'playing') return;
  if (e.code === 'KeyB' || e.code === 'KeyT') toggleBuildMode();
  else if (e.code === 'KeyQ') fireRocket();
  else if (e.code === 'Digit1' || e.code === 'Numpad1') {
    if (game.buildMode) toggleBuildMode();
    selectWeapon(1);
  } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
    if (game.buildMode) toggleBuildMode();
    selectWeapon(2);
  } else if (e.code === 'Digit3' || e.code === 'Numpad3') {
    if (game.buildMode) toggleBuildMode();
    if (placeTurretDirect()) selectWeapon(1);
  } else if (e.code === 'Space' && game.buildMode) tryPlaceTurret();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());

renderer.domElement.addEventListener('mousedown', (e) => {
  if (game.state !== 'playing' || touch.active) return;
  if (!game.pointerLocked) { renderer.domElement.requestPointerLock(); return; }
  if (e.button === 0) {
    if (game.buildMode) { tryPlaceTurret(); return; }
    game.mouseDown = true;
  } else if (e.button === 2) {
    if (game.buildMode) { toggleBuildMode(); return; }
    fireRocket();
  }
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
