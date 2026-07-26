import { MP, connect, disconnect, connected, on, send } from '../net/net.js';
import { game, MODES } from '../core/state.js';
import { levelName, levels, levelMeta, levelParam } from '../world/world.js';
import { switchMap } from '../core/mapswitch.js';
import { BOOT, bootReload } from '../core/boot.js';
import { startGame, backToLobby } from '../core/flow.js';
import { audioCtx } from '../systems/audio.js';

/* ============================================================
   Multiplayer UI — rooms of team matches, up to 5 v 5

   Lobby (from the mode select): pick a callsign → join → create a
   room or join one from the list → pick a team (blue or red, max
   5 per side) → once both teams have at least one pilot, anyone
   on a team can START MATCH. Rooms are independent: each stages
   its own match, so several groups can fight in parallel. The
   room's creator owns it and picks the map and the mode (base
   assault or capture the flag) everyone plays — the server holds
   both choices, so joiners just see them. The server deals out
   match credentials and every rostered player reloads with them —
   the room's map, and the mode — in the boot handoff (core/boot.js,
   read by net.js).

   Match boot: reconnect, rejoin by token, then a READY handshake so
   the fight starts for everyone at once.
============================================================ */
const modeScreen = document.getElementById('modeScreen');
const mpScreen = document.getElementById('mpScreen');
const matchScreen = document.getElementById('matchScreen');
const statusEl = document.getElementById('mpStatus');
const nameRow = document.getElementById('mpNameRow');
const nameInput = document.getElementById('mpNameInput');
const joinBtn = document.getElementById('mpJoinBtn');
const bannerEl = document.getElementById('mpBanner');
const roomsEl = document.getElementById('mpRooms');
const roomListEl = document.getElementById('mpRoomList');
const createBtn = document.getElementById('mpCreateBtn');
const roomBar = document.getElementById('mpRoomBar');
const roomNameEl = document.getElementById('mpRoomName');
const mapSelect = document.getElementById('mpMapSelect');
const mapPrevBtn = document.getElementById('mpMapPrev');
const mapNextBtn = document.getElementById('mpMapNext');
const mapNameEl = document.getElementById('mpMapName');
const modeSelect = document.getElementById('mpModeSelect');
const modeNameEl = document.getElementById('mpModeName');
const leaveBtn = document.getElementById('mpLeaveBtn');
const teamsEl = document.getElementById('mpTeams');
const listEl = document.getElementById('mpList');
const startBtn = document.getElementById('mpStartBtn');
const matchInfo = document.getElementById('matchInfo');
const readyBtn = document.getElementById('readyBtn');

const TEAM_MAX = 5; // mirrors the server's cap; the server enforces it
const show = (el, on) => el.classList.toggle('mpHidden', !on);

/* A match starts by reloading into it: the credentials, the room's map and
   "open on the match screen" ride along in the boot handoff. Used both from
   the lobby and from a finished match's NEXT MAP. */
function enterMatch(m, name) {
  bootReload({
    screen: 'match',
    level: m.level,
    match: {
      matchId: m.matchId, token: m.token, playerId: m.playerId,
      team: m.team, name, roster: m.roster, mode: m.mode,
    },
  });
}

/* map picker: the level bundle this page loaded is the server's own, so the
   options match what the server will accept in setLevel */
const maps = levels.filter((l) => !l.user) // editor maps are local: the server has no copy
  .map((l) => ({ param: levelParam(l.name), ...levelMeta(l) }));
const mapTitle = (param) => maps.find((m) => m.param === param)?.title || String(param).toUpperCase();

/* ============================================================
   Map preview — the room's map is what orbits behind the lobby

   Exactly the level select's map switch (core/mapswitch.js), fly
   animation included, but without its ?level= bookkeeping: the room's
   map is server state, so nothing about it is kept here. Leaving the
   lobby flies back to `homeLevel`, the map single player was on when
   this screen opened, and a refresh lands there too.
============================================================ */
let homeLevel = levelName;

function previewMap(param) {
  const entry = levels.find((l) => levelParam(l.name) === param);
  if (entry) switchMap(entry.name);
}

function setStatus(text, color) {
  statusEl.textContent = text;
  statusEl.style.color = color || '';
}

/* ============================================================
   Match boot — this page load IS a match
============================================================ */
if (MP.active) {
  // the inline script in index.html already swapped the overlay to matchScreen
  document.body.classList.add(`team-${MP.myTeam}`); // recolors the base bars for the red side
  matchInfo.textContent = 'CONNECTING TO SERVER…';
  connect();

  const gone = new Set(); // players who left before the match began
  let matchDead = false;  // failed pre-start: ignore a late "go"
  let matchMsg = '';

  /* both rosters + a status line under them */
  function renderMatchInfo(sub) {
    if (sub !== null) matchMsg = sub;
    matchInfo.textContent = '';
    for (const team of ['blue', 'red']) {
      const row = document.createElement('div');
      row.className = `mrTeam ${team}`;
      const lbl = document.createElement('b');
      lbl.textContent = `${team.toUpperCase()} TEAM`;
      row.appendChild(lbl);
      for (const p of MP.roster.filter((r) => r.team === team)) {
        const s = document.createElement('span');
        s.className = 'mrName'
          + (gone.has(p.id) ? ' gone' : '')
          + (p.id === MP.playerId ? ' me' : '');
        s.textContent = p.id === MP.playerId ? `${p.name} (YOU)` : p.name;
        row.appendChild(s);
      }
      matchInfo.appendChild(row);
    }
    const sub2 = document.createElement('div');
    sub2.className = 'sub';
    sub2.textContent = matchMsg
      || `YOU FIGHT FOR THE ${MP.myTeam.toUpperCase()} TEAM — `
        + (game.mode === 'ctf' ? 'TAKE THEIR FLAG' : 'DESTROY THEIR BASE');
    matchInfo.appendChild(sub2);
  }

  function matchFail(text) {
    matchDead = true;
    matchInfo.textContent = text;
    readyBtn.textContent = '◂ BACK TO LOBBY';
    readyBtn.onclick = backToLobby;
    show(readyBtn, true);
  }

  on('open', () => send({ type: 'rejoin', matchId: MP.matchId, token: MP.token }));
  on('rejoined', () => {
    if (matchDead) return;
    renderMatchInfo('');
    readyBtn.onclick = () => {
      audioCtx(); // unlock audio on the user gesture
      send({ type: 'ready' });
      show(readyBtn, false);
      renderMatchInfo('WAITING FOR THE OTHER PILOTS TO DEPLOY…');
    };
    show(readyBtn, true);
  });
  on('ready', (m) => {
    if (game.state !== 'menu' || matchDead) return;
    renderMatchInfo(`${m.count}/${m.total} PILOTS READY…`);
  });
  on('go', () => {
    if (game.state !== 'menu' || matchDead) return; // server re-sends after a mid-match rejoin
    matchScreen.classList.add('hidden');
    startGame();
  });
  /* ---------- end screen: NEXT MAP ----------
     The finished match's socket is still open, so the whole roster can roll
     on to the next map in one step: the server mints a follow-up match and
     everyone still connected reloads into it (see 'matchStart' below). */
  const nextMapBtn = document.getElementById('nextMapBtn');
  const subLine = document.querySelector('#menuScreen .sub');
  nextMapBtn.addEventListener('click', () => {
    if (!connected()) { subLine.textContent = 'NO CONNECTION TO THE SERVER'; return; }
    send({ type: 'nextMatch' });
    nextMapBtn.disabled = true;
    subLine.textContent = 'WAITING FOR THE NEXT MAP…';
  });

  on('error', (m) => {
    if (game.state === 'over') {   // a NEXT MAP that the server turned down
      nextMapBtn.disabled = false;
      subLine.textContent = m.message;
      return;
    }
    matchFail(m.message);
  });
  /* the follow-up match: same credentials dance as the lobby's matchStart */
  on('matchStart', (m) => enterMatch(m, MP.name));
  on('peerLeft', (m) => {
    if (game.state !== 'menu' || matchDead) return;
    gone.add(m.id);
    const enemies = MP.roster.filter((p) => p.team !== MP.myTeam);
    if (enemies.every((p) => gone.has(p.id))) matchFail('THE OTHER TEAM LEFT THE MATCH');
    else renderMatchInfo(null); // refresh the roster, keep the message
  });
  on('peerJoined', (m) => {
    if (game.state !== 'menu' || matchDead) return;
    gone.delete(m.id);
    renderMatchInfo(null);
  });
  on('close', () => {
    if (game.state === 'menu') matchFail('CONNECTION LOST — IS THE SERVER RUNNING?');
  });
}

/* ============================================================
   Lobby — reached from the mode select's MULTIPLAYER button
============================================================ */
let myId = null;
let myName = '';
let myRoom = null;
let myTeam = null;
let joined = false;
let autoJoin = false;    // returning from a match: rejoin with the saved name
let manualClose = false; // BACK pressed: the socket close is expected
let lastState = { players: [], rooms: [] };

nameInput.value = localStorage.getItem('mechMpName') || '';

function showMpScreen(open) {
  mpScreen.classList.toggle('hidden', !open);
  modeScreen.classList.toggle('hidden', open);
  if (open) {
    manualClose = false;
    homeLevel = levelName; // what to fly back to when the lobby closes
    setStatus('CONNECTING TO SERVER…');
    connect();
    if (connected()) onOpen();
  } else {
    manualClose = connected();
    disconnect();
    resetLobbyUi();
  }
}

function resetLobbyUi() {
  joined = false;
  myId = null;
  myRoom = null;
  myTeam = null;
  switchMap(homeLevel); // leaving the lobby: fly back to my own map
  show(nameRow, false);
  show(roomsEl, false);
  show(roomBar, false);
  show(teamsEl, false);
  show(listEl, false);
  show(startBtn, false);
  clearBanner();
}

function doJoin() {
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  send({ type: 'join', name, level: levelParam(levelName), mode: game.mode });
}

function clearBanner() {
  bannerEl.textContent = '';
  show(bannerEl, false);
}

let infoTimer = null;
function infoBanner(text) {
  bannerEl.textContent = text;
  show(bannerEl, true);
  clearTimeout(infoTimer);
  infoTimer = setTimeout(clearBanner, 3000);
}

/* the "who else is here" strip under the main list */
function renderIdle(list, label) {
  listEl.textContent = '';
  if (list.length) {
    const row = document.createElement('div');
    row.className = 'mpRow';
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = label;
    const st = document.createElement('span');
    st.className = 'st';
    st.textContent = list.map((p) => p.name).join(' · ');
    row.append(n, st);
    listEl.appendChild(row);
  }
  show(listEl, !!list.length);
}

function renderList(state) {
  lastState = state;
  if (!joined) return;
  const { players, rooms } = state;
  const me = players.find((p) => p.id === myId);
  myRoom = me ? me.room : null;
  myTeam = me ? me.team : null;

  show(roomsEl, myRoom == null);
  show(roomBar, myRoom != null);
  show(teamsEl, myRoom != null);
  show(startBtn, myRoom != null);

  /* ---------- room browser ---------- */
  if (myRoom == null) {
    roomListEl.textContent = '';
    for (const r of rooms) {
      const row = document.createElement('div');
      row.className = 'mpRow';
      const n = document.createElement('span');
      n.className = 'name';
      n.textContent = r.name;
      const st = document.createElement('span');
      st.className = 'st';
      st.textContent = `${r.count} PILOT${r.count === 1 ? '' : 'S'} · ${mapTitle(r.level)}`
        + (r.mode === 'ctf' ? ' · 🚩 CTF' : '');
      const b = document.createElement('button');
      b.textContent = 'JOIN';
      b.addEventListener('click', () => send({ type: 'joinRoom', roomId: r.id }));
      row.append(n, st, b);
      roomListEl.appendChild(row);
    }
    if (!rooms.length) {
      const row = document.createElement('div');
      row.className = 'mpRow';
      const n = document.createElement('span');
      n.className = 'name';
      n.textContent = 'NO ROOMS YET';
      const st = document.createElement('span');
      st.className = 'st';
      st.textContent = 'CREATE THE FIRST ONE';
      row.append(n, st);
      roomListEl.appendChild(row);
    }
    renderIdle(players.filter((p) => p.room == null && p.id !== myId), 'BROWSING');
    setStatus('CREATE A ROOM OR JOIN ONE — EACH ROOM STAGES ITS OWN MATCH');
    switchMap(homeLevel); // outside a room: my own map again
    return;
  }

  /* ---------- inside a room ---------- */
  const room = rooms.find((r) => r.id === myRoom);
  roomNameEl.textContent = room ? room.name : 'ROOM';
  const members = players.filter((p) => p.room === myRoom);

  /* the map: the owner picks it, everyone else reads it. (A level this page
     doesn't know — a tab older than the deployed bundle — shows as a label,
     so the picker can never send a param the page can't name.) */
  const map = room ? room.level : levelParam(levelName);
  const canPick = !!room && room.owner === myId && maps.some((m) => m.param === map);
  show(mapSelect, canPick);
  show(mapPrevBtn, canPick);
  show(mapNextBtn, canPick);
  show(mapNameEl, !canPick);
  // only when it actually differs: reassigning value closes an open dropdown
  if (canPick) { if (mapSelect.value !== map) mapSelect.value = map; }
  else mapNameEl.textContent = mapTitle(map);
  previewMap(map); // the room's map is what orbits behind the overlay

  /* the mode rides along with the map: the owner picks, everyone else reads */
  const mode = room && MODES[room.mode] ? room.mode : 'assault';
  const canPickMode = !!room && room.owner === myId;
  show(modeSelect, canPickMode);
  show(modeNameEl, !canPickMode);
  if (canPickMode) { if (modeSelect.value !== mode) modeSelect.value = mode; }
  else modeNameEl.textContent = MODES[mode].label;

  for (const team of ['blue', 'red']) {
    const col = document.getElementById(team === 'blue' ? 'mpTeamBlue' : 'mpTeamRed');
    const list = col.querySelector('.tList');
    const btn = col.querySelector('button');
    const teamed = members.filter((p) => p.team === team);
    col.querySelector('.tHead').textContent = `${team.toUpperCase()} TEAM ${teamed.length}/${TEAM_MAX}`;
    list.textContent = '';
    for (const p of teamed) {
      const row = document.createElement('div');
      row.className = 'tSlot' + (p.id === myId ? ' me' : '');
      row.textContent = p.id === myId ? `${p.name} (YOU)` : p.name;
      list.appendChild(row);
    }
    for (let i = teamed.length; i < TEAM_MAX; i++) {
      const row = document.createElement('div');
      row.className = 'tSlot empty';
      row.textContent = 'OPEN SLOT';
      list.appendChild(row);
    }
    if (myTeam === team) {
      btn.textContent = 'LEAVE TEAM';
      btn.disabled = false;
    } else {
      btn.textContent = `JOIN ${team.toUpperCase()}`;
      btn.disabled = teamed.length >= TEAM_MAX;
    }
  }

  renderIdle(members.filter((p) => !p.team), 'IN THIS ROOM');

  const blue = members.filter((p) => p.team === 'blue').length;
  const red = members.filter((p) => p.team === 'red').length;
  startBtn.disabled = !myTeam || !blue || !red;
  if (!myTeam) setStatus('PICK A TEAM — BLUE OR RED');
  else if (!blue || !red) setStatus('WAITING FOR PILOTS ON THE OTHER TEAM…');
  else if (canPick) setStatus(`READY — YOUR ROOM, YOUR CALL: ${MODES[mode].label} ON ${mapTitle(map)}`);
  else setStatus(`READY — THE ROOM PLAYS ${MODES[mode].label} ON ${mapTitle(map)}, PICKED BY ITS CREATOR`);
}

function onOpen() {
  if (MP.active) return;
  setStatus('CONNECTED — ENTER A CALLSIGN TO JOIN THE LOBBY');
  show(nameRow, true);
  if (autoJoin && nameInput.value.trim()) {
    autoJoin = false;
    doJoin();
  }
}

if (!MP.active) {
  // handed a match screen but no usable credentials (a malformed handoff):
  // index.html already opened it, so put the mode select back
  if (BOOT.screen === 'match') {
    matchScreen.classList.add('hidden');
    modeScreen.classList.remove('hidden');
  }

  document.getElementById('mpBtn').addEventListener('click', () => showMpScreen(true));
  document.getElementById('mpBack').addEventListener('click', () => showMpScreen(false));
  joinBtn.addEventListener('click', doJoin);
  nameInput.addEventListener('keydown', (e) => {
    e.stopPropagation(); // keep game key handling out of the text field
    if (e.key === 'Enter') doJoin();
  });
  createBtn.addEventListener('click', () => send({ type: 'createRoom' }));
  leaveBtn.addEventListener('click', () => send({ type: 'leaveRoom' }));

  for (const [i, m] of maps.entries()) {
    const opt = document.createElement('option');
    opt.value = m.param;
    opt.textContent = `${i + 1} · ${m.title}`;
    mapSelect.appendChild(opt);
  }
  // the server rejects this from anyone but the room's owner
  mapSelect.addEventListener('change', () => send({ type: 'setLevel', level: mapSelect.value }));
  /* ◂ / ▸ step to the neighbouring map without opening the dropdown. The
     select is moved along optimistically so repeated taps keep stepping —
     the room broadcast is what confirms it (and corrects it if the server
     refuses). */
  const stepMap = (dir) => {
    const i = maps.findIndex((m) => m.param === mapSelect.value);
    if (i < 0 || maps.length < 2) return;
    const next = maps[(i + dir + maps.length) % maps.length];
    mapSelect.value = next.param;
    send({ type: 'setLevel', level: next.param });
  };
  modeSelect.addEventListener('change', () => send({ type: 'setMode', mode: modeSelect.value }));
  mapPrevBtn.addEventListener('click', () => stepMap(-1));
  mapNextBtn.addEventListener('click', () => stepMap(1));
  for (const btn of teamsEl.querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      // clicking my own team's button steps back off the roster
      send({ type: 'team', team: btn.dataset.team === myTeam ? null : btn.dataset.team });
    });
  }
  startBtn.addEventListener('click', () => send({ type: 'startMatch' }));

  on('open', onOpen);
  on('close', () => {
    if (manualClose) { manualClose = false; return; }
    resetLobbyUi();
    setStatus('CANNOT REACH THE SERVER — CHECK YOUR CONNECTION AND REOPEN THIS SCREEN', '#ff8a7a');
  });
  on('error', (m) => { if (joined) infoBanner(m.message); else setStatus(m.message, '#ff8a7a'); });

  on('joined', (m) => {
    myId = m.id;
    myName = m.name;
    joined = true;
    localStorage.setItem('mechMpName', m.name);
    show(nameRow, false);
    renderList(lastState); // the server's lobby broadcast follows right behind
  });
  on('lobby', (m) => renderList({ players: m.players, rooms: m.rooms }));

  on('matchStart', (m) => enterMatch(m, myName));

  // coming back from a match: straight into the lobby with the same name
  if (BOOT.screen === 'lobby') {
    autoJoin = true;
    showMpScreen(true);
  }
}
