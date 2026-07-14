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
   Shared mutable game state
============================================================ */
const saved = localStorage.getItem('mechDifficulty');

export const game = {
  state: 'menu',          // menu | playing | over
  elapsed: 0,
  weapon: 1,              // desktop weapon slot: 1 machine gun, 2 rockets
  buildMode: false,
  mouseDown: false,
  pointerLocked: false,
  difficulty: DIFFICULTIES[saved] ? saved : 'medium',
};

/* touch/mobile input, written by systems/mobile.js, read by the player update */
export const touch = {
  active: false,  // true on touch devices
  move: 0,        // gyro lean: 1 forward, -1 backward, 0 neutral
  strafe: 0,      // gyro side tilt: 1 right, -1 left, 0 neutral
  yaw: null,      // compass-driven target yaw in radians (null = keyboard/mouse)
};

export const stats = {
  salvage: 150, ammo: 6552, rockets: 30,
  turretsBuilt: 0, kills: 0, wave: 0,
};

export function difficulty() { return DIFFICULTIES[game.difficulty]; }
