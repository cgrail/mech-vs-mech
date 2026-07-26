/* ============================================================
   Menu rows and keyboard navigation

   Every menu screen is one vertical column of titled cards, one
   decision per card (style.css `.card`; the iOS port is laid out
   the same way — ios/MechVsMech/UI/LobbyStyles.swift). A card is
   the column's width and never grows past it: a column grows
   *down* on a small screen instead of spilling sideways
   (#overlay scrolls, so taller is free and wider is not).

   Two kinds of control live in those cards, and the difference
   is the point:

   - The big choices are cards you tick — the map (with its own
     picture, `addHero`), the mode, the team, a level. You can
     see what you are choosing.
   - The small settings stay LABEL · VALUE between ◂ ▸ steppers
     (`addOption`) — three controls in a row, never more. A value
     you cycle in place is what keeps a setting to one row on a
     phone, and it is what makes ← → mean the same thing on every
     row.

   Selection *is* DOM focus, so the keyboard, the mouse and
   touch can never disagree about what is highlighted: ↑ ↓ walk
   the visible screen, ← → change the focused option, Enter or
   Space activates it. Steppers are skipped by ↑ ↓ — they are
   what ← → drive — so a column of N options is N stops, not 3N.
============================================================ */
import { CAPTURES_TO_WIN } from '../core/state.js';

const overlay = document.getElementById('overlay');

/* ---------- option rows ---------- */

/* `values` is the cycle: [{ v, label }]. `get`/`set` read and write the
   setting itself (localStorage lives with whoever owns it, not here).
   Two overrides, both used by the map row, whose values are the level bundle
   and so change under it: `step(dir)` replaces the cycle, and `activate`
   replaces what the middle button does — there, opening the full list. */
export function addOption(list, { label, values, get, set, step, activate, title }) {
  const row = document.createElement('div');
  row.className = 'opt';

  const prev = document.createElement('button');
  prev.className = 'step';
  prev.textContent = '◂';
  prev.setAttribute('aria-label', `Previous ${label.toLowerCase()}`);

  const main = document.createElement('button');
  main.className = 'main';
  if (title) main.title = title;
  const k = document.createElement('span');
  k.className = 'k';
  k.textContent = label;
  const v = document.createElement('span');
  v.className = 'v';
  main.append(k, v);

  const next = document.createElement('button');
  next.className = 'step';
  next.textContent = '▸';
  next.setAttribute('aria-label', `Next ${label.toLowerCase()}`);

  row.append(prev, main, next);
  list.appendChild(row);

  function reflect() {
    const cur = get();
    v.textContent = values?.find((o) => o.v === cur)?.label ?? String(cur).toUpperCase();
  }

  function cycle(dir) {
    if (step) { step(dir); return; }
    const i = values.findIndex((o) => o.v === get());
    set(values[((i < 0 ? 0 : i) + dir + values.length) % values.length].v);
    reflect();
  }

  prev.addEventListener('click', () => cycle(-1));
  next.addEventListener('click', () => cycle(1));
  main.addEventListener('click', () => (activate ? activate() : cycle(1)));

  reflect();
  return { row, main, reflect };
}

/* ---------- the map hero ----------
   The map card is an option row underneath — ◂ main ▸, so ← → step to the
   neighbouring map exactly like any other setting — grown to hold the map's
   own picture (ui/thumb.js). The middle button opens the full list.
   `render` is called by whoever owns the value whenever the map changes. */
export function addHero(list, { step, activate, label = 'MAP' }) {
  const row = document.createElement('div');
  row.className = 'opt tall';

  const arrow = (glyph, dir) => {
    const b = document.createElement('button');
    b.className = 'step';
    b.textContent = glyph;
    b.setAttribute('aria-label', `${dir < 0 ? 'Previous' : 'Next'} ${label.toLowerCase()}`);
    b.addEventListener('click', () => step(dir));
    return b;
  };

  const main = document.createElement('button');
  main.className = 'main hero';
  const pic = document.createElement('span');
  pic.className = 'heroThumb';
  const cap = document.createElement('span');
  cap.className = 'heroCap';
  const t = document.createElement('span');
  t.className = 't';
  const m = document.createElement('span');
  m.className = 'm';
  const d = document.createElement('span');
  d.className = 'd';
  cap.append(t, m, d);
  main.append(pic, cap);
  main.addEventListener('click', activate);

  row.append(arrow('◂', -1), main, arrow('▸', 1));
  list.appendChild(row);

  return {
    row,
    main,
    render({ thumb, title, meta, desc }) {
      pic.textContent = '';
      pic.className = thumb ? 'heroThumb' : 'heroThumb empty';
      if (thumb) pic.appendChild(thumb);
      t.textContent = title;
      m.textContent = meta || '';
      d.textContent = desc || '';
    },
  };
}

/* ---------- cards you tick ----------
   One card per value — icon, name, one line of what it means, and a checkbox
   on the one that is picked. Used for the game mode in the mission menu and in
   a lobby room; `enabled` is what makes a joiner's mode cards read-only. */
export function addPickCards(container, { values, get, set, enabled = () => true }) {
  container.textContent = '';
  const cards = values.map((o) => {
    const b = document.createElement('button');
    b.className = 'pick';
    const ico = document.createElement('span');
    ico.className = `ico ${o.cls || 'blue'}`;
    ico.textContent = o.ico || '';
    const info = document.createElement('span');
    info.className = 'info';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = o.title;
    const d = document.createElement('span');
    d.className = 'd';
    d.textContent = o.desc || '';
    info.append(t, d);
    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = '✓';
    b.append(ico, info, check);
    b.addEventListener('click', () => {
      set(o.v);
      reflect();
    });
    container.appendChild(b);
    return { b, v: o.v };
  });

  function reflect() {
    const cur = get();
    const live = enabled();
    for (const c of cards) {
      const on = c.v === cur;
      c.b.classList.toggle('on', on);
      c.b.disabled = !live;
      // a choice somebody else made: readable, but plainly not ours to change
      c.b.classList.toggle('dimmed', !live && !on);
    }
  }

  reflect();
  return { reflect };
}

/* How a game mode is shown on a card. The icon and the one-line pitch are
   presentation, so they live here rather than in core/state.js, which is kept
   in lockstep with the iOS port's Engine/State.swift; the copy mirrors the
   `GameMode.ui*` extension in ios/MechVsMech/UI/LobbyStyles.swift. */
export const MODE_UI = [
  {
    v: 'assault', ico: '🏰', cls: 'blue', title: 'BASE ASSAULT',
    desc: 'Destroy the enemy base at the far end of the district.',
  },
  {
    v: 'ctf', ico: '🚩', cls: 'red', title: 'CAPTURE THE FLAG',
    desc: `Steal the enemy flag and run it home — ${CAPTURES_TO_WIN} captures win.`,
  },
];
export const modeUi = (v) => MODE_UI.find((m) => m.v === v) || MODE_UI[0];

/* a row that runs a command instead of holding a value (no steppers, same
   size as everything else in the column) */
export function addAction(list, { label, value, onClick, id }) {
  const row = document.createElement('div');
  row.className = 'opt';
  const main = document.createElement('button');
  main.className = 'main wide';
  if (id) main.id = id;
  const k = document.createElement('span');
  k.className = 'k';
  k.textContent = label;
  const v = document.createElement('span');
  v.className = 'v';
  v.textContent = value || '';
  main.append(k, v);
  main.addEventListener('click', onClick);
  row.appendChild(main);
  list.appendChild(row);
  return { row, main, value: v };
}

/* ---------- keyboard navigation ---------- */

function activeScreen() {
  if (overlay.classList.contains('hidden')) return null;
  return [...overlay.querySelectorAll('.screen')].find((s) => !s.classList.contains('hidden')) || null;
}

/* everything on the screen that ↑ ↓ should stop on, in visual order.
   `offsetParent` is null for anything hidden by a parent, which is how the
   multiplayer screens hide half their widgets (.mpHidden). */
function stops(screen) {
  return [...screen.querySelectorAll('button, select')]
    .filter((el) => !el.disabled && !el.classList.contains('step') && el.offsetParent !== null);
}

function move(dir) {
  const screen = activeScreen();
  if (!screen) return;
  const list = stops(screen);
  if (!list.length) return;
  const i = list.indexOf(document.activeElement);
  const next = list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length];
  next.focus();
  next.scrollIntoView({ block: 'nearest' });
}

/* ← → on an option row press its own steppers, so one implementation covers
   every setting; on anything else they do nothing and fall through */
function sideStep(dir) {
  const el = document.activeElement;
  const row = el && el.closest && el.closest('.opt');
  if (!row) return false;
  const steps = row.querySelectorAll('.step');
  if (steps.length !== 2) return false;
  steps[dir > 0 ? 1 : 0].click();
  return true;
}

document.addEventListener('keydown', (e) => {
  if (!activeScreen()) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return; // typing / native dropdown
  if (e.code === 'ArrowDown') { move(1); e.preventDefault(); }
  else if (e.code === 'ArrowUp') { move(-1); e.preventDefault(); }
  else if (e.code === 'ArrowRight') { if (sideStep(1)) e.preventDefault(); }
  else if (e.code === 'ArrowLeft') { if (sideStep(-1)) e.preventDefault(); }
});

/* Opening a screen puts the highlight on its first row, so the keyboard works
   without a click first. Inputs are skipped on purpose: focusing one pops the
   on-screen keyboard on a phone. */
export function focusFirst(screen) {
  const list = stops(screen);
  if (list.length) list[0].focus({ preventScroll: true });
}

/* every path that shows a screen goes through a class change, so one observer
   catches the lot (flow.js, lobby.js, editor.js) instead of each calling in */
new MutationObserver((recs) => {
  for (const r of recs) {
    const el = r.target;
    if (el.classList.contains('screen') && !el.classList.contains('hidden')) focusFirst(el);
  }
}).observe(overlay, { attributes: true, attributeFilter: ['class'], subtree: true });
