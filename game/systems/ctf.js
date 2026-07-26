import * as THREE from 'three';
import { scene } from '../world/scene.js';
import { LEVEL, WALL_H, VOID_EDGE, groundHeightAt } from '../world/world.js';
import { entities, BLUE, RED } from '../entities/entities.js';
import { game, stats, CAPTURES_TO_WIN } from '../core/state.js';
import { showMessage, updateHud } from '../ui/hud.js';
import { endGame } from '../core/flow.js';
import { beep, boomSfx } from './audio.js';
import { MP, sendGame, netRegistry } from '../net/net.js';

/* ============================================================
   Capture the flag

   Each base gets a flag on a stand in its own courtyard — inside
   the compound walls, so taking one means walking into the enemy
   fort exactly like shooting their base does. Touch the enemy
   flag to shoulder it, carry it to your own stand to score; drop
   it by dying, and touching your own dropped flag sends it home.
   First team to CAPTURES_TO_WIN captures takes the district, and
   that is the *only* way to take it: a base can still be levelled
   (which in single player stops that side's waves — ai.js), but
   flags decide a flag match (projectiles.js `killEntity`).

   Multiplayer: flags are shared and unowned, like the bases. Only
   the client that simulates a mech reports what that mech does
   with a flag (grab/drop/return/capture); everyone else mirrors
   the event. The score travels with the capture, so a lost
   message can't leave the two sides disagreeing about it. The
   return-home timer runs locally on every client — it needs no
   message because every client starts it from the same event.
============================================================ */
const RETURN_AFTER = 25;  // seconds a dropped flag waits for a rescue
const GRAB_R = 4.5;       // how close a mech has to be to shoulder a flag
const CAP_R = 7;          // …and to its own stand to score
const LOST_GRACE = 3;     // carrier vanished without a drop message → go home

/* the flag stand: far enough in front of the base to clear its platform and
   its collision circle, well short of the compound's inner screen. Levels
   whose bases don't face each other down an axis fall back to the cardinal
   pointing at the enemy, then to the base tile itself. */
function homeSpot(team) {
  const b = team === 'blue' ? LEVEL.blueBase : LEVEL.redBase;
  const o = team === 'blue' ? LEVEL.redBase : LEVEL.blueBase;
  const dx = o.x - b.x, dz = o.z - b.z;
  const d = Math.hypot(dx, dz) || 1;
  const bh = groundHeightAt(b.x, b.z);
  const dirs = [[dx / d, dz / d]];
  if (Math.abs(dx) > Math.abs(dz)) dirs.push([Math.sign(dx), 0]);
  else dirs.push([0, Math.sign(dz)]);
  for (const [ux, uz] of dirs) {
    for (const r of [13, 15, 11, 17, 9]) {
      const x = b.x + ux * r, z = b.z + uz * r;
      const h = groundHeightAt(x, z);
      // a wall reads as WALL_H; a step off the base's own tier would put the
      // flag somewhere a mech can't walk back out of
      if (h < WALL_H - 0.01 && Math.abs(h - bh) < 1.2) return { x, y: h, z };
    }
  }
  return { x: b.x, y: bh, z: b.z };
}

function makeFlagModel(palette, ghost) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 9, 6),
    new THREE.MeshStandardMaterial({ color: 0xd8dce6, roughness: 0.4, metalness: 0.6 }));
  pole.position.y = 4.5; pole.castShadow = true; g.add(pole);
  const cloth = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 2.3, 0.16),
    new THREE.MeshStandardMaterial({
      color: palette.body, emissive: palette.accent,
      emissiveIntensity: ghost ? 0.25 : 1.1, roughness: 0.5,
      transparent: !!ghost, opacity: ghost ? 0.35 : 1,
    }));
  cloth.position.set(1.9, 7.6, 0); cloth.castShadow = !ghost; g.add(cloth);
  return g;
}

/* the stand stays put and marks home even while the flag is away */
function makeStandModel(palette) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 3.0, 0.5, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.8 }));
  ring.position.y = 0.25; ring.receiveShadow = true; g.add(ring);
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 1.7, 0.16, 12),
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: palette.accent, emissiveIntensity: 1.4 }));
  glow.position.y = 0.55; g.add(glow);
  return g;
}

/* A flag is not an entity (it has no hp, nothing can shoot it), but it is
   shaped like one — kind/team/alive/group/hitRadius — so the enemy AI can
   aim its steering at it with the same code it uses for a base. */
function makeFlag(team) {
  const palette = team === 'blue' ? BLUE : RED;
  const group = makeFlagModel(palette, false);
  const standGroup = makeStandModel(palette);
  const ghost = makeFlagModel(palette, true); // where it belongs, while it's gone
  standGroup.add(ghost);
  scene.add(group);
  scene.add(standGroup);
  const f = {
    kind: 'flag', team, alive: true, group,
    hitRadius: 1.2, hitHeight: 6,
    home: { x: 0, y: 0, z: 0 },
    carrier: null, state: 'home', dropT: 0, lostT: 0,
    // the home stand, targetable in its own right (a carrier walks to it)
    stand: { kind: 'flag', team, alive: true, group: standGroup, hitRadius: 1.2, hitHeight: 5 },
    ghost,
  };
  return f;
}

export const flags = { blue: makeFlag('blue'), red: makeFlag('red') };

export function ctfOn() { return game.mode === 'ctf'; }

const myTeam = () => MP.myTeam;
const foeFlag = (team) => (team === 'blue' ? flags.red : flags.blue);
const ownFlag = (team) => (team === 'blue' ? flags.blue : flags.red);

/* the mechs this client simulates: in PvP only my own, in single player
   everything (the AI included). `simulated` still holds for a mech that
   just died — dropping its flag is the owner's call, not the killer's. */
const simulated = (e) => !!e && !e.remote && (!MP.active || e.owner === MP.playerId);
const isMine = (e) => simulated(e) && e.alive;

const carriedBy = (e) => (flags.blue.carrier === e ? flags.blue : flags.red.carrier === e ? flags.red : null);

function near(e, p, r) {
  const q = e.group.position;
  const dy = Math.abs((e.y ?? q.y) - p.y);
  return dy < 8 && (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < r * r;
}

/* ---------- state changes (each one is also a wire event) ---------- */
function placeAtHome(f) {
  f.group.position.set(f.home.x, f.home.y + 0.6, f.home.z);
  f.group.rotation.y = 0;
}

function grabFlag(f, e, announce) {
  f.carrier = e;
  f.state = 'carried';
  f.lostT = 0;
  if (announce) sendGame({ t: 'fgrab', tm: f.team, by: e.netId });
  const mine = f.team === myTeam();
  showMessage(mine ? 'YOUR FLAG HAS BEEN TAKEN' : 'ENEMY FLAG TAKEN — RUN IT HOME',
    mine ? '#ff5040' : '#7CFF6B');
  beep(mine ? 200 : 640, mine ? 120 : 900, 0.25, 'square', 0.09);
  updateHud();
}

function dropFlag(f, pos, announce) {
  // dropped over a chasm there would be no getting it back — send it home
  if (groundHeightAt(pos.x, pos.z) < VOID_EDGE) { returnFlag(f, announce, true); return; }
  f.carrier = null;
  f.state = 'dropped';
  f.dropT = RETURN_AFTER;
  f.lostT = 0;
  const y = groundHeightAt(pos.x, pos.z);
  f.group.position.set(pos.x, y + 0.6, pos.z);
  if (announce) {
    sendGame({ t: 'fdrop', tm: f.team, x: +pos.x.toFixed(1), z: +pos.z.toFixed(1) });
  }
  showMessage(f.team === myTeam() ? 'YOUR FLAG WAS DROPPED' : 'ENEMY FLAG DROPPED', '#ffd23c');
  updateHud();
}

function returnFlag(f, announce, byTouch) {
  f.carrier = null;
  f.state = 'home';
  f.dropT = 0;
  f.lostT = 0;
  placeAtHome(f);
  if (announce) sendGame({ t: 'fret', tm: f.team });
  if (byTouch) {
    showMessage(f.team === myTeam() ? 'YOUR FLAG IS BACK HOME' : 'ENEMY FLAG RECOVERED',
      f.team === myTeam() ? '#7CFF6B' : '#ffd23c');
    beep(520, 760, 0.18, 'sine', 0.07);
  }
  updateHud();
}

function captureFlag(f, e, announce) {
  const team = e.team;
  stats.captures[team]++;
  returnFlag(f, false, false);
  if (announce) {
    sendGame({
      t: 'fcap', tm: f.team, by: e.netId,
      b: stats.captures.blue, r: stats.captures.red,
    });
  }
  finishCapture(team);
}

/* shared by the scoring client and everyone mirroring it */
function finishCapture(team) {
  const mine = team === myTeam();
  showMessage(`${mine ? 'FLAG CAPTURED' : 'ENEMY CAPTURE'} — ${stats.captures[myTeam()]} : ${stats.captures[MP.enemyTeam]}`,
    mine ? '#7CFF6B' : '#ff5040');
  boomSfx(0.25, mine ? 0.7 : 0.4);
  updateHud();
  if (stats.captures[team] >= CAPTURES_TO_WIN) {
    endGame(mine, mine
      ? `${CAPTURES_TO_WIN} FLAGS CAPTURED — DISTRICT SECURED`
      : `THE ENEMY CAPTURED ${CAPTURES_TO_WIN} FLAGS`);
  }
}

/* ---------- multiplayer: mirror what another client's mech did ---------- */
export function onFlagMsg(d) {
  const f = d.tm === 'blue' ? flags.blue : d.tm === 'red' ? flags.red : null;
  if (!f) return;
  switch (d.t) {
    case 'fgrab': {
      const e = netRegistry.get(d.by);
      if (!e) return;
      grabFlag(f, e, false);
      break;
    }
    case 'fdrop':
      dropFlag(f, { x: d.x, z: d.z }, false);
      break;
    case 'fret':
      returnFlag(f, false, true);
      break;
    case 'fcap': {
      const e = netRegistry.get(d.by);
      returnFlag(f, false, false);
      stats.captures.blue = d.b;
      stats.captures.red = d.r;
      finishCapture(e ? e.team : (f.team === 'blue' ? 'red' : 'blue'));
      break;
    }
  }
}

/* ---------- map switching: the flags follow the new map ---------- */
export function resetFlags() {
  for (const f of [flags.blue, flags.red]) {
    f.home = homeSpot(f.team);
    f.carrier = null;
    f.state = 'home';
    f.dropT = 0;
    f.lostT = 0;
    placeAtHome(f);
    f.stand.group.position.set(f.home.x, f.home.y, f.home.z);
  }
  stats.captures.blue = 0;
  stats.captures.red = 0;
  refreshFlags();
}

/* mode toggled in the menu, or a fresh map: show/hide the whole set */
export function refreshFlags() {
  const on = ctfOn();
  for (const f of [flags.blue, flags.red]) {
    // a carried flag stays visible: it rides above its carrier on purpose
    f.group.visible = on;
    f.stand.group.visible = on;
    f.ghost.visible = f.state !== 'home';
  }
}

resetFlags();
// the mission menu's mode row (core/flow.js) flips the flags in and out
window.addEventListener('mech:modechanged', refreshFlags);

/* ---------- per-frame ---------- */
export function updateCtf(dt) {
  if (!ctfOn()) return;

  for (const f of [flags.blue, flags.red]) {
    if (f.state === 'carried') {
      const c = f.carrier;
      if (!c || !c.alive || !entities.includes(c)) {
        // my own carrier died: drop it where it fell. Someone else's is
        // their client's call — but if that message never comes (they
        // disconnected mid-run) the flag would be stranded, so bring it home.
        if (simulated(c)) dropFlag(f, c.group.position, MP.active);
        else if ((f.lostT += dt) > LOST_GRACE) returnFlag(f, false, false);
      } else {
        f.lostT = 0;
        const p = c.group.position;
        f.group.position.set(p.x, p.y + (c.hitHeight || 7) + 1.4, p.z);
        f.group.rotation.y = (c.yaw || 0) + Math.PI;
      }
    } else if (f.state === 'dropped') {
      f.dropT -= dt;
      // every client runs this timer off the same drop event — no message
      if (f.dropT <= 0) returnFlag(f, false, true);
    }
    // a carried flag rides above its carrier in plain sight — the runner is
    // meant to be the thing everyone converges on
    f.ghost.visible = f.state !== 'home';
  }

  // touches, for the mechs this client simulates
  for (const e of entities) {
    if ((e.kind !== 'player' && e.kind !== 'mech') || !isMine(e)) continue;
    const carrying = carriedBy(e);
    const own = ownFlag(e.team);
    if (carrying) {
      if (near(e, own.home, CAP_R)) captureFlag(carrying, e, MP.active);
      continue;
    }
    const foe = foeFlag(e.team);
    if (foe.state !== 'carried' && near(e, foe.group.position, GRAB_R)) {
      grabFlag(foe, e, MP.active);
    } else if (own.state === 'dropped' && near(e, own.group.position, GRAB_R)) {
      returnFlag(own, MP.active, true);
    }
  }
}

/* ---------- what the enemy AI should walk at (systems/ai.js) ---------- */
export function ctfGoal(e) {
  const own = ownFlag(e.team), foe = foeFlag(e.team);
  if (foe.carrier === e) return own.stand;                 // carrying: run it home
  if (own.state === 'carried' && own.carrier && own.carrier.alive) return own.carrier; // hunt the thief
  if (e.flagRunner && foe.state !== 'carried') return foe;  // fetch theirs
  if (own.state === 'dropped') return own;                  // ours is loose: recover it
  return null;
}
