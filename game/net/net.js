/* ============================================================
   Multiplayer transport + session flags

   Import-clean (no game imports) so any module can use it without
   cycles. MP is decided synchronously from the URL + sessionStorage
   at module load, so modules that build entities at import time
   (player.js, entities.js) can branch on it during boot.

   A multiplayer match is a page reload into ?mp=1 with the match
   credentials (id, token, playerId, team, roster) parked in
   sessionStorage by the lobby. Up to 5 players per team; each
   client owns its player and the turrets it builds, identified
   by its playerId.
============================================================ */
const params = new URLSearchParams(location.search);

let session = null;
if (params.get('mp') === '1') {
  try { session = JSON.parse(sessionStorage.getItem('mechMpMatch')); } catch { /* stale/absent */ }
  if (session && session.team !== 'blue' && session.team !== 'red') session = null; // stale pre-team-mode credentials
}

export const MP = session ? {
  active: true,
  playerId: session.playerId,
  myTeam: session.team,
  enemyTeam: session.team === 'blue' ? 'red' : 'blue',
  name: session.name,
  roster: session.roster || [], // [{id, name, team}] — everyone in the match, me included
  matchId: session.matchId,
  token: session.token,
  // the room's game mode, dealt out with the match (state.js reads it)
  mode: session.mode === 'ctf' ? 'ctf' : 'assault',
} : {
  active: false, playerId: 0, myTeam: 'blue', enemyTeam: 'red',
  name: '', roster: [], matchId: null, token: null, mode: 'assault',
};

/* netId -> entity, for hit/hp/death events. Filled by registerEntity
   for anything created with a netId (players, bases, turrets). */
export const netRegistry = new Map();

let ws = null;
const handlers = {};

export function on(type, fn) { (handlers[type] ||= []).push(fn); }
function emit(type, msg, from) { for (const fn of handlers[type] || []) fn(msg, from); }

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
    if (msg.type === 'relay') emit('game', msg.data, msg.from); // in-match game event from another player
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

/* wrap a game event for relay to every other player in the match */
export function sendGame(data) { send({ type: 'relay', data }); }
