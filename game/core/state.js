import { MP } from '../net/net.js';   // import-clean: no cycle

/* ============================================================
   Difficulty settings
============================================================ */
export const DIFFICULTIES = {
  easy: {
    label: 'EASY',
    mech: { hp: 90, speed: 8.5, damage: 6, fireInterval: 0.55, range: 32, sight: 50, spread: 0.12, aimLead: 0, strafe: false, retarget: 0.7 },
    turret: { hp: 240, damage: 7, range: 40, fireInterval: 0.45 },
    redBaseHp: 900,
    wave: { interval: 26, base: 2, growthDiv: 3, maxPerWave: 4, maxAlive: 7, flank: false },
    salvageMult: 1.25,
  },
  medium: {
    label: 'MEDIUM',
    mech: { hp: 130, speed: 10, damage: 8, fireInterval: 0.38, range: 42, sight: 64, spread: 0.06, aimLead: 0.6, strafe: true, retarget: 0.5 },
    turret: { hp: 320, damage: 9, range: 46, fireInterval: 0.32 },
    redBaseHp: 1200,
    wave: { interval: 21, base: 2, growthDiv: 2, maxPerWave: 6, maxAlive: 12, flank: true },
    salvageMult: 1,
  },
  hard: {
    label: 'HARD',
    mech: { hp: 170, speed: 11.5, damage: 10, fireInterval: 0.3, range: 50, sight: 80, spread: 0.03, aimLead: 1, strafe: true, retarget: 0.35 },
    turret: { hp: 420, damage: 11, range: 52, fireInterval: 0.26 },
    redBaseHp: 1600,
    wave: { interval: 17, base: 3, growthDiv: 2, maxPerWave: 8, maxAlive: 16, flank: true },
    salvageMult: 0.8,
  },
};

/* ============================================================
   Game modes

   assault  the original: waves + destroy the enemy base
   ctf      capture the flag — both bases get a flag in their
            courtyard, carry the enemy's to your own stand.
            Bases stay destructible — levelling one stops that
            side's waves — but only captures win (systems/ctf.js)
============================================================ */
export const MODES = {
  assault: { label: '⚔ BASE ASSAULT' },
  ctf: { label: '🚩 CAPTURE THE FLAG' },
};
export const CAPTURES_TO_WIN = 3;

/* ============================================================
   Shared mutable game state
============================================================ */
const saved = localStorage.getItem('mechDifficulty');
const savedMode = localStorage.getItem('mechMode');

export const game = {
  state: 'menu',          // menu | playing | over
  elapsed: 0,
  weapon: 1,              // desktop weapon slot: 1 machine gun, 2 rockets
  mouseDown: false,
  pointerLocked: false,
  difficulty: DIFFICULTIES[saved] ? saved : 'medium',
  // in multiplayer the mode is the room's, dealt out with the match
  // credentials (net.js); in single player it's this menu choice
  mode: MP.active ? MP.mode : (MODES[savedMode] ? savedMode : 'assault'),
  // fog of war: a local view restriction, remembered like the difficulty
  // (systems/vision.js — never sent over the wire, so it is safe in PvP)
  fogOfWar: localStorage.getItem('mechFog') === '1',
};

/* Touch/mobile input, written by systems/mobile.js, read by the player update.
   `active` is decided here rather than in mobile.js because the menu is built
   from it at module scope (core/flow.js builds the CONTROLS row only on a
   touch device) and flow.js evaluates first — mobile.js is imported last. */
export const touch = {
  active: matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window,
  // control scheme, picked on the menu: 'joystick' or 'gyro'
  scheme: localStorage.getItem('mechControls') === 'gyro' ? 'gyro' : 'joystick',
  move: 0,        // forward/back, −1..1 (sign is what matters)
  strafe: 0,      // strafe, −1..1 (sign is what matters)
  boost: false,   // stick pushed hard forward (or a hard lean): run, not walk
  yaw: null,      // gyro target yaw in radians (null = yaw controlled directly)
  jump: false,    // one-shot: set by the jump button, consumed by updatePlayer
};

export const stats = {
  salvage: 150,
  turretsBuilt: 0, kills: 0, wave: 0,
  captures: { blue: 0, red: 0 },   // capture the flag: flags run home
};

/* salvage is the only currency: machine guns are free, everything else costs */
export const COSTS = { rocket: 20, turret: 100 };

export function difficulty() { return DIFFICULTIES[game.difficulty]; }
