#!/usr/bin/env node
/* ============================================================
   Multiplayer server

   Serves the built game (dist/, via express) AND runs the
   WebSocket lobby/match relay on the same port:

     npm install && npm start      →  http://localhost:8080
     (npm start builds dist/ first via the prestart script)

   The server never simulates the game — each client owns its own
   side's entities (player, turrets, base) and the server just
   relays events between the two clients of a match.

   Lobby protocol (JSON):
     → join {name, level}            ← joined {id,name} | error {message}
                                     ← lobby {players:[{id,name,busy}]}
     → challenge {targetId}          ← challenge {fromId,fromName,level} (to target)
                                     ← challengeSent {targetId,targetName}
     → challengeCancel               ← challengeCancelled
     → challengeResponse {accept}    ← challengeDeclined {name}
                                     ← matchStart {matchId,token,role,level,opponent}
   Match protocol (both clients reload into ?mp=1, then):
     → rejoin {matchId, token}       ← rejoined {role,level,opponent} | error
     → ready                         ← go            (once both are ready)
     → relay {data}                  ← relay {data}  (forwarded to the opponent)
                                     ← opponentLeft

   Internet hardening — everything is tuned by env vars, all optional:
     PORT               listen port (default 8080)
     TRUST_PROXY=1      behind a TLS-terminating reverse proxy: trust
                        X-Forwarded-* for client IPs / HSTS
     ALLOWED_ORIGINS    extra WebSocket origins, comma-separated
                        (same-origin as the page is always allowed)
     MAX_CLIENTS        total WebSocket connections (default 200)
     MAX_CONNS_PER_IP   per-address connections (default 8)
============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;

const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim().toLowerCase().replace(/\/$/, '')).filter(Boolean);
const MAX_CLIENTS = Number(process.env.MAX_CLIENTS) || 200;
const MAX_CONNS_PER_IP = Number(process.env.MAX_CONNS_PER_IP) || 8;

/* per-socket message budget: a token bucket well above legit peak
   traffic (15 Hz state + shots + hits from many turrets) that still
   caps a flooder; grossly-over sockets get cut entirely */
const RATE_BURST = 300;
const RATE_PER_SEC = 100;
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
    else if (/-[\w-]{8,}\.(js|css)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // vite content-hashes these
  },
}));

const server = http.createServer(app);

/* ---------- lobby + matches ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('error', (err) => console.error('wss error:', err.message));

let nextId = 1;
const lobby = new Map();   // id -> {id, ws, name, level, busy, peer, initiator}
const matches = new Map(); // id -> {id, level, created, slots:[{token, role, name, ws, ready, connected}]}
const ipConns = new Map(); // ip -> open connection count

const send = (ws, obj) => {
  if (!ws || ws.readyState !== 1) return;
  if (ws.bufferedAmount > MAX_BUFFERED) { ws.terminate(); return; }
  ws.send(JSON.stringify(obj));
};

function roster() {
  const players = [...lobby.values()].map((c) => ({ id: c.id, name: c.name, busy: c.busy }));
  for (const c of lobby.values()) send(c.ws, { type: 'lobby', players });
}

/* names end up in client DOM/HTML — keep them to a harmless charset */
const cleanName = (n) => String(n || '').replace(/[^\w .\-]/g, '').trim().slice(0, 16);
/* level names end up in the opponent's URL and a levels/<name>.txt fetch */
const cleanLevel = (l) => String(l ?? '1').replace(/[^\w\-]/g, '').slice(0, 32) || '1';

function endChallenge(...pair) {
  for (const c of pair) if (c) { c.busy = false; c.peer = null; c.initiator = false; }
}

function dropFromLobby(c) {
  if (!lobby.has(c.id)) return;
  const peer = c.peer != null ? lobby.get(c.peer) : null;
  if (peer) send(peer.ws, { type: 'challengeCancelled' });
  endChallenge(c, peer);
  lobby.delete(c.id);
  roster();
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
          level: cleanLevel(msg.level), // the level this player has loaded; used when they challenge
          busy: false, peer: null, initiator: false,
        };
        lobby.set(client.id, client);
        ws.client = client;
        send(ws, { type: 'joined', id: client.id, name });
        roster();
        break;
      }

      case 'challenge': {
        if (!c || c.busy) return;
        const t = lobby.get(msg.targetId);
        if (!t || t === c) return;
        if (t.busy) { send(ws, { type: 'error', message: `${t.name} IS BUSY` }); return; }
        c.busy = t.busy = true;
        c.peer = t.id; t.peer = c.id;
        c.initiator = true; t.initiator = false;
        send(t.ws, { type: 'challenge', fromId: c.id, fromName: c.name, level: c.level });
        send(ws, { type: 'challengeSent', targetId: t.id, targetName: t.name });
        roster();
        break;
      }

      case 'challengeCancel': {
        if (!c || !c.busy || !c.initiator) return;
        const t = lobby.get(c.peer);
        if (t) send(t.ws, { type: 'challengeCancelled' });
        endChallenge(c, t);
        roster();
        break;
      }

      case 'challengeResponse': {
        if (!c || !c.busy || c.initiator) return; // only the challenged side answers
        const ch = lobby.get(c.peer);             // the challenger
        if (!ch) { endChallenge(c); roster(); return; }
        if (!msg.accept) {
          send(ch.ws, { type: 'challengeDeclined', name: c.name });
          endChallenge(c, ch);
          roster();
          break;
        }
        const match = {
          id: crypto.randomUUID(),
          level: ch.level, // the challenger's level is played
          created: Date.now(),
          slots: [
            { token: crypto.randomUUID(), role: 'host', name: ch.name, ws: null, ready: false, connected: false },
            { token: crypto.randomUUID(), role: 'guest', name: c.name, ws: null, ready: false, connected: false },
          ],
        };
        matches.set(match.id, match);
        send(ch.ws, { type: 'matchStart', matchId: match.id, token: match.slots[0].token, role: 'host', level: match.level, opponent: c.name });
        send(ws, { type: 'matchStart', matchId: match.id, token: match.slots[1].token, role: 'guest', level: match.level, opponent: ch.name });
        // both now reload into the match — drop them from the lobby
        lobby.delete(c.id);
        lobby.delete(ch.id);
        ch.ws.client = null;
        ws.client = null;
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
        ws.matchRef = { match, slot };
        const other = match.slots.find((s) => s !== slot);
        send(ws, { type: 'rejoined', role: slot.role, level: match.level, opponent: other.name });
        break;
      }

      case 'ready': {
        if (!mr) return;
        mr.slot.ready = true;
        if (mr.match.slots.every((s) => s.ready && s.connected)) {
          for (const s of mr.match.slots) send(s.ws, { type: 'go' });
        }
        break;
      }

      case 'relay': {
        if (!mr || msg.data === undefined) return;
        const other = mr.match.slots.find((s) => s !== mr.slot);
        send(other.ws, { type: 'relay', data: msg.data });
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
      const other = mr.match.slots.find((s) => s !== mr.slot);
      if (other.connected) send(other.ws, { type: 'opponentLeft' });
      if (mr.match.slots.every((s) => !s.connected)) matches.delete(mr.match.id);
    }
  });
});

/* heartbeat + sweep matches whose players never made it back after the reload */
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const m of matches.values()) {
    if (now - m.created > 60_000 && !m.slots.every((s) => s.connected)) {
      for (const s of m.slots) if (s.connected) send(s.ws, { type: 'opponentLeft' });
      matches.delete(m.id);
    }
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

server.listen(PORT, () => {
  console.log(`mech-vs-mech server → http://localhost:${PORT}  (WebSocket lobby on /ws)`);
});
