import { renderer } from '../world/scene.js';
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
  applyDifficulty();
  overlay.classList.add('hidden');
  hud.classList.add('active');
  game.state = 'playing';
  if (!touch.active) renderer.domElement.requestPointerLock();
  showMessage('DESTROY THE ENEMY BASE', '#ffd23c');
  updateHud();
});
