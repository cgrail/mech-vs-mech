/* ============================================================
   Key bindings — what every key on the keyboard means

   One entry per keyboard control, and nothing outside this file
   names a `KeyboardEvent.code` any more: the held controls
   (move, strafe, turn, boost, jump, fire) are read through
   `held`, the one-shot ones (weapons, quick rocket, turret)
   through `actionOf` in systems/input.js. That indirection is
   the whole point — it is what lets ui/settings.js rebind any
   of them, and what makes the mission briefing's control legend
   show the keys the pilot actually has (core/flow.js).

   The raw key state lives here too, because "which keys are
   down" and "what a key means" are one question; input.js owns
   the listeners that write it.

   Keyboard only, so web only: the iOS port's control surface is
   the touch one (ios/MechVsMech/TouchControls.swift), which has
   nothing to rebind.
============================================================ */

/* raw KeyboardEvent.code → is it down? (written by systems/input.js) */
export const keys = {};

/* The defaults, which double as the list the settings screen draws — order is
   the order the rows appear in. An action can carry several keys (the arrow
   keys beside WASD, both shift keys, the numpad row); rebinding one replaces
   the lot, so a pilot who picks their own key gets exactly that key. */
export const ACTIONS = [
  { id: 'forward', label: 'MOVE FORWARD', def: ['KeyW', 'ArrowUp'] },
  { id: 'back', label: 'MOVE BACK', def: ['KeyS', 'ArrowDown'] },
  { id: 'strafeL', label: 'STRAFE LEFT', def: ['KeyA'] },
  { id: 'strafeR', label: 'STRAFE RIGHT', def: ['KeyD'] },
  { id: 'turnL', label: 'TURN LEFT', def: ['ArrowLeft'] },
  { id: 'turnR', label: 'TURN RIGHT', def: ['ArrowRight'] },
  { id: 'boost', label: 'BOOST', def: ['ShiftLeft', 'ShiftRight'] },
  { id: 'jump', label: 'JUMP JETS', def: ['ControlLeft', 'ControlRight'] },
  { id: 'fire', label: 'FIRE', def: ['Space'] },
  { id: 'rocket', label: 'QUICK ROCKET', def: ['KeyQ'] },
  { id: 'weapon1', label: 'MACHINE GUNS', def: ['Digit1', 'Numpad1'] },
  { id: 'weapon2', label: 'ROCKETS', def: ['Digit2', 'Numpad2'] },
  { id: 'turret', label: 'BUILD TURRET', def: ['Digit3', 'Numpad3', 'KeyT', 'KeyB'] },
  { id: 'view', label: 'CAMERA VIEW', def: ['KeyV'] },
];

const STORE = 'mechKeys';

/* action id → [codes]. Saved bindings are merged *over* the defaults rather
   than replacing them wholesale, so an action added in a later build still
   arrives bound instead of dead. */
const bound = Object.fromEntries(ACTIONS.map((a) => [a.id, a.def.slice()]));
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
  for (const a of ACTIONS) {
    const list = saved[a.id];
    if (Array.isArray(list) && list.length && list.every((c) => typeof c === 'string')) {
      bound[a.id] = list.slice();
    }
  }
} catch { /* corrupt or private mode: the defaults stand */ }

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(bound)); } catch { /* private mode */ }
}

export const boundKeys = (id) => bound[id] || [];

/* is any key of this action down right now? */
export const held = (id) => boundKeys(id).some((c) => keys[c]);

/* which action a key press triggers — bindings are kept unique, so the first
   hit is the only hit */
export function actionOf(code) {
  for (const a of ACTIONS) if (bound[a.id].includes(code)) return a.id;
  return null;
}

/* Give an action one key. Whatever else held that key loses it — two actions
   on one key is a control that fires twice — and an action left with nothing
   is simply unbound until the pilot gives it a key. Returns the ids that
   changed besides this one, so the settings screen can redraw those rows. */
export function bind(id, code) {
  const stolen = [];
  for (const a of ACTIONS) {
    if (a.id === id || !bound[a.id].includes(code)) continue;
    bound[a.id] = bound[a.id].filter((c) => c !== code);
    stolen.push(a.id);
  }
  bound[id] = [code];
  save();
  return stolen;
}

export function resetBindings() {
  for (const a of ACTIONS) bound[a.id] = a.def.slice();
  save();
}

/* ---------- how a key is written on screen ---------- */
const NAMED = {
  Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', NumpadEnter: 'NUM ENTER',
  Tab: 'TAB', Backspace: 'BKSP', CapsLock: 'CAPS', ContextMenu: 'MENU',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: 'L SHIFT', ShiftRight: 'R SHIFT',
  ControlLeft: 'L CTRL', ControlRight: 'R CTRL',
  AltLeft: 'L ALT', AltRight: 'R ALT',
  MetaLeft: 'L CMD', MetaRight: 'R CMD',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/',
  NumpadAdd: 'NUM +', NumpadSubtract: 'NUM −', NumpadMultiply: 'NUM *',
  NumpadDivide: 'NUM /', NumpadDecimal: 'NUM .',
  Home: 'HOME', End: 'END', PageUp: 'PG UP', PageDown: 'PG DN',
  Insert: 'INS', Delete: 'DEL',
};

export function keyLabel(code) {
  if (NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `NUM ${code.slice(6)}`;
  return code.toUpperCase();
}

/* the whole binding, for a settings row: "W / ↑" */
export const bindingLabel = (id) => boundKeys(id).map(keyLabel).join(' / ') || '—';

/* just the first key, for the briefing's control legend */
export const keyName = (id) => (boundKeys(id).length ? keyLabel(boundKeys(id)[0]) : '—');
