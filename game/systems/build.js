import * as THREE from 'three';
import { ARENA, groundHeightAt } from '../world/world.js';
import { entities, makeTurretEntity } from '../entities/entities.js';
import { stats, COSTS } from '../core/state.js';
import { localToWorld, distXZ } from '../core/helpers.js';
import { spawnSpark } from '../entities/particles.js';
import { beep } from './audio.js';
import { player } from '../entities/player.js';
import { updateHud } from '../ui/hud.js';
import { MP, sendGame } from '../net/net.js';

/* ============================================================
   Turret building — placed directly in front of the player
============================================================ */
const buildHintEl = document.getElementById('buildHint');

function buildPos() {
  return localToWorld(player, 0, 0, 9);
}

function buildPosValid(p) {
  if (Math.abs(p.x) > ARENA.hw - 4 || Math.abs(p.z) > ARENA.hd - 4) return false;
  // needs flat footing on the player's own level (no walls, ramps or cliffs)
  const h = groundHeightAt(p.x, p.z);
  if (Math.abs(h - player.y) > 0.5) return false;
  for (const [ox, oz] of [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) {
    if (Math.abs(groundHeightAt(p.x + ox, p.z + oz) - h) > 0.1) return false;
  }
  for (const e of entities) {
    if (!e.alive || e === player) continue;
    if (distXZ(p, e.group.position) < e.hitRadius + 4) return false;
  }
  return true;
}

let hintTimer = 0;
function flashHint(text) {
  buildHintEl.classList.add('bad');
  buildHintEl.textContent = text;
  buildHintEl.style.display = 'block';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { buildHintEl.style.display = 'none'; }, 1400);
}

export function placeTurretDirect() {
  if (!player.alive) return false;
  const p = buildPos();
  if (stats.salvage < COSTS.turret) {
    beep(140, 90, 0.15, 'square', 0.1);
    flashHint(`NOT ENOUGH SALVAGE — NEED 🛢️ ${COSTS.turret}`);
    return false;
  }
  if (!buildPosValid(p)) {
    beep(140, 90, 0.15, 'square', 0.1);
    flashHint('INVALID POSITION — NEEDS FLAT OPEN GROUND');
    return false;
  }
  stats.salvage -= COSTS.turret;
  stats.turretsBuilt++;
  const t = makeTurretEntity(player.team, p.x, p.z, `${player.team}:t${stats.turretsBuilt}`);
  if (MP.active) sendGame({ t: 'build', id: t.netId, x: +p.x.toFixed(1), z: +p.z.toFixed(1) });
  spawnSpark(new THREE.Vector3(p.x, groundHeightAt(p.x, p.z) + 2, p.z));
  beep(500, 1100, 0.15, 'sine', 0.12);
  updateHud();
  return true;
}
