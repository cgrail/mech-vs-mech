import * as THREE from 'three';
import { scene } from '../world/scene.js';
import { ARENA, obstacles } from '../world/world.js';
import { BLUE, entities, makeTurretModel, makeTurretEntity } from '../entities/entities.js';
import { game, stats } from '../core/state.js';
import { localToWorld, distXZ } from '../core/helpers.js';
import { spawnSpark } from '../entities/particles.js';
import { beep } from './audio.js';
import { player } from '../entities/player.js';
import { updateHud } from '../ui/hud.js';

/* ============================================================
   Build mode
============================================================ */
const TURRET_COST = 100;
let ghost = null;
const ghostOk = new THREE.MeshBasicMaterial({ color: 0x39d353, transparent: true, opacity: 0.45 });
const ghostBad = new THREE.MeshBasicMaterial({ color: 0xd33939, transparent: true, opacity: 0.45 });
const buildHintEl = document.getElementById('buildHint');

export function toggleBuildMode() {
  game.buildMode = !game.buildMode;
  if (game.buildMode && !player.alive) { game.buildMode = false; return; }
  if (game.buildMode) {
    const model = makeTurretModel(BLUE);
    model.group.traverse((o) => { if (o.isMesh) { o.material = ghostOk; o.castShadow = false; } });
    ghost = model.group;
    scene.add(ghost);
    buildHintEl.style.display = 'block';
    beep(600, 900, 0.08, 'sine', 0.08);
  } else {
    if (ghost) scene.remove(ghost);
    ghost = null;
    buildHintEl.style.display = 'none';
  }
}

function ghostPos() {
  return localToWorld(player, 0, 0, 9);
}

function buildPosValid(p) {
  if (Math.abs(p.x) > ARENA.hw - 4 || Math.abs(p.z) > ARENA.hd - 4) return false;
  for (const o of obstacles) {
    if (Math.abs(p.x - o.x) < o.hw + 2.5 && Math.abs(p.z - o.z) < o.hd + 2.5) return false;
  }
  for (const e of entities) {
    if (!e.alive || e === player) continue;
    if (distXZ(p, e.group.position) < e.hitRadius + 4) return false;
  }
  return true;
}

export function updateGhost() {
  if (!game.buildMode || !ghost) return;
  const p = ghostPos();
  ghost.position.set(p.x, 0, p.z);
  const valid = buildPosValid(p);
  const afford = stats.salvage >= TURRET_COST;
  const mat = valid && afford ? ghostOk : ghostBad;
  ghost.traverse((o) => { if (o.isMesh) o.material = mat; });
  buildHintEl.classList.toggle('bad', !(valid && afford));
  buildHintEl.textContent = !afford
    ? `NOT ENOUGH SALVAGE — NEED 🛢️ ${TURRET_COST}`
    : valid
      ? `BUILD TURRET HERE — LMB TO CONFIRM (🛢️ ${TURRET_COST})`
      : 'INVALID POSITION — TOO CLOSE TO STRUCTURE';
}

export function tryPlaceTurret() {
  const p = ghostPos();
  if (!buildPosValid(p) || stats.salvage < TURRET_COST) { beep(140, 90, 0.15, 'square', 0.1); return; }
  stats.salvage -= TURRET_COST;
  stats.turretsBuilt++;
  makeTurretEntity('blue', p.x, p.z);
  spawnSpark(new THREE.Vector3(p.x, 2, p.z));
  beep(500, 1100, 0.15, 'sine', 0.12);
  toggleBuildMode();
  updateHud();
}
