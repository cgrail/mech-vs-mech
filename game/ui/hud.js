import { ARENA, drawTerrainMinimap } from '../world/world.js';
import { entities, blueBase, redBase } from '../entities/entities.js';
import { game, stats, COSTS, CAPTURES_TO_WIN } from '../core/state.js';
import { player } from '../entities/player.js';
import { flags, ctfOn } from '../systems/ctf.js';
import { keyName } from '../systems/bindings.js';
import { MP } from '../net/net.js';

/* the "YOUR BASE" bar tracks whichever base is ours (guests play red) */
const myBase = MP.myTeam === 'red' ? redBase : blueBase;
const foeBase = MP.myTeam === 'red' ? blueBase : redBase;

/* ============================================================
   HUD / minimap / messages
============================================================ */
const hpFill = document.getElementById('hpFill');
const salvageVal = document.getElementById('salvageVal');
const turretVal = document.getElementById('turretVal');
const slotGun = document.getElementById('slotGun');
const slotRocket = document.getElementById('slotRocket');
const slotTurret = document.getElementById('slotTurret');
const baseBlueFill = document.getElementById('baseBlueFill');
const baseRedFill = document.getElementById('baseRedFill');
const msgEl = document.getElementById('msg');
const ctfBar = document.getElementById('ctfBar');
const ctfMyScore = document.getElementById('ctfMyScore');
const ctfFoeScore = document.getElementById('ctfFoeScore');
const ctfMyState = document.getElementById('ctfMyState');
const ctfFoeState = document.getElementById('ctfFoeState');
let msgTimer = null;

/* the key badge on a weapon slot names the key that selects it, so it follows
   whatever the settings screen made of the bindings (systems/bindings.js) */
function reflectKeyHints() {
  for (const [slot, id] of [[slotGun, 'weapon1'], [slotRocket, 'weapon2'], [slotTurret, 'turret']]) {
    slot.querySelector('.key').textContent = keyName(id);
  }
}
reflectKeyHints();
window.addEventListener('mech:keyschanged', reflectKeyHints);

/* capture the flag: my side left, theirs right, each with its flag's state */
function flagState(el, f) {
  const st = f.state === 'home' ? 'HOME' : f.state === 'carried' ? 'TAKEN' : 'DROPPED';
  el.textContent = `🚩 ${st}`;
  el.classList.toggle('taken', f.state === 'carried');
  el.classList.toggle('dropped', f.state === 'dropped');
}

function updateCtfHud() {
  ctfBar.classList.toggle('off', !ctfOn());
  if (!ctfOn()) return;
  ctfMyScore.textContent = stats.captures[MP.myTeam];
  ctfFoeScore.textContent = stats.captures[MP.enemyTeam];
  ctfBar.querySelector('.mid').textContent = `FIRST TO ${CAPTURES_TO_WIN}`;
  flagState(ctfMyState, flags[MP.myTeam]);
  flagState(ctfFoeState, flags[MP.enemyTeam]);
}

export function updateHud() {
  hpFill.style.height = `${Math.max(0, player.hp / player.maxHp * 100)}%`;
  salvageVal.textContent = Math.floor(stats.salvage);
  slotGun.classList.toggle('active', game.weapon !== 2);
  slotRocket.classList.toggle('active', game.weapon === 2);
  slotRocket.classList.toggle('dim', stats.salvage < COSTS.rocket);
  slotTurret.classList.toggle('dim', stats.salvage < COSTS.turret);
  turretVal.textContent = entities.filter(e => e.alive && e.team === MP.myTeam && e.kind === 'turret').length;
  baseBlueFill.style.width = `${Math.max(0, myBase.hp / myBase.maxHp * 100)}%`;
  baseRedFill.style.width = `${Math.max(0, foeBase.hp / foeBase.maxHp * 100)}%`;
  updateCtfHud();
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
// terrain never changes — render it once to an offscreen layer
const terrainLayer = document.createElement('canvas');
terrainLayer.width = mini.width;
terrainLayer.height = mini.height;
drawTerrainMinimap(terrainLayer.getContext('2d'), mini.width, mini.height);

export function drawMinimap() {
  if (mini.offsetParent === null) return; // hidden (touch device or narrow window)
  const w = mini.width, h = mini.height;
  mctx.clearRect(0, 0, w, h);
  mctx.globalAlpha = 0.75;
  mctx.drawImage(terrainLayer, 0, 0);
  mctx.globalAlpha = 1;
  const px = (x) => (x + ARENA.hw) / (ARENA.hw * 2) * w;
  const pz = (z) => (z + ARENA.hd) / (ARENA.hd * 2) * h;
  for (const e of entities) {
    if (!e.alive) continue;
    if (e.seen === false) continue; // fog of war: out of sight, off the map too
    const x = px(e.group.position.x), y = pz(e.group.position.z);
    const friendly = e.team === player.team; // relative colors: my side reads blue even when I fight as red
    if (e.kind === 'base') {
      mctx.fillStyle = friendly ? '#4d8dff' : '#ff5040';
      mctx.fillRect(x - 4, y - 4, 8, 8);
    } else if (e.kind === 'turret') {
      mctx.fillStyle = friendly ? '#8fd0ff' : '#ffb060';
      mctx.fillRect(x - 2, y - 2, 4, 4);
    } else if (e === player) {
      mctx.fillStyle = '#7CFF6B';
      mctx.beginPath(); mctx.arc(x, y, 3.4, 0, 7); mctx.fill();
    } else {
      mctx.fillStyle = friendly ? '#6fd2ff' : '#ff4535';
      mctx.beginPath(); mctx.arc(x, y, 2.6, 0, 7); mctx.fill();
    }
  }
  if (ctfOn()) {
    for (const f of [flags.blue, flags.red]) {
      const friendly = f.team === player.team;
      // the stand always shows (it is where a capture happens), the flag
      // itself only while it is out of it
      mctx.strokeStyle = friendly ? '#8fd0ff' : '#ffb060';
      mctx.lineWidth = 1.5;
      mctx.beginPath();
      mctx.arc(px(f.home.x), pz(f.home.z), 4, 0, 7);
      mctx.stroke();
      if (f.state === 'home') continue;
      const x = px(f.group.position.x), y = pz(f.group.position.z);
      mctx.fillStyle = friendly ? '#6fd2ff' : '#ff8a3a';
      mctx.beginPath();
      mctx.moveTo(x, y - 5); mctx.lineTo(x + 4, y); mctx.lineTo(x, y + 5); mctx.lineTo(x - 4, y);
      mctx.closePath(); mctx.fill();
    }
  }
  mctx.strokeStyle = '#4a5578';
  mctx.lineWidth = 1;
  mctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}
