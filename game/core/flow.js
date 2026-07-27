import { scene, lockPointer } from '../world/scene.js';
import { levelName, levels, levelMeta, levelParam, rememberLevel } from '../world/world.js';
import { switchMap, isSwitchingMap } from './mapswitch.js';
import { BOOT, bootReload } from './boot.js';
import { game, stats, difficulty, touch, DIFFICULTIES, MODES, CAPTURES_TO_WIN } from './state.js';
import { entities, redBase } from '../entities/entities.js';
import { audioCtx, boomSfx, startMusic, duckMusic } from '../systems/audio.js';
import { updateHud, showMessage } from '../ui/hud.js';
import { applyFog } from '../systems/vision.js';
import { addOption, addAction, addHero, addMapRow, addPickCards, MODE_UI, modeUi } from '../ui/menu.js';
import { showSettings } from '../ui/settings.js';
import { keyName } from '../systems/bindings.js';
import { mapThumb, thumbBox } from '../ui/thumb.js';
import { MP, connected } from '../net/net.js';

/* ============================================================
   Game flow: the mission menu, start / end screens

   The menu is one column of titled cards (ui/menu.js explains the
   layout): the district on a card with its own picture, the mode
   as two cards you tick, and the settings that are values rather
   than choices — difficulty, controls, fog — as LABEL · VALUE
   rows between ◂ ▸ steppers inside the setup card.
============================================================ */
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const optList = document.getElementById('menuOpts');
const mapPick = document.getElementById('mapPick');
const modePick = document.getElementById('modePick');
/* the cards the end screen has no use for in a multiplayer match */
const roomCards = ['mapCard', 'modeCard', 'setupCard'].map((id) => document.getElementById(id));

/* the mission briefing is the mode's rules plus the control legend for
   whatever is actually driving the mech — a phone gets the touch legend,
   which also changes with the control scheme */
const briefingEl = document.getElementById('briefing');
const TURRET_ICO = `<svg class="turretIco" viewBox="0 0 32 32" aria-hidden="true"><rect x="7" y="25" width="18" height="4" rx="1.5" fill="#55617a"/><path d="M10 25l2-5h8l2 5z" fill="#7c8aa8"/><circle cx="16" cy="17" r="5.5" fill="#a7b4cc"/><rect x="14.2" y="2.5" width="3.8" height="14" rx="1.6" fill="#93a2bd" transform="rotate(35 16 17)"/><path d="M24.1 2.1l1.1 2.4 2.4 1.1-2.4 1.1-1.1 2.4-1.1-2.4-2.4-1.1 2.4-1.1z" fill="#ffd23c"/></svg>`;
function controlLegend() {
  if (!touch.active) {
    // the keys the pilot actually has: the legend is drawn from the bindings
    // table, so it follows whatever the settings screen made of them
    const k = (id) => `<kbd>${keyName(id)}</kbd>`;
    return `
      ${k('forward')}${k('strafeL')}${k('back')}${k('strafeR')} move &nbsp; <kbd>Mouse</kbd> aim &nbsp; ${k('boost')} boost &nbsp; ${k('jump')} jump jets<br>
      <kbd>LMB</kbd> / ${k('fire')} fire &nbsp; ${k('weapon1')} machine guns &nbsp; ${k('weapon2')} rockets (<span style="color:#ffd23c">🛢️ 20</span>) &nbsp; ${k('turret')} build turret (<span style="color:#ffd23c">🛢️ 100</span>)<br>
      ${k('rocket')} / <kbd>RMB</kbd> quick rocket &nbsp; — machine guns are free, rockets &amp; turrets cost salvage<br>
      <kbd>↑</kbd><kbd>↓</kbd> menu &nbsp; <kbd>←</kbd><kbd>→</kbd> change &nbsp; <kbd>Enter</kbd> select &nbsp; <kbd>Esc</kbd> release mouse`;
  }
  const scheme = touch.scheme === 'gyro'
    ? `<kbd>🧭 Turn phone</kbd> rotate mech &nbsp; <kbd>📱 Lean</kbd> forward / back to move<br>
       <kbd>📱 Lean hard</kbd> forward to run &nbsp; <kbd>📱 Tilt sideways</kbd> strafe<br>
       <kbd>👆 Touch screen</kbd> machine guns<br>`
    : `<kbd>👈 Left thumb</kbd> joystick — move &amp; strafe · push it right forward to run<br>
       <kbd>👉 Right thumb</kbd> drag to turn · hold to fire machine guns<br>`;
  return `${scheme}<kbd>⬆️</kbd> jump jets — clear a ledge onto high ground<br>
      <kbd>🚀</kbd> rockets (<span style="color:#ffd23c">🛢️ 20</span>) &nbsp;
      <kbd>${TURRET_ICO}</kbd> build turret beside you (<span style="color:#ffd23c">🛢️ 100</span>)`;
}
const MISSIONS = {
  assault: `<b style="color:#ffd23c">MISSION:</b> Destroy the <b style="color:#ff8a7a">red enemy base</b> at the far end of the
      district before enemy assault mechs destroy <b style="color:#8ab4ff">yours</b>.<br>
      Enemy waves march on your base — build turrets to hold them off.`,
  ctf: `<b style="color:#ffd23c">MISSION:</b> Take the <b style="color:#ff8a7a">red flag</b> from the enemy courtyard and run it back to
      <b style="color:#8ab4ff">your own stand</b> — <b>${CAPTURES_TO_WIN} captures</b> win the district.<br>
      The enemy is after yours: a dropped flag goes home by itself after 25s, or instantly if you touch it.
      Only captures win here — you can still level their base, and it stops their waves, but it won't take the district.`,
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
  overlay.classList.toggle('level', show); // lighter dimming, the map shows through
}
document.getElementById('levelBack').addEventListener('click', () => showLevelScreen(false));

/* redeploy / next level is a reload — stay in the single-player menu
   (index.html already unhid it before first paint, off the same flag) */
if (BOOT.screen === 'menu') showModeScreen(false);

const levelBtns = []; // [{ b, name, label }] — the list's current-map marks

function reflectLevel() {
  for (const { b, name } of levelBtns) b.classList.toggle('selected', name === levelName);
  reflectMap();
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
  reflectMap();   // the card leads, the map follows it in
  goLevel(next.name, false);
}

/* ============================================================
   The card column — the district and the mode are cards you tick,
   the rest are values you cycle (ui/menu.js; ← → step a row,
   ↑ ↓ walk the screen)
============================================================ */

/* MAP: the district itself, drawn from its level text (ui/thumb.js). ◂ ▸ go to
   the neighbouring map, the card opens the full list. `stepTarget` is where a
   queued fly is *heading*, so repeated presses count on from there rather than
   from the map still on screen. */
const mapHero = addHero(mapPick, {
  step: stepLevel,
  activate: () => showLevelScreen(true),
});
const mapNote = document.createElement('div');
mapNote.className = 'cardNote';
mapPick.appendChild(mapNote);

function reflectMap() {
  const name = stepTarget || levelName;
  const i = levels.findIndex((l) => l.name === name);
  const entry = i < 0 ? null : levels[i];
  const meta = entry ? levelMeta(entry) : { title: name.toUpperCase(), desc: '' };
  mapHero.render({
    thumb: entry ? mapThumb(entry.text) : null,
    title: meta.title,
    meta: `${modeUi(game.mode).title} · ${difficulty().label}`,
    desc: meta.desc,
  });
  mapNote.textContent = i < 0
    ? 'A DRAFT MAP — TAP THE CARD FOR THE FULL LIST'
    : `MAP ${i + 1} OF ${levels.length} · TAP THE CARD FOR THE FULL LIST`;
}

/* MODE: base assault or capture the flag, one card each. Single player only —
   a multiplayer match plays its room's mode, dealt out with the credentials
   (net.js), so this card is hidden there. The flags themselves live in
   systems/ctf.js and listen for the change. */
addPickCards(modePick, {
  values: MODE_UI,
  get: () => game.mode,
  set: (v) => {
    game.mode = v;
    localStorage.setItem('mechMode', v);
    updateBriefing();
    reflectMap();     // the map card names the mode it will be played in
    window.dispatchEvent(new Event('mech:modechanged'));
  },
});

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

addOption(optList, {
  label: 'DIFFICULTY',
  values: Object.entries(DIFFICULTIES).map(([v, d]) => ({ v, label: d.label })),
  get: () => game.difficulty,
  set: (v) => {
    game.difficulty = v;
    localStorage.setItem('mechDifficulty', v);
    reflectMap();     // the map card names the difficulty it will be played on
  },
  title: 'How hard the red side hits back',
});

/* Night mode — what the code still calls fog of war (systems/vision.js): the
   district after dark, with the mech's lamp and its sensors in place of the
   god's-eye view. Single player's own choice, remembered like the difficulty,
   and toggling it mid-game changes the weather right away.

   It restricts the view and never the simulation, so it is safe in PvP — but
   it is still not a *pilot's* setting there: a match fought at night by one
   side and in daylight by the other is one district in two kinds of weather.
   In multiplayer the room's creator sets it for everybody (ui/lobby.js has
   the row, the server holds the answer, net.js reads it back off the match
   credentials), and this row belongs to the single-player menu alone. */
addOption(optList, {
  label: '🌙 LIGHTING',
  values: [{ v: false, label: 'DAY MODE' }, { v: true, label: 'NIGHT MODE' }],
  get: () => game.fogOfWar,
  set: (v) => {
    game.fogOfWar = v;
    localStorage.setItem('mechFog', v ? '1' : '0');
    if (game.state === 'playing') applyFog();
  },
  title: 'Night mode: your lamp and your sensors are all you get',
});

/* KEY BINDINGS: a row that opens a screen rather than holding a value, so the
   controls can be changed from the mission menu as well as from the entry
   screen. Keyboard only — a phone has nothing to rebind (ui/settings.js). */
if (!touch.active) {
  addAction(optList, {
    label: '⌨ KEY BINDINGS',
    value: 'CUSTOMISE ▸',
    onClick: () => showSettings(true, menuScreen),
  });
}

updateBriefing();
// the legend names the bound keys, so it is redrawn when they move
window.addEventListener('mech:keyschanged', updateBriefing);

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

    // the same row the lobby's map picker builds (ui/menu.js)
    const b = addMapRow(levelList, {
      n, title, desc, text: entry.text,
      onPick: () => {
        if (isSwitchingMap()) return; // a switch is already flying
        if (name === levelName) { showLevelScreen(false); return; }
        goLevel(name, true);
      },
    });
    levelBtns.push({ b, name });
  });
  document.getElementById('levelCount').textContent = `${levels.length} MAPS`;
  reflectLevel();
}

buildLevelList();
window.addEventListener('mech:levelchanged', buildLevelList);
// the screen stays invisible until every level entry is in place. It opens
// centered on the district that is already on screen — that is the menu cursor
// landing on the marked row, nothing here (ui/menu.js `focusFirst`).
setTimeout(() => levelScreen.classList.remove('loading'), 1200);

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
    // the end screen is the mission menu with a result card on top of its
    // column and the briefing turned into the report (index.html)
    const title = document.getElementById('resultTitle');
    title.textContent = victory ? 'VICTORY'
      : MP.active || game.mode === 'ctf' ? 'DEFEAT' : 'BASE LOST';
    title.style.color = victory ? '#7CFF6B' : '#ff5040';
    document.getElementById('resultSub').textContent = reason || (victory
      ? 'ENEMY BASE DESTROYED — DISTRICT SECURED'
      : 'YOUR BASE WAS DESTROYED');
    document.getElementById('resultCard').classList.remove('mpHidden');
    document.getElementById('menuTitle').textContent = MP.active ? 'MULTIPLAYER MATCH' : 'MISSION COMPLETE';
    // going back to the mode select doesn't apply here
    document.getElementById('menuBack').classList.add('mpHidden');
    document.getElementById('briefHead').textContent = 'MISSION REPORT';
    if (MP.active) {
      // map, mode and difficulty are the room's call in a match, so those
      // cards have nothing to say on a match's end screen
      for (const c of roomCards) c.classList.add('mpHidden');
      // roll the whole roster on to the next map without a trip through the
      // lobby (wired in lobby.js, which owns the socket) — only worth
      // offering while we can still reach the server
      if (connected()) {
        document.getElementById('nextMapBtn').classList.remove('mpHidden');
        // NEXT MAP is the green one now; leaving is the quiet button
        const start = document.getElementById('startBtn');
        start.classList.remove('goBtn');
        start.classList.add('ghost');
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
        `<b>${MODES[game.mode].label} · ${difficulty().label}</b><br>Kills: <b>${stats.kills}</b> · Waves survived: <b>${stats.wave}</b> · Turrets built: <b>${stats.turretsBuilt}</b>` +
        (game.mode === 'ctf' ? ` · Captures: <b>${stats.captures.blue} : ${stats.captures.red}</b>` : '') + '<br>' +
        (victory
          ? (nextLevel ? 'Outstanding work, officer. The next district needs you.' : 'Outstanding work, officer. All districts secured.')
          : 'The district has fallen. Redeploy and try again.');
      document.getElementById('startBtn').textContent = nextLevel ? 'NEXT LEVEL' : 'REDEPLOY';
    }
    // the multiplayer end screen counts itself down to the next map (lobby.js)
    window.dispatchEvent(new Event('mech:endscreen'));
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
  applyFog(); // daylight district, or nightfall + the mech's lamp with fog of war on
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
    /* Continuing the single-player session. A won district hands the next one
       over as a *fight* — nothing to pick, no DEPLOY, straight back in. Every
       other end (a loss, or the last district in the bundle) reloads onto the
       mission menu instead, which is where the map, the mode and the
       difficulty are, and is what somebody who just lost came for. */
    bootReload(nextLevel
      ? { screen: 'play', level: levelParam(nextLevel) }
      : { screen: 'menu', level: levelParam(levelName) });
    return;
  }
  e.currentTarget.blur();
  startGame();
});
