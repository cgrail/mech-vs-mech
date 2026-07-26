/* ============================================================
   Menu rows and keyboard navigation

   Every menu screen is one vertical column of rows that are all
   the same width and the same height — a 90s console option
   list rather than a page of wrapping pill rows. Two reasons
   beyond the look: a column grows *down* on a small screen
   instead of spilling sideways (#overlay scrolls, so taller is
   free and wider is not), and rows that are all one size read
   as a menu you walk through rather than a toolbar.

   An option row is LABEL · VALUE between ◂ ▸ steppers — three
   controls, never more. Multi-value settings cycle through the
   steppers instead of putting one button per value in a row,
   which is what used to overflow at four difficulties or five
   maps wide.

   Selection *is* DOM focus, so the keyboard, the mouse and
   touch can never disagree about what is highlighted: ↑ ↓ walk
   the visible screen, ← → change the focused option, Enter or
   Space activates it. Steppers are skipped by ↑ ↓ — they are
   what ← → drive — so a column of N options is N stops, not 3N.
============================================================ */
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
