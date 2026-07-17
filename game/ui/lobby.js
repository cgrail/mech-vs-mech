import { MP, connect, disconnect, connected, on, send } from '../net/net.js';
import { game } from '../core/state.js';
import { levelName } from '../world/world.js';
import { startGame, backToLobby } from '../core/flow.js';
import { audioCtx, beep } from '../systems/audio.js';

/* ============================================================
   Multiplayer UI

   Lobby (from the mode select): pick a callsign → join → see other
   pilots → challenge one / answer a challenge. On accept the server
   deals out match credentials and both clients reload into
   ?level=<challenger's level>&mp=1 (see net.js).

   Match boot (?mp=1): reconnect, rejoin by token, then a READY
   handshake so the fight starts for both players at once.
============================================================ */
const modeScreen = document.getElementById('modeScreen');
const mpScreen = document.getElementById('mpScreen');
const matchScreen = document.getElementById('matchScreen');
const statusEl = document.getElementById('mpStatus');
const nameRow = document.getElementById('mpNameRow');
const nameInput = document.getElementById('mpNameInput');
const joinBtn = document.getElementById('mpJoinBtn');
const bannerEl = document.getElementById('mpBanner');
const listEl = document.getElementById('mpList');
const matchInfo = document.getElementById('matchInfo');
const readyBtn = document.getElementById('readyBtn');

const show = (el, on) => el.classList.toggle('mpHidden', !on);
// numeric levels travel as their short ?level=N form
const levelParam = (n) => n.match(/^level(\d+)$/)?.[1] ?? n;

function setStatus(text, color) {
  statusEl.textContent = text;
  statusEl.style.color = color || '';
}

function makeBtn(label, ghost, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  if (ghost) b.className = 'ghost';
  b.addEventListener('click', onClick);
  return b;
}

/* ============================================================
   Match boot — this page load IS a match
============================================================ */
if (MP.active) {
  // the inline script in index.html already swapped the overlay to matchScreen
  document.body.classList.add(`team-${MP.myTeam}`); // recolors the base bars for the red side
  matchInfo.textContent = 'CONNECTING TO SERVER…';
  connect();

  on('open', () => send({ type: 'rejoin', matchId: MP.matchId, token: MP.token }));
  on('rejoined', (m) => {
    matchInfo.innerHTML = '';
    const vs = document.createElement('div');
    vs.className = 'vs';
    vs.textContent = `${MP.name} vs ${m.opponent}`;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = `YOU FIGHT FOR THE ${MP.myTeam.toUpperCase()} TEAM — DESTROY THEIR BASE`;
    matchInfo.append(vs, sub);
    readyBtn.onclick = () => {
      audioCtx(); // unlock audio on the user gesture
      send({ type: 'ready' });
      show(readyBtn, false);
      matchInfo.textContent = `WAITING FOR ${MP.opponent} TO DEPLOY…`;
    };
    show(readyBtn, true);
  });
  on('go', () => {
    if (game.state !== 'menu') return; // server re-sends after a mid-match rejoin
    matchScreen.classList.add('hidden');
    startGame();
  });
  on('error', (m) => matchFail(m.message));
  on('opponentLeft', () => {
    if (game.state === 'menu') matchFail(`${MP.opponent} LEFT THE MATCH`);
  });
  on('close', () => {
    if (game.state === 'menu') matchFail('CONNECTION LOST — IS THE SERVER RUNNING?');
  });
}

function matchFail(text) {
  matchInfo.textContent = text;
  readyBtn.textContent = '◂ BACK TO LOBBY';
  readyBtn.onclick = backToLobby;
  show(readyBtn, true);
}

/* ============================================================
   Lobby — reached from the mode select's MULTIPLAYER button
============================================================ */
let myId = null;
let myName = '';
let joined = false;
let busy = false;        // a challenge involving me is pending
let autoJoin = false;    // returning from a match: rejoin with the saved name
let manualClose = false; // BACK pressed: the socket close is expected
let lastPlayers = [];

nameInput.value = localStorage.getItem('mechMpName') || '';

function showMpScreen(open) {
  mpScreen.classList.toggle('hidden', !open);
  modeScreen.classList.toggle('hidden', open);
  if (open) {
    manualClose = false;
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
  busy = false;
  myId = null;
  show(nameRow, false);
  show(listEl, false);
  clearBanner();
}

function doJoin() {
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  send({ type: 'join', name, level: levelParam(levelName) });
}

function clearBanner() {
  bannerEl.textContent = '';
  show(bannerEl, false);
}

let infoTimer = null;
function infoBanner(text) {
  busy = false;
  bannerEl.textContent = text;
  show(bannerEl, true);
  renderList(lastPlayers);
  clearTimeout(infoTimer);
  infoTimer = setTimeout(clearBanner, 3000);
}

function challengeBanner(text, ...buttons) {
  busy = true;
  clearTimeout(infoTimer);
  bannerEl.textContent = '';
  const s = document.createElement('span');
  s.textContent = text;
  bannerEl.append(s, ...buttons);
  show(bannerEl, true);
  renderList(lastPlayers);
}

function renderList(players) {
  lastPlayers = players;
  if (!joined) return;
  listEl.textContent = '';
  const others = players.filter((p) => p.id !== myId);
  if (!others.length) {
    const row = document.createElement('div');
    row.className = 'mpRow';
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = 'NO OTHER PILOTS ONLINE';
    const st = document.createElement('span');
    st.className = 'st';
    st.textContent = 'WAITING…';
    row.append(n, st);
    listEl.appendChild(row);
    return;
  }
  for (const p of others) {
    const row = document.createElement('div');
    row.className = 'mpRow';
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = p.name;
    const st = document.createElement('span');
    st.className = 'st';
    st.textContent = p.busy ? 'IN BATTLE' : 'AVAILABLE';
    const b = makeBtn('CHALLENGE', false, () => send({ type: 'challenge', targetId: p.id }));
    b.disabled = p.busy || busy;
    row.append(n, st, b);
    listEl.appendChild(row);
  }
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
  // ?mp=1 without match credentials (bookmark, reopened tab): back to mode select
  if (new URLSearchParams(location.search).get('mp') === '1') {
    const url = new URL(location.href);
    url.searchParams.delete('mp');
    history.replaceState(null, '', url);
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

  on('open', onOpen);
  on('close', () => {
    if (manualClose) { manualClose = false; return; }
    resetLobbyUi();
    setStatus('CANNOT REACH THE SERVER — CHECK YOUR CONNECTION AND REOPEN THIS SCREEN', '#ff8a7a');
  });
  on('error', (m) => setStatus(m.message, '#ff8a7a'));

  on('joined', (m) => {
    myId = m.id;
    myName = m.name;
    joined = true;
    localStorage.setItem('mechMpName', m.name);
    setStatus(`IN LOBBY AS ${m.name} — CHALLENGE A PILOT`);
    show(nameRow, false);
    show(listEl, true);
  });
  on('lobby', (m) => renderList(m.players));

  on('challengeSent', (m) => {
    challengeBanner(`CHALLENGING ${m.targetName} — WAITING…`,
      makeBtn('CANCEL', true, () => {
        send({ type: 'challengeCancel' });
        infoBanner('CHALLENGE WITHDRAWN');
      }));
  });
  on('challenge', (m) => {
    beep(660, 880, 0.18, 'square', 0.1);
    challengeBanner(`${m.fromName} CHALLENGES YOU!`,
      makeBtn('ACCEPT', false, () => {
        send({ type: 'challengeResponse', accept: true });
        challengeBanner('STARTING MATCH…');
      }),
      makeBtn('DECLINE', true, () => {
        send({ type: 'challengeResponse', accept: false });
        clearBanner();
        busy = false;
        renderList(lastPlayers);
      }));
  });
  on('challengeDeclined', (m) => infoBanner(`${m.name} DECLINED THE CHALLENGE`));
  on('challengeCancelled', () => infoBanner('CHALLENGE WITHDRAWN'));

  on('matchStart', (m) => {
    sessionStorage.setItem('mechMpMatch', JSON.stringify({
      matchId: m.matchId, token: m.token, role: m.role, name: myName, opponent: m.opponent,
    }));
    const url = new URL(location.href);
    url.searchParams.set('level', m.level);
    url.searchParams.set('mp', '1');
    location.href = url.href;
  });

  // coming back from a match: straight into the lobby with the same name
  if (sessionStorage.getItem('mechMpReturn')) {
    sessionStorage.removeItem('mechMpReturn');
    autoJoin = true;
    showMpScreen(true);
  }
}
