#!/usr/bin/env node
/* ============================================================
   Multiplayer server

   Serves the game statically AND runs the WebSocket lobby/match
   relay on the same port:

     npm install && npm start      →  http://localhost:8080

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
============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;

/* ---------- static files ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ---------- lobby + matches ---------- */
const wss = new WebSocketServer({ server, path: '/ws' });

let nextId = 1;
const lobby = new Map();   // id -> {id, ws, name, level, busy, peer, initiator}
const matches = new Map(); // id -> {id, level, created, slots:[{token, role, name, ws, ready, connected}]}

const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function roster() {
  const players = [...lobby.values()].map((c) => ({ id: c.id, name: c.name, busy: c.busy }));
  for (const c of lobby.values()) send(c.ws, { type: 'lobby', players });
}

/* names end up in client DOM/HTML — keep them to a harmless charset */
const cleanName = (n) => String(n || '').replace(/[^\w .\-]/g, '').trim().slice(0, 16);

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

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
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
          level: String(msg.level || '1').slice(0, 40), // the level this player has loaded; used when they challenge
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
        if (!mr) return;
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

server.listen(PORT, () => {
  console.log(`mech-vs-mech server → http://localhost:${PORT}  (WebSocket lobby on /ws)`);
});
