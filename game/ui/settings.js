import { touch } from '../core/state.js';
import { ACTIONS, bindingLabel, bind, resetBindings, keyLabel } from '../systems/bindings.js';
import { addAction } from './menu.js';

/* ============================================================
   Settings — the key bindings screen

   The same three-piece frame as every other screen (ui/menu.js):
   nav bar back, a scrolling column of cards, one green action.
   Every keyboard control is one LABEL · VALUE row — press the
   row, then press the key you want. What a key means lives in
   systems/bindings.js; this screen only edits it.

   Listening for the new key is a *capture-phase* listener, so
   the press is swallowed before it reaches the menu's own
   ↑ ↓ ← → navigation or the game's input handler — otherwise
   binding an arrow key would walk the cursor off the row while
   binding it. Esc cancels, as does clicking anywhere else.

   Web only: the iOS build is driven by the touch controls, and
   the entry points here are removed on a touch device.
============================================================ */

const screen = document.getElementById('settingsScreen');
const list = document.getElementById('keyBinds');
const noteEl = document.getElementById('keysNote');

let fromScreen = null;   // the screen that opened this one, to go back to

export function showSettings(open, from) {
  if (open) {
    fromScreen = from || document.getElementById('modeScreen');
    fromScreen.classList.add('hidden');
    stopListening();
    note('PRESS A ROW, THEN PRESS THE KEY YOU WANT');
  } else if (fromScreen) {
    stopListening();
    fromScreen.classList.remove('hidden');
    fromScreen = null;
  }
  screen.classList.toggle('hidden', !open);
}

function note(text) { noteEl.textContent = text; }

/* ---------- the rows ---------- */
const rows = ACTIONS.map((a) => addAction(list, {
  label: a.label,
  value: bindingLabel(a.id),
  onClick: () => listen(a.id),
}));

function reflect(id) {
  const i = ACTIONS.findIndex((a) => a.id === id);
  if (i >= 0) rows[i].value.textContent = bindingLabel(id);
}

function reflectAll() { for (const a of ACTIONS) reflect(a.id); }

/* ---------- listening for the next key ---------- */
let listening = null;   // action id waiting for a key

function stopListening() {
  if (!listening) return;
  reflect(listening);
  listening = null;
  document.removeEventListener('keydown', onKey, true);
  document.removeEventListener('pointerdown', onPointer, true);
}

function listen(id) {
  stopListening();
  listening = id;
  const i = ACTIONS.findIndex((a) => a.id === id);
  rows[i].value.textContent = 'PRESS A KEY…';
  rows[i].main.focus();      // Safari doesn't focus a button on click
  note('PRESS THE NEW KEY · ESC CANCELS');
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onPointer, true);
}

function onKey(e) {
  e.preventDefault();
  e.stopPropagation();      // never reaches the menu navigation or the game
  const id = listening;
  if (e.code === 'Escape' || !e.code) { stopListening(); note('UNCHANGED'); return; }
  const stolen = bind(id, e.code);
  stopListening();
  for (const other of stolen) reflect(other);
  reflect(id);
  const label = ACTIONS.find((a) => a.id === id).label;
  note(stolen.length
    ? `${keyLabel(e.code)} TAKEN FROM ${ACTIONS.find((a) => a.id === stolen[0]).label}`
    : `${label} · ${keyLabel(e.code)}`);
  window.dispatchEvent(new Event('mech:keyschanged'));
}

function onPointer() { stopListening(); note('UNCHANGED'); }

/* ---------- the screen's own buttons ---------- */
document.getElementById('setBack').addEventListener('click', () => showSettings(false));
document.getElementById('setDone').addEventListener('click', () => showSettings(false));
document.getElementById('setReset').addEventListener('click', () => {
  stopListening();
  resetBindings();
  reflectAll();
  note('BINDINGS BACK TO THE FACTORY LAYOUT');
  window.dispatchEvent(new Event('mech:keyschanged'));
});

/* the entry screen's own way in — a phone has no keyboard to rebind, so on a
   touch device the card simply isn't there (core/flow.js drops its row too) */
const setBtn = document.getElementById('setBtn');
if (touch.active) setBtn.remove();
else setBtn.addEventListener('click', () => showSettings(true, document.getElementById('modeScreen')));
