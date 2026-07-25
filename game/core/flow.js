import { scene, lockPointer } from '../world/scene.js';
import { levelName, levels, levelMeta, levelParam } from '../world/world.js';
import { switchMap, isSwitchingMap } from './mapswitch.js';
import { game, stats, difficulty, touch } from './state.js';
import { entities, redBase } from '../entities/entities.js';
import { audioCtx, boomSfx, startMusic, duckMusic } from '../systems/audio.js';
import { updateHud, showMessage } from '../ui/hud.js';
import { MP } from '../net/net.js';

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

/* level select screen — world.js already fetched the level bundle, so
   the whole list builds from the imported `levels` with no HTTP calls.
   Picking a level swaps the map in place (core/mapswitch.js, the same
   call the multiplayer lobby previews a room's map with): the orbit
   camera keeps running and the new map flies in behind the overlay. */
const menuScreen = document.getElementById('menuScreen');
const levelScreen = document.getElementById('levelScreen');
const levelList = document.getElementById('levelList');
const levelCur = document.getElementById('levelCur');

/* mode select — the first screen offers only single or multiplayer;
   SINGLE PLAYER opens the mission menu (briefing, level select, difficulty),
   MULTIPLAYER is wired in lobby.js. Boot paths that skip the mode screen
   (level switch, match boot, lobby return) hide it pre-paint in index.html. */
const modeScreen = document.getElementById('modeScreen');
function showModeScreen(show) {
  modeScreen.classList.toggle('hidden', !show);
  menuScreen.classList.toggle('hidden', show);
}
document.getElementById('spBtn').addEventListener('click', () => showModeScreen(false));
document.getElementById('menuBack').addEventListener('click', () => showModeScreen(true));

function showLevelScreen(show) {
  levelScreen.classList.toggle('hidden', !show);
  menuScreen.classList.toggle('hidden', show);
  overlay.classList.toggle('level', show); // hides the title, lighter dimming
}
document.getElementById('levelBtn').addEventListener('click', () => showLevelScreen(true));
document.getElementById('levelBack').addEventListener('click', () => showLevelScreen(false));

/* redeploy / next level is a reload — stay in the single-player menu */
if (sessionStorage.getItem('mechSpMenu')) {
  sessionStorage.removeItem('mechSpMenu');
  showModeScreen(false);
}

levelCur.textContent = levelName.toUpperCase(); // fallback for unlisted levels

const levelBtns = []; // [{ b, name, label }] — the list's current-map marks

function reflectLevel() {
  for (const { b, name, label } of levelBtns) {
    const current = name === levelName;
    b.classList.toggle('selected', current);
    if (current) levelCur.textContent = label;
  }
}

{
  levels.forEach((entry, i) => {
    const { name } = entry;
    const n = i + 1;
    const { title, desc } = levelMeta(entry);

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
    if (desc) {
      const d = document.createElement('span');
      d.className = 'desc';
      d.textContent = desc;
      info.appendChild(d);
    }
    b.append(num, info);
    b.addEventListener('click', () => {
      if (isSwitchingMap()) return; // a switch is already flying
      if (name === levelName) { showLevelScreen(false); return; }
      // hide the overlay for the fly-out, bring it back with the new map on
      // its way down — the shape the old reload-split animation had
      overlay.classList.add('hidden');
      switchMap(name, () => {
        overlay.classList.remove('hidden');
        reflectLevel();
        // REDEPLOY is a plain location.reload(), so keep ?level= truthful
        const url = new URL(location.href);
        url.searchParams.set('level', levelParam(levelName));
        history.replaceState(null, '', url);
      });
    });
    levelBtns.push({ b, name, label: `${n} · ${title}` });
    levelList.appendChild(b);
  });
  reflectLevel();
  // start the scrollable list centered on the current level
  const sel = levelList.querySelector('button.selected');
  if (sel) levelList.scrollTop = sel.offsetTop - (levelList.clientHeight - sel.offsetHeight) / 2;
  // the screen stays invisible until every level entry is in place
  setTimeout(() => levelScreen.classList.remove('loading'), 1200);
}

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

/* on victory, the end screen advances to the next level in the bundle */
let nextLevelUrl = null;

function findNextLevel() {
  const i = levels.findIndex((l) => l.name === levelName);
  if (i < 0 || i + 1 >= levels.length) return null; // unlisted or last level
  const url = new URL(location.href);
  url.searchParams.set('level', levelParam(levels[i + 1].name));
  return url.href;
}

export function endGame(victory, reason) {
  if (game.state === 'over') return;
  game.state = 'over';
  if (document.exitPointerLock) document.exitPointerLock(); // undefined on iOS Safari
  setTimeout(() => {
    nextLevelUrl = victory && !MP.active ? findNextLevel() : null;
    showLevelScreen(false);
    overlay.classList.remove('hidden');
    overlay.querySelector('h1').textContent = victory ? 'VICTORY' : MP.active ? 'DEFEAT' : 'BASE LOST';
    overlay.querySelector('h1').style.color = victory ? '#7CFF6B' : '#ff5040';
    overlay.querySelector('h2').textContent = reason || (victory
      ? 'ENEMY BASE DESTROYED — DISTRICT SECURED'
      : 'YOUR BASE WAS DESTROYED');
    // the end screen reuses the menu — going back to mode select doesn't apply here
    document.getElementById('menuBack').classList.add('mpHidden');
    if (MP.active) {
      // its single-player widgets don't apply here either
      for (const id of ['levelBtn', 'diffRow', 'ctrlRow']) {
        document.getElementById(id).classList.add('mpHidden');
      }
      const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      const mates = MP.roster.filter((p) => p.team === MP.myTeam && p.id !== MP.playerId).map((p) => p.name);
      const foes = MP.roster.filter((p) => p.team !== MP.myTeam).map((p) => p.name);
      document.getElementById('briefing').innerHTML =
        `<b>MULTIPLAYER — ${MP.myTeam.toUpperCase()} TEAM vs ${esc(foes.join(' · '))}</b><br>` +
        (mates.length ? `Fought beside <b>${esc(mates.join(' · '))}</b><br>` : '') +
        `Kills: <b>${stats.kills}</b> · Turrets built: <b>${stats.turretsBuilt}</b><br>` +
        (victory
          ? 'District secured, officer. Head back to the lobby for the next battle.'
          : 'The district has fallen. Return to the lobby and take the rematch.');
      document.getElementById('startBtn').textContent = 'BACK TO LOBBY';
    } else {
      document.getElementById('briefing').innerHTML =
        `<b>MISSION REPORT — ${difficulty().label}</b><br>Kills: <b>${stats.kills}</b> · Waves survived: <b>${stats.wave}</b> · Turrets built: <b>${stats.turretsBuilt}</b><br>` +
        (victory
          ? (nextLevelUrl ? 'Outstanding work, officer. The next district needs you.' : 'Outstanding work, officer. All districts secured.')
          : 'The district has fallen. Redeploy and try again.');
      document.getElementById('startBtn').textContent = nextLevelUrl ? 'NEXT LEVEL' : 'REDEPLOY';
    }
  }, 1400);
  showMessage(victory ? 'ENEMY BASE DESTROYED' : 'YOUR BASE HAS FALLEN', victory ? '#7CFF6B' : '#ff5040');
  boomSfx(0.5, 1.2);
  duckMusic();
}

/* leave a multiplayer match: reload without ?mp and reopen the lobby */
export function backToLobby() {
  sessionStorage.removeItem('mechMpMatch');
  sessionStorage.setItem('mechMpReturn', '1');
  const url = new URL(location.href);
  url.searchParams.delete('mp');
  location.href = url.href;
}

/* used by the DEPLOY button (single player) and the multiplayer
   ready-handshake once both players are in */
export function startGame() {
  audioCtx();
  startMusic();
  scene.fog.near = 90;
  scene.fog.far = 280;
  if (!MP.active) applyDifficulty(); // PvP is symmetric: no difficulty scaling
  overlay.classList.add('hidden');
  hud.classList.add('active');
  game.state = 'playing';
  if (!touch.active) lockPointer();
  showMessage('DESTROY THE ENEMY BASE', '#ffd23c');
  updateHud();
}

document.getElementById('startBtn').addEventListener('click', (e) => {
  if (game.state === 'over') {
    if (MP.active) { backToLobby(); return; }
    // continuing the single-player session: skip mode select after the reload
    sessionStorage.setItem('mechSpMenu', '1');
    if (nextLevelUrl) location.href = nextLevelUrl;
    else location.reload();
    return;
  }
  e.currentTarget.blur();
  startGame();
});
