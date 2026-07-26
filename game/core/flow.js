import { scene, lockPointer } from '../world/scene.js';
import { levelName, levels, levelMeta, levelParam, rememberLevel } from '../world/world.js';
import { switchMap, isSwitchingMap } from './mapswitch.js';
import { BOOT, bootReload } from './boot.js';
import { game, stats, difficulty, touch, DIFFICULTIES, MODES, CAPTURES_TO_WIN } from './state.js';
import { entities, redBase } from '../entities/entities.js';
import { audioCtx, boomSfx, startMusic, duckMusic } from '../systems/audio.js';
import { updateHud, showMessage } from '../ui/hud.js';
import { applyFog } from '../systems/vision.js';
import { addOption } from '../ui/menu.js';
import { MP, connected } from '../net/net.js';

/* ============================================================
   Game flow: the mission menu, start / end screens

   Every setting is one row of the same option column (ui/menu.js):
   a label, its value between ◂ ▸ steppers. Cycling through the
   values rather than putting one button per value in a row is
   what keeps the menu one column wide on a phone, and it is what
   makes ← → mean the same thing on every row.
============================================================ */
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const optList = document.getElementById('menuOpts');

/* the mission briefing is the mode's rules plus the control legend for
   whatever is actually driving the mech — a phone gets the touch legend,
   which also changes with the control scheme */
const briefingEl = document.getElementById('briefing');
const TURRET_ICO = `<svg class="turretIco" viewBox="0 0 32 32" aria-hidden="true"><rect x="7" y="25" width="18" height="4" rx="1.5" fill="#55617a"/><path d="M10 25l2-5h8l2 5z" fill="#7c8aa8"/><circle cx="16" cy="17" r="5.5" fill="#a7b4cc"/><rect x="14.2" y="2.5" width="3.8" height="14" rx="1.6" fill="#93a2bd" transform="rotate(35 16 17)"/><path d="M24.1 2.1l1.1 2.4 2.4 1.1-2.4 1.1-1.1 2.4-1.1-2.4-2.4-1.1 2.4-1.1z" fill="#ffd23c"/></svg>`;
function controlLegend() {
  if (!touch.active) {
    return `
      <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move &nbsp; <kbd>Mouse</kbd> aim &nbsp; <kbd>Shift</kbd> boost &nbsp; <kbd>Ctrl</kbd> jump jets<br>
      <kbd>LMB</kbd> / <kbd>Space</kbd> fire &nbsp; <kbd>1</kbd> machine guns &nbsp; <kbd>2</kbd> rockets (<span style="color:#ffd23c">🛢️ 20</span>) &nbsp; <kbd>3</kbd> / <kbd>T</kbd> build turret (<span style="color:#ffd23c">🛢️ 100</span>)<br>
      <kbd>Q</kbd> / <kbd>RMB</kbd> quick rocket &nbsp; — machine guns are free, rockets &amp; turrets cost salvage<br>
      <kbd>↑</kbd><kbd>↓</kbd> menu &nbsp; <kbd>←</kbd><kbd>→</kbd> change &nbsp; <kbd>Enter</kbd> select &nbsp; <kbd>Esc</kbd> release mouse`;
  }
  const scheme = touch.scheme === 'gyro'
    ? `<kbd>🧭 Turn phone</kbd> rotate mech &nbsp; <kbd>📱 Lean</kbd> forward / back to move<br>
       <kbd>📱 Tilt sideways</kbd> strafe &nbsp; <kbd>👆 Touch screen</kbd> machine guns<br>`
    : `<kbd>👈 Left thumb</kbd> joystick — move &amp; strafe<br>
       <kbd>👉 Right thumb</kbd> drag to turn · hold to fire machine guns<br>`;
  return `${scheme}<kbd>⬆️</kbd> jump jets — clear a ledge onto high ground<br>
      <kbd>🚀</kbd> rockets (<span style="color:#ffd23c">🛢️ 20</span>) &nbsp;
      <kbd>${TURRET_ICO}</kbd> build turret in front of you (<span style="color:#ffd23c">🛢️ 100</span>)`;
}
const MISSIONS = {
  assault: `<b style="color:#ffd23c">MISSION:</b> Destroy the <b style="color:#ff8a7a">red enemy base</b> at the far end of the
      district before enemy assault mechs destroy <b style="color:#8ab4ff">yours</b>.<br>
      Enemy waves march on your base — build turrets to hold them off.`,
  ctf: `<b style="color:#ffd23c">MISSION:</b> Take the <b style="color:#ff8a7a">red flag</b> from the enemy courtyard and run it back to
      <b style="color:#8ab4ff">your own stand</b> — <b>${CAPTURES_TO_WIN} captures</b> win the district.<br>
      The enemy is after yours: a dropped flag goes home by itself after 25s, or instantly if you touch it.
      Destroying the enemy base still wins outright.`,
};
export function updateBriefing() {
  briefingEl.innerHTML = `${MISSIONS[game.mode]}<br><br>${controlLegend()}`;
}

/* level select screen — world.js already fetched the level bundle, so
   the whole list builds from the imported `levels` with no HTTP calls.
   Picking a level swaps the map in place (core/mapswitch.js, the same
   call the multiplayer lobby previews a room's map with): the orbit
   camera keeps running and the new map flies in behind the overlay. */
const menuScreen = document.getElementById('menuScreen');
const levelScreen = document.getElementById('levelScreen');
const levelList = document.getElementById('levelList');

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
document.getElementById('levelBack').addEventListener('click', () => showLevelScreen(false));

/* redeploy / next level is a reload — stay in the single-player menu
   (index.html already unhid it before first paint, off the same flag) */
if (BOOT.screen === 'menu') showModeScreen(false);

const levelBtns = []; // [{ b, name, label }] — the list's current-map marks

/* the label the MAP row shows: "7 · THE RIFT", or the bare name for a map
   that isn't in the list (a draft opened by name) */
function levelLabel(name) {
  const i = levels.findIndex((l) => l.name === name);
  return i < 0 ? name.toUpperCase() : `${i + 1} · ${levelMeta(levels[i]).title}`;
}

function reflectLevel() {
  for (const { b, name } of levelBtns) b.classList.toggle('selected', name === levelName);
  mapOpt.reflect();
}

/* Fly another map in behind the menu. `hideOverlay` reproduces the shape the
   old reload-split animation had (used by the level list); the ◂ ▸ steppers
   leave the menu up so maps can be toggled through quickly. */
function goLevel(name, hideOverlay) {
  if (name === levelName && !isSwitchingMap()) return;
  if (hideOverlay) overlay.classList.add('hidden');
  switchMap(name, () => {
    if (hideOverlay) overlay.classList.remove('hidden');
    stepTarget = null;
    reflectLevel();
    rememberLevel(levelName); // the pick is browser state — a refresh comes back to it
  });
}

/* ◂ / ▸ : straight to the neighbouring map, wrapping at both ends. A press
   during a fly is queued by switchMap (last one wins), so stepping counts
   from where we are *heading*, not from the map still on screen. */
let stepTarget = null;

function stepLevel(dir) {
  if (levels.length < 2) return;
  const from = stepTarget || levelName;
  const i = levels.findIndex((l) => l.name === from);
  const next = levels[((i < 0 ? 0 : i) + dir + levels.length) % levels.length];
  stepTarget = next.name;
  mapOpt.reflect();   // label leads, map follows it in
  goLevel(next.name, false);
}

/* ============================================================
   The option column — every setting is one row of the same size
   (ui/menu.js; ← → step a row, ↑ ↓ walk the column)
============================================================ */

/* MAP: the steppers go to the neighbouring map, the row itself opens the
   full list. `stepTarget` is where a queued fly is *heading*, so repeated
   presses count on from there rather than from the map still on screen. */
const mapOpt = addOption(optList, {
  label: 'MAP',
  get: () => levelLabel(stepTarget || levelName), // no fixed value list: the map editor adds and removes maps
  step: stepLevel,
  activate: () => showLevelScreen(true),
  title: 'Pick the district to fight over',
});
mapOpt.main.classList.add('open'); // draws the ▾ that says "opens a list"

/* CONTROL SCHEME: touch devices only — the row is not built at all elsewhere.
   systems/mobile.js reads touch.scheme; the briefing shows its legend. */
if (touch.active) {
  addOption(optList, {
    label: 'CONTROLS',
    values: [{ v: 'joystick', label: '🕹️ JOYSTICK' }, { v: 'gyro', label: '📱 GYRO' }],
    get: () => touch.scheme,
    set: (v) => {
      touch.scheme = v;
      localStorage.setItem('mechControls', v);
      updateBriefing();
    },
  });
}

/* MODE: base assault or capture the flag. Single player only — a multiplayer
   match plays its room's mode, dealt out with the credentials (net.js), so
   the whole column is hidden there. The flags themselves live in
   systems/ctf.js and listen for the change. */
addOption(optList, {
  label: 'MODE',
  values: Object.entries(MODES).map(([v, m]) => ({ v, label: m.label })),
  get: () => game.mode,
  set: (v) => {
    game.mode = v;
    localStorage.setItem('mechMode', v);
    updateBriefing();
    window.dispatchEvent(new Event('mech:modechanged'));
  },
  title: 'Destroy their base, or run their flag home',
});

addOption(optList, {
  label: 'DIFFICULTY',
  values: Object.entries(DIFFICULTIES).map(([v, d]) => ({ v, label: d.label })),
  get: () => game.difficulty,
  set: (v) => {
    game.difficulty = v;
    localStorage.setItem('mechDifficulty', v);
  },
  title: 'How hard the red side hits back',
});

/* fog of war: a local view restriction (systems/vision.js), remembered like
   the difficulty. Toggling it mid-game re-fogs the district right away. */
addOption(optList, {
  label: '🌫️ FOG OF WAR',
  values: [{ v: false, label: 'OFF' }, { v: true, label: 'ON' }],
  get: () => game.fogOfWar,
  set: (v) => {
    game.fogOfWar = v;
    localStorage.setItem('mechFog', v ? '1' : '0');
    if (game.state === 'playing') applyFog();
  },
  title: 'Sensors only: enemies vanish out of sight',
});

updateBriefing();

/* the level list is rebuilt, not just marked, because the map editor can add,
   rename and delete maps while the menu is up (ui/editor.js fires
   `mech:levelchanged` once its map is in) */
function buildLevelList() {
  levelList.textContent = '';
  levelBtns.length = 0;
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
      goLevel(name, true);
    });
    levelBtns.push({ b, name });
    levelList.appendChild(b);
  });
  reflectLevel();
}

buildLevelList();
window.addEventListener('mech:levelchanged', buildLevelList);
{
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
let nextLevel = null;

function findNextLevel() {
  const i = levels.findIndex((l) => l.name === levelName);
  if (i < 0 || i + 1 >= levels.length) return null; // unlisted or last level
  return levels[i + 1].name;
}

export function endGame(victory, reason) {
  if (game.state === 'over') return;
  game.state = 'over';
  if (document.exitPointerLock) document.exitPointerLock(); // undefined on iOS Safari
  setTimeout(() => {
    nextLevel = victory && !MP.active ? findNextLevel() : null;
    showLevelScreen(false);
    overlay.classList.remove('hidden');
    overlay.querySelector('h1').textContent = victory ? 'VICTORY'
      : MP.active || game.mode === 'ctf' ? 'DEFEAT' : 'BASE LOST';
    overlay.querySelector('h1').style.color = victory ? '#7CFF6B' : '#ff5040';
    overlay.querySelector('h2').textContent = reason || (victory
      ? 'ENEMY BASE DESTROYED — DISTRICT SECURED'
      : 'YOUR BASE WAS DESTROYED');
    // the end screen reuses the menu — going back to mode select doesn't apply here
    document.getElementById('menuBack').classList.add('mpHidden');
    if (MP.active) {
      // the whole option column is single player's (map, mode and difficulty
      // are the room's call in a match)
      optList.classList.add('mpHidden');
      // roll the whole roster on to the next map without a trip through the
      // lobby (wired in lobby.js, which owns the socket) — only worth
      // offering while we can still reach the server
      if (connected()) {
        document.getElementById('nextMapBtn').classList.remove('mpHidden');
        document.getElementById('startBtn').classList.add('ghost');
      }
      const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      const mates = MP.roster.filter((p) => p.team === MP.myTeam && p.id !== MP.playerId).map((p) => p.name);
      const foes = MP.roster.filter((p) => p.team !== MP.myTeam).map((p) => p.name);
      document.getElementById('briefing').innerHTML =
        `<b>MULTIPLAYER ${MODES[game.mode].label} — ${MP.myTeam.toUpperCase()} TEAM vs ${esc(foes.join(' · '))}</b><br>` +
        (mates.length ? `Fought beside <b>${esc(mates.join(' · '))}</b><br>` : '') +
        `Kills: <b>${stats.kills}</b> · Turrets built: <b>${stats.turretsBuilt}</b>` +
        (game.mode === 'ctf' ? ` · Captures: <b>${stats.captures[MP.myTeam]} : ${stats.captures[MP.enemyTeam]}</b>` : '') + '<br>' +
        (victory
          ? 'District secured, officer. Head back to the lobby for the next battle.'
          : 'The district has fallen. Return to the lobby and take the rematch.');
      document.getElementById('startBtn').textContent = 'BACK TO LOBBY';
    } else {
      document.getElementById('briefing').innerHTML =
        `<b>MISSION REPORT — ${MODES[game.mode].label} · ${difficulty().label}</b><br>Kills: <b>${stats.kills}</b> · Waves survived: <b>${stats.wave}</b> · Turrets built: <b>${stats.turretsBuilt}</b>` +
        (game.mode === 'ctf' ? ` · Captures: <b>${stats.captures.blue} : ${stats.captures.red}</b>` : '') + '<br>' +
        (victory
          ? (nextLevel ? 'Outstanding work, officer. The next district needs you.' : 'Outstanding work, officer. All districts secured.')
          : 'The district has fallen. Redeploy and try again.');
      document.getElementById('startBtn').textContent = nextLevel ? 'NEXT LEVEL' : 'REDEPLOY';
    }
  }, 1400);
  showMessage(victory ? 'ENEMY BASE DESTROYED' : 'YOUR BASE HAS FALLEN', victory ? '#7CFF6B' : '#ff5040');
  boomSfx(0.5, 1.2);
  duckMusic();
}

/* leave a multiplayer match: reload straight back into the lobby. The match
   credentials were consumed at boot, so this load simply isn't a match any
   more; the map goes unmentioned, and the lobby opens on the remembered
   single-player one. */
export function backToLobby() {
  bootReload({ screen: 'lobby' });
}

/* used by the DEPLOY button (single player) and the multiplayer
   ready-handshake once both players are in */
export function startGame() {
  audioCtx();
  startMusic();
  applyFog(); // normal play fog, or the tight one when fog of war is on
  if (!MP.active) applyDifficulty(); // PvP is symmetric: no difficulty scaling
  overlay.classList.add('hidden');
  hud.classList.add('active');
  game.state = 'playing';
  if (!touch.active) lockPointer();
  showMessage(game.mode === 'ctf' ? 'TAKE THEIR FLAG — DEFEND YOURS' : 'DESTROY THE ENEMY BASE', '#ffd23c');
  updateHud();
}

document.getElementById('startBtn').addEventListener('click', (e) => {
  if (game.state === 'over') {
    if (MP.active) { backToLobby(); return; }
    // continuing the single-player session: the reload is handed the map and
    // "open on the mission menu", so it skips the mode select (core/boot.js)
    bootReload({ screen: 'menu', level: levelParam(nextLevel || levelName) });
    return;
  }
  e.currentTarget.blur();
  startGame();
});
