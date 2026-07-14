import { ARENA, obstacles } from '../world/world.js';
import { entities, blueBase, redBase } from '../entities/entities.js';
import { stats } from '../core/state.js';
import { player } from '../entities/player.js';

/* ============================================================
   HUD / minimap / messages
============================================================ */
const hpFill = document.getElementById('hpFill');
const salvageVal = document.getElementById('salvageVal');
const ammoVal = document.getElementById('ammoVal');
const rocketVal = document.getElementById('rocketVal');
const turretVal = document.getElementById('turretVal');
const baseBlueFill = document.getElementById('baseBlueFill');
const baseRedFill = document.getElementById('baseRedFill');
const msgEl = document.getElementById('msg');
let msgTimer = null;

export function updateHud() {
  hpFill.style.height = `${Math.max(0, player.hp / player.maxHp * 100)}%`;
  salvageVal.textContent = Math.floor(stats.salvage);
  ammoVal.textContent = Math.max(0, Math.floor(stats.ammo));
  rocketVal.textContent = stats.rockets;
  turretVal.textContent = entities.filter(e => e.alive && e.team === 'blue' && e.kind === 'turret').length;
  baseBlueFill.style.width = `${Math.max(0, blueBase.hp / blueBase.maxHp * 100)}%`;
  baseRedFill.style.width = `${Math.max(0, redBase.hp / redBase.maxHp * 100)}%`;
}

export function showMessage(text, color) {
  msgEl.textContent = text;
  msgEl.style.color = color || '#ffd23c';
  msgEl.style.opacity = 1;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { msgEl.style.opacity = 0; }, 2600);
}

const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');
export function drawMinimap() {
  const w = mini.width, h = mini.height;
  mctx.clearRect(0, 0, w, h);
  mctx.fillStyle = 'rgba(10,14,22,0.35)';
  mctx.fillRect(0, 0, w, h);
  const px = (x) => (x + ARENA.hw) / (ARENA.hw * 2) * w;
  const pz = (z) => (z + ARENA.hd) / (ARENA.hd * 2) * h;
  mctx.fillStyle = 'rgba(57,65,79,0.55)';
  for (const o of obstacles) {
    mctx.fillRect(px(o.x - o.hw), pz(o.z - o.hd), (o.hw * 2) / (ARENA.hw * 2) * w, (o.hd * 2) / (ARENA.hd * 2) * h);
  }
  for (const e of entities) {
    if (!e.alive) continue;
    const x = px(e.group.position.x), y = pz(e.group.position.z);
    if (e.kind === 'base') {
      mctx.fillStyle = e.team === 'blue' ? '#4d8dff' : '#ff5040';
      mctx.fillRect(x - 4, y - 4, 8, 8);
    } else if (e.kind === 'turret') {
      mctx.fillStyle = e.team === 'blue' ? '#8fd0ff' : '#ffb060';
      mctx.fillRect(x - 2, y - 2, 4, 4);
    } else if (e === player) {
      mctx.fillStyle = '#7CFF6B';
      mctx.beginPath(); mctx.arc(x, y, 3.4, 0, 7); mctx.fill();
    } else {
      mctx.fillStyle = '#ff4535';
      mctx.beginPath(); mctx.arc(x, y, 2.6, 0, 7); mctx.fill();
    }
  }
  mctx.strokeStyle = '#4a5578';
  mctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}
