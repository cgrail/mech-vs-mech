import { renderer } from '../world/scene.js';
import { game, stats, difficulty } from './state.js';
import { entities, redBase } from '../entities/entities.js';
import { audioCtx, boomSfx } from '../systems/audio.js';
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

export function endGame(victory) {
  if (game.state === 'over') return;
  game.state = 'over';
  document.exitPointerLock();
  setTimeout(() => {
    overlay.classList.remove('hidden');
    overlay.querySelector('h1').textContent = victory ? 'VICTORY' : 'BASE LOST';
    overlay.querySelector('h1').style.color = victory ? '#7CFF6B' : '#ff5040';
    overlay.querySelector('h2').textContent = victory
      ? 'ENEMY BASE DESTROYED — DISTRICT SECURED'
      : 'YOUR BASE WAS DESTROYED';
    document.getElementById('briefing').innerHTML =
      `<b>MISSION REPORT — ${difficulty().label}</b><br>Kills: <b>${stats.kills}</b> · Waves survived: <b>${stats.wave}</b> · Turrets built: <b>${stats.turretsBuilt}</b><br>` +
      (victory ? 'Outstanding work, officer.' : 'The district has fallen. Redeploy and try again.');
    document.getElementById('startBtn').textContent = 'REDEPLOY';
  }, 1400);
  showMessage(victory ? 'ENEMY BASE DESTROYED' : 'YOUR BASE HAS FALLEN', victory ? '#7CFF6B' : '#ff5040');
  boomSfx(0.5, 1.2);
}

document.getElementById('startBtn').addEventListener('click', (e) => {
  if (game.state === 'over') { location.reload(); return; }
  e.currentTarget.blur();
  audioCtx();
  applyDifficulty();
  overlay.classList.add('hidden');
  hud.classList.add('active');
  game.state = 'playing';
  renderer.domElement.requestPointerLock();
  showMessage('DESTROY THE ENEMY BASE', '#ffd23c');
  updateHud();
});
