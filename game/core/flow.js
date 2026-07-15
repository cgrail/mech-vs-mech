import { renderer, scene } from '../world/scene.js';
import { levelName } from '../world/world.js';
import { game, stats, difficulty, touch } from './state.js';
import { entities, redBase } from '../entities/entities.js';
import { audioCtx, boomSfx, startMusic, duckMusic } from '../systems/audio.js';
import { updateHud, showMessage } from '../ui/hud.js';

/* ============================================================
   Game flow: difficulty select, start / end screens
============================================================ */
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');

/* difficulty picker */
const diffBtns = [...document.querySelectorAll('#diffRow button')];
function reflectDifficulty() {
  for (const b of diffBtns) b.classList.toggle('selected', b.dataset.diff === game.difficulty);
}
for (const b of diffBtns) {
  b.addEventListener('click', () => {
    game.difficulty = b.dataset.diff;
    localStorage.setItem('mechDifficulty', game.difficulty);
    reflectDifficulty();
    b.blur();
  });
}
reflectDifficulty();

/* level select screen — probe levels/level<N>.txt in order and list them.
   Picking a level reloads with ?level=N: back on the menu, the orbit
   camera shows that map rotating behind the overlay as the preview. */
const menuScreen = document.getElementById('menuScreen');
const levelScreen = document.getElementById('levelScreen');
const levelList = document.getElementById('levelList');
const levelCur = document.getElementById('levelCur');

function showLevelScreen(show) {
  levelScreen.classList.toggle('hidden', !show);
  menuScreen.classList.toggle('hidden', show);
}
document.getElementById('levelBtn').addEventListener('click', () => showLevelScreen(true));
document.getElementById('levelBack').addEventListener('click', () => showLevelScreen(false));

/* picking a level reloads the page — reopen this screen so the player
   sees the chosen map rotating before heading back to the main menu */
if (sessionStorage.getItem('mechLevelScreen')) {
  sessionStorage.removeItem('mechLevelScreen');
  showLevelScreen(true);
}

levelCur.textContent = levelName.toUpperCase(); // fallback for named levels
(async () => {
  for (let n = 1; n <= 20; n++) {
    let text;
    try {
      const res = await fetch(`levels/level${n}.txt`);
      if (!res.ok) break;
      text = await res.text();
    } catch { break; }
    // a level's title is its first comment line: "# TITLE — description"
    const first = text.split('\n').find((l) => l.startsWith('#')) || '';
    const m = first.match(/^#\s*(.+?)\s+—\s*(.*)/);
    const title = m && m[1].length <= 20 ? m[1].toUpperCase() : `LEVEL ${n}`;
    const current = `level${n}` === levelName;

    const b = document.createElement('button');
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = n;
    const info = document.createElement('span');
    info.className = 'info';
    const t = document.createElement('span');
    t.className = 'title';
    t.textContent = title;
    info.appendChild(t);
    if (m && m[2]) {
      const d = document.createElement('span');
      d.className = 'desc';
      d.textContent = m[2];
      info.appendChild(d);
    }
    b.append(num, info);
    b.classList.toggle('selected', current);
    b.addEventListener('click', () => {
      if (current) { showLevelScreen(false); return; }
      sessionStorage.setItem('mechLevelScreen', '1');
      const url = new URL(location.href);
      url.searchParams.set('level', String(n));
      location.href = url.href;
    });
    levelList.appendChild(b);
    if (current) levelCur.textContent = `${n} · ${title}`;
  }
})();

/* pull the fog back while the menu's orbit camera circles the whole map */
scene.fog.near = 300;
scene.fog.far = 900;

/* the red side gets its stats from the chosen difficulty */
function applyDifficulty() {
  const cfg = difficulty();
  for (const e of entities) {
    if (e.alive && e.team === 'red' && e.kind === 'turret') {
      e.hp = e.maxHp = cfg.turret.hp;
      e.damage = cfg.turret.damage;
      e.range = cfg.turret.range;
      e.fireInterval = cfg.turret.fireInterval;
      if (e.bar) e.bar.set(1);
    }
  }
  redBase.hp = redBase.maxHp = cfg.redBaseHp;
}

/* on victory, the end screen advances to levels/level<N+1>.txt if it exists */
let nextLevelUrl = null;

async function findNextLevel() {
  const m = levelName.match(/^level(\d+)$/);
  if (!m) return null; // named levels have no numeric successor
  const next = Number(m[1]) + 1;
  try {
    const res = await fetch(`levels/level${next}.txt`, { method: 'HEAD' });
    if (!res.ok) return null;
  } catch {
    return null;
  }
  const url = new URL(location.href);
  url.searchParams.set('level', String(next));
  return url.href;
}

export function endGame(victory) {
  if (game.state === 'over') return;
  game.state = 'over';
  document.exitPointerLock();
  const nextLevel = victory ? findNextLevel() : Promise.resolve(null);
  setTimeout(async () => {
    nextLevelUrl = await nextLevel;
    showLevelScreen(false);
    overlay.classList.remove('hidden');
    overlay.querySelector('h1').textContent = victory ? 'VICTORY' : 'BASE LOST';
    overlay.querySelector('h1').style.color = victory ? '#7CFF6B' : '#ff5040';
    overlay.querySelector('h2').textContent = victory
      ? 'ENEMY BASE DESTROYED — DISTRICT SECURED'
      : 'YOUR BASE WAS DESTROYED';
    document.getElementById('briefing').innerHTML =
      `<b>MISSION REPORT — ${difficulty().label}</b><br>Kills: <b>${stats.kills}</b> · Waves survived: <b>${stats.wave}</b> · Turrets built: <b>${stats.turretsBuilt}</b><br>` +
      (victory
        ? (nextLevelUrl ? 'Outstanding work, officer. The next district needs you.' : 'Outstanding work, officer. All districts secured.')
        : 'The district has fallen. Redeploy and try again.');
    document.getElementById('startBtn').textContent = nextLevelUrl ? 'NEXT LEVEL' : 'REDEPLOY';
  }, 1400);
  showMessage(victory ? 'ENEMY BASE DESTROYED' : 'YOUR BASE HAS FALLEN', victory ? '#7CFF6B' : '#ff5040');
  boomSfx(0.5, 1.2);
  duckMusic();
}

document.getElementById('startBtn').addEventListener('click', (e) => {
  if (game.state === 'over') {
    if (nextLevelUrl) location.href = nextLevelUrl;
    else location.reload();
    return;
  }
  e.currentTarget.blur();
  audioCtx();
  startMusic();
  scene.fog.near = 90;
  scene.fog.far = 280;
  applyDifficulty();
  overlay.classList.add('hidden');
  hud.classList.add('active');
  game.state = 'playing';
  if (!touch.active) renderer.domElement.requestPointerLock();
  showMessage('DESTROY THE ENEMY BASE', '#ffd23c');
  updateHud();
});
