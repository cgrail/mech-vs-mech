#!/usr/bin/env node
/* ============================================================
   Multiplayer server

   Serves the built game (dist/, via express) AND runs the
   WebSocket lobby/match relay on the same port:

     npm install && npm start      →  http://localhost:8080
     (npm start builds dist/ first via the prestart script)

   The server never simulates the game — each client owns its own
   entities (player, turrets) and the server just relays events
   among the clients of a match (up to 5 per team, 10 total).

   Lobby protocol (JSON) — matches are staged in rooms, so several
   groups can set up and fight in parallel:
     → join {name, level}            ← joined {id,name} | error {message}
                                     ← lobby {rooms:[{id,name,count}],
                                         players:[{id,name,room,team}]}
     → createRoom                    ← lobby (creator auto-joins) | error
     → joinRoom {roomId}             ← lobby | error (room gone/full)
     → leaveRoom                     ← lobby
     → team {team:blue|red|null}     ← lobby | error (team full)  — in a room
     → startMatch                    ← matchStart {matchId,token,playerId,team,
                                         level,roster:[{id,name,team}]}
                                       (to everyone on a team in the starter's
                                        room; the starter's level is played)
   Match protocol (players reload into ?mp=1, then):
     → rejoin {matchId, token}       ← rejoined {playerId,team,level,roster} | error
                                     ← peerJoined {id,name}  (to the others)
     → ready                         ← ready {count,total}
                                     ← go            (once every slot is ready)
     → relay {data}                  ← relay {from,data}  (fanned out to the others)
                                     ← peerLeft {id,name}

   Plus one HTTP route beside the static files, for clients that don't
   load their levels from this server (the iOS app):
     GET /level/<param>              → that one level's text, resolved the
                                       way the browser resolves ?level=

   Internet hardening — everything is tuned by env vars, all optional:
     PORT               listen port (default 8080)
     HOST               listen address (default all interfaces; set
                        127.0.0.1 behind a reverse proxy on the same box)
     TRUST_PROXY=1      behind a TLS-terminating reverse proxy: trust
                        X-Forwarded-* for client IPs / HSTS
     ALLOWED_ORIGINS    extra WebSocket origins, comma-separated
                        (same-origin as the page is always allowed)
     MAX_CLIENTS        total WebSocket connections (default 200)
     MAX_CONNS_PER_IP   per-address connections (default 16 — a full
                        10-player match may sit behind one NAT)
============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const LEVELS_DIR = path.join(DIST, 'levels');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || undefined; // undefined → all interfaces

const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim().toLowerCase().replace(/\/$/, '')).filter(Boolean);
const MAX_CLIENTS = Number(process.env.MAX_CLIENTS) || 200;
const MAX_CONNS_PER_IP = Number(process.env.MAX_CONNS_PER_IP) || 16;

/* per-socket message budget: a token bucket well above legit peak
   traffic (15 Hz state + shots + hit reports from a full turret line)
   that still caps a flooder; grossly-over sockets get cut entirely */
const RATE_BURST = 500;
const RATE_PER_SEC = 200;
const MAX_DROPPED = 2000;
const MAX_BUFFERED = 1 << 20; // relay target stalled → cut it, don't buffer forever

/* ---------- static files: the built game only ---------- */
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ is missing — run "npm run build" first ("npm start" does it automatically).');
  process.exit(1);
}

/* CSP: everything the game loads is same-origin (the importmap CDN is
   stripped from the built index.html), except index.html's inline boot
   script — hash whatever inline scripts the build produced so the
   policy survives edits to them */
const inlineHashes = [...fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
  .matchAll(/<script(?![^>]*\bsrc)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(([, body]) => `'sha256-${crypto.createHash('sha256').update(body).digest('base64')}'`);
const CSP = [
  `default-src 'self'`,
  `script-src 'self'${inlineHashes.length ? ' ' + inlineHashes.join(' ') : ''}`,
  `style-src 'self' 'unsafe-inline'`, // index.html uses style="" attributes
  `img-src 'self' data:`,
  `connect-src 'self' ws: wss:`, // ws:/wss: for old Safari and ?server= overrides
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'none'`,
  `frame-ancestors 'none'`,
].join('; ');

const app = express();
app.disable('x-powered-by');
if (TRUST_PROXY) app.set('trust proxy', true);

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.set('Allow', 'GET, HEAD').status(405).end();
  }
  next();
});
app.use(express.static(DIST, {
  setHeaders(res, file) {
    if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); // deploys show up on reload
    else if (file.startsWith(LEVELS_DIR)) res.setHeader('Cache-Control', 'no-cache'); // an edited map must not linger in a browser cache: players in one match have to load the same terrain
    else if (/-[\w-]{8,}\.(js|css)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // vite content-hashes these
  },
}));

/* ---------- GET /level/<param>: one level's text ---------- */
/* Native clients ship their own copy of levels/levels.txt, which can be
   older than what is deployed here — and a client that loads different
   terrain from the rest of the match walks through walls in everyone
   else's game. So they fetch the match's map from us instead of trusting
   their copy, one level per request rather than the whole 60-level bundle.
   Browsers need none of this: they already load the bundle from this
   server. Resolution matches the browser's ?level= handling — a number
   picks the entry named "levelN", anything else is an entry name, and a
   name that isn't in the bundle falls back to a standalone
   levels/<name>.txt draft. */

// dist/ is fixed for the life of the process (a deploy restarts us, which is
// also what re-hashes the CSP above), so the bundle is split exactly once
const bundleLevels = new Map(); // name -> text
try {
  let name = null;
  let lines = [];
  const flush = () => { if (name) bundleLevels.set(name, lines.join('\n')); };
  for (const line of fs.readFileSync(path.join(LEVELS_DIR, 'levels.txt'), 'utf8').split('\n')) {
    if (line.startsWith('===')) {
      flush();
      name = line.slice(3).trim();
      lines = [];
    } else if (name !== null) lines.push(line);
  }
  flush();
} catch (err) {
  console.error('dist/levels/levels.txt could not be read — /level/<name> will 404:', err.message);
}

const sendLevel = (res, text) => res
  .type('text/plain; charset=utf-8')
  .set('Cache-Control', 'no-cache') // a deploy can change a level under a client
  .send(text);

app.get('/level/:param', (req, res) => {
  // cleanLevel strips path separators, so the name can't escape LEVELS_DIR
  const param = cleanLevel(req.params.param);
  const name = /^\d+$/.test(param) ? `level${Number(param)}` : param;
  const text = bundleLevels.get(name);
  if (text !== undefined) return sendLevel(res, text);
  fs.readFile(path.join(LEVELS_DIR, `${name}.txt`), 'utf8', (err, data) => {
    if (err) return res.status(404).type('text/plain').send(`no level "${name}"\n`);
    sendLevel(res, data);
  });
});

const server = http.createServer(app);

/* ---------- lobby + matches ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('error', (err) => console.error('wss error:', err.message));

const TEAM_MAX = 5;        // players per side
const ROOM_MAX = 12;       // members per room (a full 5v5 plus a few undecided)
const MAX_ROOMS = 50;      // caps room-spam from a hostile client

let nextId = 1;
let nextRoomId = 1;
const lobby = new Map();   // id -> {id, ws, name, level, room, team}
const rooms = new Map();   // id -> {id, name} — exists while it has members
const matches = new Map(); // id -> {id, level, created, started, slots:[{token, pid, team, name, ws, ready, connected, abandoned}]}
const ipConns = new Map(); // ip -> open connection count

const send = (ws, obj) => {
  if (!ws || ws.readyState !== 1) return;
  if (ws.bufferedAmount > MAX_BUFFERED) { ws.terminate(); return; }
  ws.send(JSON.stringify(obj));
};

const roomCount = (id) => [...lobby.values()].filter((c) => c.room === id).length;

function leaveRoom(c) {
  const id = c.room;
  c.room = null;
  c.team = null;
  if (id != null && rooms.has(id) && roomCount(id) === 0) rooms.delete(id);
}

function roster() {
  const players = [...lobby.values()].map((c) => ({ id: c.id, name: c.name, room: c.room, team: c.team }));
  const rms = [...rooms.values()].map((r) => ({
    id: r.id, name: r.name, count: players.filter((p) => p.room === r.id).length,
  }));
  for (const c of lobby.values()) send(c.ws, { type: 'lobby', rooms: rms, players });
}

/* names end up in client DOM/HTML — keep them to a harmless charset */
const cleanName = (n) => String(n || '').replace(/[^\w .\-]/g, '').trim().slice(0, 16);
/* level names end up in the other players' URLs and a levels/<name>.txt fetch */
const cleanLevel = (l) => String(l ?? '1').replace(/[^\w\-]/g, '').slice(0, 32) || '1';

function dropFromLobby(c) {
  if (!lobby.has(c.id)) return;
  lobby.delete(c.id);
  leaveRoom(c); // after the delete, so the room count no longer includes them
  roster();
}

/* broadcast the ready tally; start once every active slot is ready.
   (Re-fires harmlessly after a mid-match rejoin — clients ignore a
   repeated "go".) */
function tryGo(match) {
  const active = match.slots.filter((s) => !s.abandoned);
  const count = active.filter((s) => s.ready).length;
  for (const s of active) send(s.ws, { type: 'ready', count, total: active.length });
  if (active.length && active.every((s) => s.ready && s.connected)) {
    match.started = true;
    for (const s of active) send(s.ws, { type: 'go' });
  }
}

function clientIp(req) {
  if (TRUST_PROXY) {
    // the proxy appends the real client last; earlier entries are spoofable
    const last = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (last) return last;
  }
  return req.socket.remoteAddress || 'unknown';
}

/* browsers always send Origin on WebSocket upgrades; require it to match
   the page's host (or an ALLOWED_ORIGINS entry) so other sites can't
   drive the lobby from their visitors' browsers */
function originAllowed(req) {
  const origin = String(req.headers.origin || '').toLowerCase().replace(/\/$/, '');
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try { return new URL(origin).host === String(req.headers.host || '').toLowerCase(); }
  catch { return false; }
}

wss.on('connection', (ws, req) => {
  ws.on('error', () => ws.terminate()); // unhandled 'error' would crash the process

  if (!originAllowed(req)) { ws.close(1008, 'origin not allowed'); return; }
  if (wss.clients.size > MAX_CLIENTS) { ws.close(1013, 'server full'); return; }
  const ip = clientIp(req);
  const conns = (ipConns.get(ip) || 0) + 1;
  if (conns > MAX_CONNS_PER_IP) { ws.close(1013, 'too many connections'); return; }
  ipConns.set(ip, conns);
  ws.once('close', () => {
    const n = (ipConns.get(ip) || 1) - 1;
    if (n <= 0) ipConns.delete(ip); else ipConns.set(ip, n);
  });

  ws.isAlive = true;
  ws.bucket = RATE_BURST;
  ws.bucketStamp = Date.now();
  ws.dropped = 0;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    const now = Date.now();
    ws.bucket = Math.min(RATE_BURST, ws.bucket + (now - ws.bucketStamp) * (RATE_PER_SEC / 1000));
    ws.bucketStamp = now;
    if (ws.bucket < 1) {
      if (++ws.dropped > MAX_DROPPED) ws.terminate();
      return;
    }
    ws.bucket -= 1;

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    const c = ws.client;    // lobby record, if joined
    const mr = ws.matchRef; // {match, slot}, if rejoined into a match

    switch (msg.type) {
      case 'join': {
        if (c || mr) return;
        const name = cleanName(msg.name);
        if (!name) { send(ws, { type: 'error', message: 'PICK A CALLSIGN FIRST' }); return; }
        if ([...lobby.values()].some((o) => o.name.toLowerCase() === name.toLowerCase())) {
          send(ws, { type: 'error', message: 'CALLSIGN ALREADY TAKEN' });
          return;
        }
        const client = {
          id: nextId++, ws, name,
          level: cleanLevel(msg.level), // the level this player has loaded; used if they start the match
          room: null, team: null,
        };
        lobby.set(client.id, client);
        ws.client = client;
        send(ws, { type: 'joined', id: client.id, name });
        roster();
        break;
      }

      case 'createRoom': {
        if (!c || c.room != null) return;
        if (rooms.size >= MAX_ROOMS) {
          send(ws, { type: 'error', message: 'THE SERVER IS FULL OF ROOMS — JOIN ONE INSTEAD' });
          return;
        }
        const room = { id: nextRoomId++, name: `${c.name.toUpperCase()}'S ROOM` };
        rooms.set(room.id, room);
        c.room = room.id;
        roster();
        break;
      }

      case 'joinRoom': {
        if (!c || c.room != null) return;
        const room = rooms.get(msg.roomId);
        if (!room) { send(ws, { type: 'error', message: 'THAT ROOM IS GONE' }); return; }
        if (roomCount(room.id) >= ROOM_MAX) { send(ws, { type: 'error', message: 'THAT ROOM IS FULL' }); return; }
        c.room = room.id;
        roster();
        break;
      }

      case 'leaveRoom': {
        if (!c || c.room == null) return;
        leaveRoom(c);
        roster();
        break;
      }

      case 'team': { // pick a side within my room (or null to step back off the roster)
        if (!c || c.room == null) return;
        const team = msg.team === 'blue' || msg.team === 'red' ? msg.team : null;
        if (team && team !== c.team
          && [...lobby.values()].filter((o) => o.room === c.room && o.team === team).length >= TEAM_MAX) {
          send(ws, { type: 'error', message: `THE ${team.toUpperCase()} TEAM IS FULL` });
          return;
        }
        c.team = team;
        roster();
        break;
      }

      case 'startMatch': {
        if (!c || c.room == null || !c.team) return;
        const roomId = c.room;
        const fighters = [...lobby.values()].filter((o) => o.room === roomId && o.team);
        const blue = fighters.filter((o) => o.team === 'blue').length;
        if (!blue || blue === fighters.length) {
          send(ws, { type: 'error', message: 'BOTH TEAMS NEED AT LEAST ONE PILOT' });
          return;
        }
        const match = {
          id: crypto.randomUUID(),
          level: c.level, // the starter's level is played
          created: Date.now(),
          started: false,
          slots: fighters.map((o) => ({
            token: crypto.randomUUID(), pid: o.id, team: o.team, name: o.name,
            ws: null, ready: false, connected: false, abandoned: false,
          })),
        };
        matches.set(match.id, match);
        const players = match.slots.map((s) => ({ id: s.pid, name: s.name, team: s.team }));
        // everyone on a team in this room now reloads into the match —
        // drop them from the lobby; the room lives on for any undecided
        // members, or dies with its last fighter
        for (const s of match.slots) {
          const o = lobby.get(s.pid);
          send(o.ws, {
            type: 'matchStart', matchId: match.id, token: s.token,
            playerId: s.pid, team: s.team, level: match.level, roster: players,
          });
          o.ws.client = null;
          lobby.delete(o.id);
        }
        if (roomCount(roomId) === 0) rooms.delete(roomId);
        roster();
        break;
      }

      case 'rejoin': {
        if (c || mr) return;
        if (typeof msg.matchId !== 'string' || typeof msg.token !== 'string') return;
        const match = matches.get(msg.matchId);
        const slot = match && match.slots.find((s) => s.token === msg.token);
        if (!slot) { send(ws, { type: 'error', message: 'MATCH NO LONGER EXISTS' }); return; }
        if (slot.ws) { try { slot.ws.close(); } catch { /* stale socket */ } }
        slot.ws = ws;
        slot.connected = true;
        slot.abandoned = false;
        ws.matchRef = { match, slot };
        send(ws, {
          type: 'rejoined', playerId: slot.pid, team: slot.team, level: match.level,
          roster: match.slots.filter((s) => !s.abandoned)
            .map((s) => ({ id: s.pid, name: s.name, team: s.team, connected: s.connected })),
        });
        for (const s of match.slots) {
          if (s !== slot) send(s.ws, { type: 'peerJoined', id: slot.pid, name: slot.name });
        }
        break;
      }

      case 'ready': {
        if (!mr) return;
        mr.slot.ready = true;
        tryGo(mr.match);
        break;
      }

      case 'relay': {
        if (!mr || msg.data === undefined) return;
        for (const s of mr.match.slots) {
          if (s !== mr.slot) send(s.ws, { type: 'relay', from: mr.slot.pid, data: msg.data });
        }
        break;
      }

      case 'leave': {
        if (c) { dropFromLobby(c); ws.client = null; }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws.client) dropFromLobby(ws.client);
    const mr = ws.matchRef;
    if (mr && mr.slot.ws === ws) {
      mr.slot.ws = null;
      mr.slot.connected = false;
      for (const s of mr.match.slots) send(s.ws, { type: 'peerLeft', id: mr.slot.pid, name: mr.slot.name });
      if (mr.match.slots.every((s) => !s.connected)) matches.delete(mr.match.id);
    }
  });
});

/* heartbeat + sweep pre-start matches for players who never made it back
   after the reload: they forfeit their slot (so the ready handshake can't
   deadlock on them), and a match that lost a whole team is called off */
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const m of matches.values()) {
    if (m.started || now - m.created <= 60_000) continue;
    let pruned = false;
    for (const s of m.slots) {
      if (!s.connected && !s.abandoned) {
        s.abandoned = true;
        pruned = true;
        for (const o of m.slots) if (o !== s) send(o.ws, { type: 'peerLeft', id: s.pid, name: s.name });
      }
    }
    const active = m.slots.filter((s) => !s.abandoned);
    if (!active.length) { matches.delete(m.id); continue; }
    if (!active.some((s) => s.team === 'blue') || !active.some((s) => s.team === 'red')) {
      for (const s of active) send(s.ws, { type: 'error', message: 'THE OTHER TEAM NEVER SHOWED UP' });
      matches.delete(m.id);
      continue;
    }
    if (pruned) tryGo(m);
  }
}, 30_000);

/* let the platform (or ^C) stop the server cleanly */
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    console.log(`${sig} — shutting down`);
    server.close(() => process.exit(0));
    server.closeIdleConnections(); // keep-alive HTTP connections would stall close()
    for (const ws of wss.clients) ws.close(1001, 'server shutting down');
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

server.listen(PORT, HOST, () => {
  console.log(`mech-vs-mech server → http://${HOST || 'localhost'}:${PORT}  (WebSocket lobby on /ws)`);
});
