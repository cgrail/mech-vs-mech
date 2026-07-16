/* ============================================================
   Multiplayer transport + session flags

   Import-clean (no game imports) so any module can use it without
   cycles. MP is decided synchronously from the URL + sessionStorage
   at module load, so modules that build entities at import time
   (player.js, entities.js) can branch on it during boot.

   A multiplayer match is a page reload into ?mp=1 with the match
   credentials (id, token, role) parked in sessionStorage by the
   lobby — host plays blue, guest plays red.
============================================================ */
const params = new URLSearchParams(location.search);

let session = null;
if (params.get('mp') === '1') {
  try { session = JSON.parse(sessionStorage.getItem('mechMpMatch')); } catch { /* stale/absent */ }
}

export const MP = session ? {
  active: true,
  role: session.role,
  myTeam: session.role === 'host' ? 'blue' : 'red',
  enemyTeam: session.role === 'host' ? 'red' : 'blue',
  name: session.name,
  opponent: session.opponent,
  matchId: session.matchId,
  token: session.token,
} : {
  active: false, role: 'host', myTeam: 'blue', enemyTeam: 'red',
  name: '', opponent: '', matchId: null, token: null,
};

/* netId -> entity, for hit/hp/death events. Filled by registerEntity
   for anything created with a netId (players, bases, turrets). */
export const netRegistry = new Map();

let ws = null;
const handlers = {};

export function on(type, fn) { (handlers[type] ||= []).push(fn); }
function emit(type, msg) { for (const fn of handlers[type] || []) fn(msg); }

export function connected() { return !!ws && ws.readyState === 1; }

function wsUrl() {
  const o = params.get('server'); // ?server=host:port points at a remote game server
  if (o) return o.startsWith('ws') ? o : `ws://${o}/ws`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export function connect() {
  if (ws) return;
  let sock;
  try { sock = new WebSocket(wsUrl()); } catch { emit('close'); return; }
  ws = sock;
  sock.onopen = () => emit('open');
  sock.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'relay') emit('game', msg.data); // in-match game event from the opponent
    else emit(msg.type, msg);
  };
  sock.onclose = () => { if (ws === sock) ws = null; emit('close'); };
  sock.onerror = () => { try { sock.close(); } catch { /* already closed */ } };
}

export function disconnect() {
  if (ws) ws.close();
}

export function send(obj) {
  if (connected()) ws.send(JSON.stringify(obj));
}

/* wrap a game event for relay to the opponent */
export function sendGame(data) { send({ type: 'relay', data }); }
