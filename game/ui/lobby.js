import { MP, connect, disconnect, connected, on, send } from '../net/net.js';
import { game, MODES } from '../core/state.js';
import { levelName, levels, levelMeta, levelParam } from '../world/world.js';
import { switchMap } from '../core/mapswitch.js';
import { BOOT, bootReload } from '../core/boot.js';
import { startGame, backToLobby } from '../core/flow.js';
import { audioCtx } from '../systems/audio.js';
import { addPickCards, MODE_UI, modeUi } from './menu.js';
import { mapThumb, thumbBox } from './thumb.js';

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
const mapHeroEl = document.getElementById('mpMapHero');
const mapNoteEl = document.getElementById('mpMapNote');
const modePickEl = document.getElementById('mpModePick');
const modeNoteEl = document.getElementById('mpModeNote');
const teamNoteEl = document.getElementById('mpTeamNote');
const roomCountEl = document.getElementById('mpRoomCount');
const leaveBtn = document.getElementById('mpLeaveBtn');
const teamsEl = document.getElementById('mpTeams');
const listEl = document.getElementById('mpList');
const startBtn = document.getElementById('mpStartBtn');
const matchInfo = document.getElementById('matchInfo');
const readyBtn = document.getElementById('readyBtn');

const TEAM_MAX = 5; // mirrors the server's cap; the server enforces it
const ROOM_MAX = 12; // …and the room cap: a full 5v5 plus a few undecided
const show = (el, on) => el.classList.toggle('mpHidden', !on);
/* A card and the green action that finishes it are one decision shown in two
   places: the card is in the scrolling column, its button is pinned in the
   screen's footer (index.html), so they are shown and hidden together. */
const showCallsign = (on) => { show(nameRow, on); show(joinBtn, on); };
const showRooms = (on) => { show(roomsEl, on); show(createBtn, on); };

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

/* the room's map on the same card the mission menu shows: the map's own
   picture (ui/thumb.js), its name, and what it will be played as */
function renderMapHero(param, mode) {
  const entry = levels.find((l) => levelParam(l.name) === param);
  mapHeroEl.textContent = '';
  const pic = document.createElement('span');
  pic.className = entry ? 'heroThumb' : 'heroThumb empty';
  const img = entry ? mapThumb(entry.text) : null;
  if (img) pic.appendChild(img);
  const cap = document.createElement('span');
  cap.className = 'heroCap';
  const t = document.createElement('span');
  t.className = 't';
  t.textContent = mapTitle(param);
  const m = document.createElement('span');
  m.className = 'm';
  m.textContent = `${TEAM_MAX} VS ${TEAM_MAX} · ${modeUi(mode).title}`;
  const d = document.createElement('span');
  d.className = 'd';
  d.textContent = entry ? levelMeta(entry).desc : '';
  cap.append(t, m, d);
  mapHeroEl.append(pic, cap);
}

/* the room's mode, on the same cards the mission menu uses. The server rejects
   setMode from anyone but the room's owner, so for everyone else the cards go
   read-only and only say what the room plays. */
let roomMode = 'assault';
let canPickMode = false;
const modeCards = addPickCards(modePickEl, {
  values: MODE_UI,
  get: () => roomMode,
  set: (v) => send({ type: 'setMode', mode: v }),
  enabled: () => canPickMode,
});

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
  /* ---------- end screen: NEXT MAP, and the countdown to it ----------
     The finished match's socket is still open, so the whole roster can roll
     on to the next map in one step: the server mints a follow-up match and
     everyone still connected reloads into it (see 'matchStart' below).

     It also happens on its own after AUTO_NEXT seconds, so a session keeps
     its momentum without anyone having to press anything. Everyone's timer
     runs out at roughly the same moment, which is harmless: the first
     request the server sees mints the match, and the rest only re-send the
     same matchStart to the same roster. The button is still there for
     whoever wants it sooner, and BACK TO LOBBY for whoever wants out.

     The same countdown drives the dead end (noNextMap): once there is no
     follow-up match to be had, NEXT MAP is a button that can only fail, so
     it goes away and the screen counts itself back to the lobby instead. */
  const nextMapBtn = document.getElementById('nextMapBtn');
  const leaveBtnEnd = document.getElementById('startBtn'); // BACK TO LOBBY on the end screen
  const subLine = document.querySelector('#menuScreen .sub');
  const AUTO_NEXT = 10;   // seconds on the end screen before the next map starts itself
  const AUTO_LEAVE = 5;   // …and before a dead-ended one goes back to the lobby
  const NO_NEXT = 'NOT ENOUGH PILOTS LEFT FOR ANOTHER MATCH'; // the server's own wording
  let endScreen = false;  // the end screen is up: the countdown belongs to it
  let deadEnd = false;    // …and it leads nowhere but back to the lobby
  let autoBtn = null;     // the button the countdown is written on
  let autoLabel = '';
  let autoRun = null;     // what it fires when it runs out
  let autoLeft = 0;
  let autoTimer = null;

  function stopAuto() {
    clearTimeout(autoTimer);
    autoTimer = null;
    autoRun = null;
    if (autoBtn) autoBtn.textContent = autoLabel;
    autoBtn = null;
  }

  function tickAuto() {
    if (autoLeft <= 0) { const run = autoRun; stopAuto(); run(); return; }
    autoBtn.textContent = `${autoLabel} IN ${autoLeft}s`;
    autoLeft--;
    autoTimer = setTimeout(tickAuto, 1000);
  }

  function startAuto(btn, label, secs, run) {
    stopAuto();
    autoBtn = btn; autoLabel = label; autoLeft = secs; autoRun = run;
    tickAuto();
  }

  function askNextMap() {
    stopAuto();
    if (!connected()) { subLine.textContent = 'NO CONNECTION TO THE SERVER'; return; }
    send({ type: 'nextMatch' });
    nextMapBtn.disabled = true;
    subLine.textContent = 'WAITING FOR THE NEXT MAP…';
  }

  /* No next map to roll on to — the other side left, or the server turned the
     request down. Asking again could only be refused again, so NEXT MAP goes
     away, the screen's one working action becomes the green one, and (unless
     it is the server itself that went missing) it presses itself. */
  function noNextMap(message, auto = true) {
    subLine.textContent = message;
    if (deadEnd) return; // a second refusal must not restart the countdown
    deadEnd = true;
    stopAuto();
    show(nextMapBtn, false);
    leaveBtnEnd.classList.remove('ghost');
    leaveBtnEnd.classList.add('goBtn');
    leaveBtnEnd.focus(); // selection is DOM focus: don't leave it on a hidden button
    if (auto) startAuto(leaveBtnEnd, 'BACK TO LOBBY', AUTO_LEAVE, backToLobby);
  }

  /* everyone we were fighting has dropped out: what the server checks before
     it mints a follow-up match, checked here so we don't count down into a
     refusal we already know is coming */
  function enemiesAllGone() {
    const enemies = MP.roster.filter((p) => p.team !== MP.myTeam);
    return enemies.length > 0 && enemies.every((p) => gone.has(p.id));
  }

  nextMapBtn.addEventListener('click', askNextMap);
  window.addEventListener('mech:endscreen', () => {
    endScreen = true;
    if (!connected()) return; // flow.js only offers the button while the server is reachable
    if (enemiesAllGone()) { noNextMap(NO_NEXT); return; }
    startAuto(nextMapBtn, '▸ NEXT MAP', AUTO_NEXT, askNextMap);
  });

  on('error', (m) => {
    if (endScreen) { noNextMap(m.message); return; } // a NEXT MAP the server turned down
    matchFail(m.message);
  });
  /* the follow-up match: same credentials dance as the lobby's matchStart */
  on('matchStart', (m) => enterMatch(m, MP.name));
  /* who is still here is tracked for the whole match, not just the boot
     handshake: the end screen needs it to know whether a next map is possible */
  on('peerLeft', (m) => {
    if (matchDead) return;
    gone.add(m.id);
    if (game.state === 'menu') {
      if (enemiesAllGone()) matchFail('THE OTHER TEAM LEFT THE MATCH');
      else renderMatchInfo(null); // refresh the roster, keep the message
      return;
    }
    // left while the end screen was up: the roster a next map would be built
    // from just emptied out
    if (endScreen && enemiesAllGone()) noNextMap(NO_NEXT);
  });
  on('peerJoined', (m) => {
    if (matchDead) return;
    gone.delete(m.id);
    if (game.state === 'menu') renderMatchInfo(null);
  });
  on('close', () => {
    if (game.state === 'menu') matchFail('CONNECTION LOST — IS THE SERVER RUNNING?');
    // no server to roll the match on. On the end screen that is the same dead
    // end, but the lobby is unreachable too, so it stays a keypress away
    else if (endScreen) noNextMap('CONNECTION LOST — IS THE SERVER RUNNING?', false);
    else stopAuto();
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
let autoRoom = false;    // just entered the lobby: walk into the only room going
let manualClose = false; // BACK pressed: the socket close is expected
let focusedRoom = null;  // the room the menu cursor was moved into
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
  showCallsign(false);
  showRooms(false);
  show(roomBar, false); // the team, mode and map cards ride along inside it
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

  /* One room with space in it is not a choice, so don't make it one: walk
     straight in. Only on the way into the lobby (`autoRoom`), never again —
     leaving a room and finding the browser jump you back into the room you
     just left would be the opposite of smooth. */
  if (autoRoom) {
    autoRoom = false;
    if (myRoom == null && rooms.length === 1 && rooms[0].count < ROOM_MAX) {
      send({ type: 'joinRoom', roomId: rooms[0].id });
      setStatus(`JOINING ${rooms[0].name}…`);
      return; // the roster broadcast that follows renders the room
    }
  }

  showRooms(myRoom == null);
  show(roomBar, myRoom != null);
  show(startBtn, myRoom != null);

  /* Walking into a room replaces the browser under the cursor, so put the
     menu cursor on the first thing there is to decide — the team — rather than
     leaving it on the row that just vanished (or on LEAVE ROOM, which is the
     first stop in the room's DOM order). Selection is focus (ui/menu.js). */
  if (myRoom != null && myRoom !== focusedRoom) {
    focusedRoom = myRoom;
    const blue = document.getElementById('mpTeamBlue');
    blue.focus({ preventScroll: true });
    blue.scrollIntoView({ block: 'nearest' }); // the room's cards can outrun the column
  } else if (myRoom == null) {
    focusedRoom = null;
  }

  /* ---------- room browser ---------- */
  if (myRoom == null) {
    roomListEl.textContent = '';
    roomCountEl.textContent = rooms.length ? `${rooms.length} OPEN` : '';
    for (const r of rooms) {
      // the whole row is the way in, and it carries the room's map
      const b = document.createElement('button');
      b.className = 'roomRow' + (r.count >= ROOM_MAX ? ' full' : '');
      const entry = levels.find((l) => levelParam(l.name) === r.level);
      const info = document.createElement('span');
      info.className = 'info';
      const n = document.createElement('span');
      n.className = 'name';
      n.textContent = r.name;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${modeUi(r.mode).ico} ${mapTitle(r.level)}`;
      info.append(n, meta);
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = `${r.count}/${ROOM_MAX}`;
      const go = document.createElement('span');
      go.className = 'go';
      go.textContent = '›';
      b.append(thumbBox(entry && entry.text), info, count, go);
      b.addEventListener('click', () => send({ type: 'joinRoom', roomId: r.id }));
      roomListEl.appendChild(b);
    }
    if (!rooms.length) {
      /* An empty browser has nothing to walk into, so the way out of it sits
         right here as well as in the footer — same green, same action. */
      const row = document.createElement('div');
      row.className = 'mpRow';
      const n = document.createElement('span');
      n.className = 'name';
      n.textContent = 'NO ROOMS YET';
      const st = document.createElement('button');
      st.className = 'goBtn slim';
      st.textContent = 'CREATE THE FIRST ONE';
      st.addEventListener('click', () => createBtn.click());
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

  /* the mode rides along with the map: the owner picks, everyone else reads */
  const mode = room && MODES[room.mode] ? room.mode : 'assault';
  roomMode = mode;
  canPickMode = !!room && room.owner === myId;
  modeCards.reflect();
  modeNoteEl.textContent = canPickMode ? '' : 'PICKED BY THE CREATOR';

  /* the map: the owner picks it, everyone else reads it. (A level this page
     doesn't know — a tab older than the deployed bundle — has no entry to draw
     a thumbnail from and no option in the picker, so the picker can never send
     a param the page can't name.) */
  const map = room ? room.level : levelParam(levelName);
  const canPick = !!room && room.owner === myId && maps.some((m) => m.param === map);
  show(mapSelect, canPick);
  show(mapPrevBtn, canPick);
  show(mapNextBtn, canPick);
  // only when it actually differs: reassigning value closes an open dropdown
  if (canPick && mapSelect.value !== map) mapSelect.value = map;
  mapNoteEl.textContent = canPick ? '' : 'PICKED BY THE CREATOR';
  renderMapHero(map, mode);
  previewMap(map); // the room's map is what orbits behind the overlay

  for (const team of ['blue', 'red']) {
    // the whole team card is the button, so tapping it joins or leaves
    const col = document.getElementById(team === 'blue' ? 'mpTeamBlue' : 'mpTeamRed');
    const list = col.querySelector('.tList');
    const teamed = members.filter((p) => p.team === team);
    const mine = myTeam === team;
    col.querySelector('.tName').textContent = `${team.toUpperCase()} TEAM`;
    col.querySelector('.tCount').textContent = `${teamed.length} / ${TEAM_MAX} PILOTS`;
    list.textContent = '';
    for (const p of teamed) {
      const row = document.createElement('span');
      row.className = 'tSlot' + (p.id === myId ? ' me' : '');
      row.textContent = p.id === myId ? `${p.name} ◂ YOU` : p.name;
      list.appendChild(row);
    }
    for (let i = teamed.length; i < TEAM_MAX; i++) {
      const row = document.createElement('span');
      row.className = 'tSlot empty';
      row.textContent = 'OPEN';
      list.appendChild(row);
    }
    col.classList.toggle('on', mine);
    col.disabled = !mine && teamed.length >= TEAM_MAX;
    col.querySelector('.tAct').textContent = mine ? 'LEAVE TEAM'
      : (col.disabled ? 'TEAM FULL' : `JOIN ${team.toUpperCase()}`);
  }
  teamNoteEl.textContent = myTeam ? '' : 'PICK A SIDE';

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
  showCallsign(true);
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
  document.getElementById('mpNameGo').addEventListener('click', doJoin);
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
  on('error', (m) => {
    if (!joined) { setStatus(m.message, '#ff8a7a'); return; }
    infoBanner(m.message);
    // a refused join (the walk-in racing someone else into the last slot)
    // gets no roster broadcast, so put the browser back rather than leaving
    // "JOINING…" on screen until somebody else moves
    renderList(lastState);
  });

  on('joined', (m) => {
    myId = m.id;
    myName = m.name;
    joined = true;
    localStorage.setItem('mechMpName', m.name);
    showCallsign(false);
    // the server suffixes a callsign somebody else is already on rather than
    // turning the join down — say so, since it is the name everyone will see
    if (m.renamed) infoBanner(`CALLSIGN TAKEN — YOU ARE ${m.name}`);
    renderList(lastState); // paint from what we have…
    // …then arm the walk-in, so it judges the server's own room list (which
    // follows `joined` immediately) and not the empty placeholder above
    autoRoom = true;
  });
  on('lobby', (m) => renderList({ players: m.players, rooms: m.rooms }));

  on('matchStart', (m) => enterMatch(m, myName));

  // coming back from a match: straight into the lobby with the same name
  if (BOOT.screen === 'lobby') {
    autoJoin = true;
    showMpScreen(true);
  }
}
