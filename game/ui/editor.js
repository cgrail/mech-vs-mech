import { levels, levelMeta, validateLevel, userLevels, USER_LEVELS_KEY, rememberLevel } from '../world/world.js';
import { switchMap, isSwitchingMap } from '../core/mapswitch.js';

/* ============================================================
   Map editor — paint a level, play it, export it

   The level file format is the editor's document model: one
   character per tile, exactly what levels/levels.txt holds
   (see world.js). Maps made here are kept in localStorage and
   appended to `levels` at boot, so they show up in the level
   select and can be played like any other map — but they are
   single player only, because the multiplayer server serves its
   own bundle. COPY TEXT is the way out: paste the block into
   levels/levels.txt (and copy that to iOS) to make a map real.
============================================================ */

const TILES = [
  { ch: 'g', label: 'GROUND', color: '#6e6c5c' },
  { ch: 'l', label: 'LOW', color: '#3f3d33' },
  { ch: 'h', label: 'HIGH', color: '#a8a48d' },
  { ch: 'w', label: 'WALL', color: '#4d5a66' },
  { ch: 'r', label: 'RAMP', color: '#8a7f5e' },
  { ch: 'v', label: 'CHASM', color: '#05060a' },   // no floor: walkers fall out of the world
  { ch: 'P', label: 'PLAYER', color: '#7CFF6B', unique: true },
  { ch: 'B', label: 'BLUE BASE', color: '#4d8dff', unique: true },
  { ch: 'R', label: 'RED BASE', color: '#ff5040', unique: true },
  { ch: 'T', label: 'RED TURRET', color: '#ffb060' },
  { ch: 'S', label: 'ENEMY SPAWN', color: '#ff9a5a' },
];
const TILE_BY_CH = Object.fromEntries(TILES.map((t) => [t.ch, t]));

const MIN_SIZE = 10;
const MAX_SIZE = 64;   // 64 x 64 tiles is a 512 x 512 unit district

const screen = document.getElementById('editScreen');
const modeScreen = document.getElementById('modeScreen');
const menuScreen = document.getElementById('menuScreen');
const overlay = document.getElementById('overlay');
const paletteEl = document.getElementById('edPalette');
const canvas = document.getElementById('edCanvas');
const ctx = canvas.getContext('2d');
const nameEl = document.getElementById('edName');
const descEl = document.getElementById('edDesc');
const wEl = document.getElementById('edW');
const hEl = document.getElementById('edH');
const loadEl = document.getElementById('edLoad');
const msgEl = document.getElementById('edMsg');

let grid = [];        // [row][col] of level-file characters
let tool = 'w';
let painting = false;
let loadedUserName = null;   // the user map being edited, if any

/* ---------- document ---------- */

function blankMap(cols, rows) {
  const g = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) ? 'w' : 'g'));
  const mid = Math.floor(cols / 2);
  g[1][mid] = 'R';                 // enemy end is the first row
  g[2][mid - 2] = 'S';
  g[2][mid + 2] = 'S';
  g[rows - 2][mid] = 'B';
  g[rows - 3][mid] = 'P';
  return g;
}

function sizeOf() { return { cols: grid[0]?.length || 0, rows: grid.length }; }

function toText() {
  const title = (nameEl.value.trim() || 'CUSTOM MAP').toUpperCase().slice(0, 20);
  const desc = descEl.value.trim() || 'made in the map editor';
  return `# ${title} — ${desc}\n${grid.map((r) => r.join('')).join('\n')}\n`;
}

/* level names travel in URLs and in a levels/<name>.txt fetch — same charset
   the server allows, and never one the bundle already uses */
function levelNameOf() {
  const base = (nameEl.value.trim() || 'custom').toLowerCase().replace(/[^\w-]+/g, '-').slice(0, 24);
  return base.replace(/^-+|-+$/g, '') || 'custom';
}

function setMessage(text, bad) {
  msgEl.textContent = text || '';
  msgEl.classList.toggle('bad', !!bad);
}

/* ---------- painting ---------- */

function draw() {
  const { cols, rows } = sizeOf();
  if (!cols || !rows) return;
  // fit the grid into the canvas box, square cells, crisp on HiDPI
  const box = canvas.parentElement.getBoundingClientRect();
  const cell = Math.max(4, Math.floor(Math.min(box.width / cols, box.height / rows)));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cell * cols, h = cell * rows;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(7, Math.floor(cell * 0.62))}px Verdana, sans-serif`;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = TILE_BY_CH[grid[r][c]] || TILE_BY_CH.g;
      ctx.fillStyle = t.color;
      ctx.fillRect(c * cell, r * cell, cell, cell);
      if (t.ch === t.ch.toUpperCase()) { // markers carry their letter
        ctx.fillStyle = '#101018';
        ctx.fillText(t.ch, c * cell + cell / 2, r * cell + cell / 2 + 1);
      }
    }
  }
  ctx.strokeStyle = 'rgba(10,10,18,.35)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath(); ctx.moveTo(c * cell + 0.5, 0); ctx.lineTo(c * cell + 0.5, h); ctx.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * cell + 0.5); ctx.lineTo(w, r * cell + 0.5); ctx.stroke();
  }
}

function cellAtEvent(ev) {
  const rect = canvas.getBoundingClientRect();
  const { cols, rows } = sizeOf();
  const c = Math.floor((ev.clientX - rect.left) / rect.width * cols);
  const r = Math.floor((ev.clientY - rect.top) / rect.height * rows);
  return (c >= 0 && r >= 0 && c < cols && r < rows) ? { c, r } : null;
}

function paint(ev, ch) {
  const at = cellAtEvent(ev);
  if (!at) return;
  if (grid[at.r][at.c] === ch) return;
  if (TILE_BY_CH[ch]?.unique) {
    // one player spawn, one base per side: placing it moves it
    const { cols, rows } = sizeOf();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) if (grid[r][c] === ch) grid[r][c] = 'g';
    }
  }
  grid[at.r][at.c] = ch;
  draw();
  setMessage('');
}

canvas.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  painting = true;
  paint(ev, ev.button === 2 ? 'g' : tool); // right button erases back to ground
});
canvas.addEventListener('pointermove', (ev) => {
  if (!painting) return;
  paint(ev, (ev.buttons & 2) ? 'g' : tool);
});
for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
  canvas.addEventListener(type, () => { painting = false; });
}
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

/* ---------- palette + size ---------- */

for (const t of TILES) {
  const b = document.createElement('button');
  b.dataset.tile = t.ch;
  const sw = document.createElement('span');
  sw.className = 'edSwatch';
  sw.style.background = t.color;
  b.append(sw, document.createTextNode(t.label));
  b.addEventListener('click', () => {
    tool = t.ch;
    reflectTool();
    b.blur();
  });
  paletteEl.appendChild(b);
}

function reflectTool() {
  for (const b of paletteEl.children) b.classList.toggle('selected', b.dataset.tile === tool);
}

function resize(dCols, dRows) {
  const { cols, rows } = sizeOf();
  const nc = Math.max(MIN_SIZE, Math.min(MAX_SIZE, cols + dCols));
  const nr = Math.max(MIN_SIZE, Math.min(MAX_SIZE, rows + dRows));
  if (nc === cols && nr === rows) return;
  // grow with wall border, shrink by dropping the far edge — then make sure
  // the outer ring is still wall, so a map can't leak off its own edge
  const next = Array.from({ length: nr }, (_, r) =>
    Array.from({ length: nc }, (_, c) => (grid[r] && grid[r][c]) || 'g'));
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      if (r === 0 || c === 0 || r === nr - 1 || c === nc - 1) next[r][c] = 'w';
    }
  }
  grid = next;
  reflectSize();
  draw();
}

function reflectSize() {
  const { cols, rows } = sizeOf();
  wEl.textContent = cols;
  hEl.textContent = rows;
}

for (const b of document.querySelectorAll('#edSize button')) {
  b.addEventListener('click', () => {
    const [axis, sign] = [b.dataset.size[0], b.dataset.size[1] === '+' ? 1 : -1];
    resize(axis === 'w' ? sign : 0, axis === 'h' ? sign : 0);
    b.blur();
  });
}

/* ---------- load / save ---------- */

function rebuildLoadList() {
  loadEl.textContent = '';
  const head = document.createElement('option');
  head.value = '';
  head.textContent = 'START FROM…';
  loadEl.appendChild(head);
  for (const [i, l] of levels.entries()) {
    const opt = document.createElement('option');
    opt.value = l.name;
    opt.textContent = `${l.user ? '★ ' : `${i + 1} · `}${levelMeta(l).title}`;
    loadEl.appendChild(opt);
  }
}

function loadLevel(name) {
  const entry = levels.find((l) => l.name === name);
  if (!entry) return;
  const rows = entry.text.split('\n').map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l && !l.startsWith('#'));
  const cols = Math.max(...rows.map((l) => l.length));
  grid = rows.map((l) => l.padEnd(cols, 'g').split(''));
  const { title, desc } = levelMeta(entry);
  loadedUserName = entry.user ? entry.name : null;
  nameEl.value = entry.user ? title : `${title} COPY`;
  descEl.value = desc;
  reflectSize();
  reflectDelete();
  draw();
  setMessage(entry.user ? 'LOADED YOUR MAP' : 'LOADED A COPY — SAVING KEEPS THE BUNDLE MAP UNTOUCHED');
}

loadEl.addEventListener('change', () => {
  if (loadEl.value) loadLevel(loadEl.value);
  loadEl.value = '';
});

/* validate, then write into localStorage and into the live `levels` array —
   the level select, ?level=<name> and the next-level flow all read that */
function save() {
  const name = levelNameOf();
  const text = toText();
  try {
    validateLevel(text, name);
  } catch (err) {
    setMessage(String(err.message || err), true);
    return null;
  }
  const bundled = levels.find((l) => l.name === name && !l.user);
  if (bundled) {
    setMessage(`"${name}" IS A BUILT-IN MAP — PICK ANOTHER NAME`, true);
    return null;
  }
  const store = userLevels().filter((l) => l.name !== name && l.name !== loadedUserName);
  store.push({ name, text });
  try {
    localStorage.setItem(USER_LEVELS_KEY, JSON.stringify(store));
  } catch {
    setMessage('COULD NOT SAVE — BROWSER STORAGE IS FULL', true);
    return null;
  }
  // mirror the change into the running game's level list
  if (loadedUserName && loadedUserName !== name) {
    const old = levels.findIndex((l) => l.name === loadedUserName && l.user);
    if (old >= 0) levels.splice(old, 1);
  }
  const at = levels.findIndex((l) => l.name === name);
  if (at >= 0) levels[at] = { name, text, user: true };
  else levels.push({ name, text, user: true });
  loadedUserName = name;
  rebuildLoadList();
  reflectDelete();
  levelsChanged();
  setMessage(`SAVED — "${name}" IS IN THE LEVEL LIST`);
  return name;
}

/* the level select (flow.js) rebuilds its list from `levels` on this */
function levelsChanged() {
  window.dispatchEvent(new CustomEvent('mech:levelchanged'));
}

function reflectDelete() {
  document.getElementById('edDelete').disabled = !loadedUserName;
}

document.getElementById('edSave').addEventListener('click', save);

document.getElementById('edCopy').addEventListener('click', async () => {
  const text = `=== ${levelNameOf()}\n${toText()}`;
  try {
    await navigator.clipboard.writeText(text);
    setMessage('COPIED — PASTE IT AT THE END OF levels/levels.txt');
  } catch {
    setMessage('CLIPBOARD BLOCKED — THE MAP TEXT IS IN THE CONSOLE INSTEAD', true);
    console.log(text);
  }
});

document.getElementById('edDelete').addEventListener('click', () => {
  if (!loadedUserName) return;
  const name = loadedUserName;
  localStorage.setItem(USER_LEVELS_KEY, JSON.stringify(userLevels().filter((l) => l.name !== name)));
  const at = levels.findIndex((l) => l.name === name && l.user);
  if (at >= 0) levels.splice(at, 1);
  loadedUserName = null;
  rebuildLoadList();
  reflectDelete();
  levelsChanged();
  setMessage(`DELETED "${name}"`);
});

/* PLAY: save, then fly the map in behind the mission menu, ready to deploy */
document.getElementById('edPlay').addEventListener('click', () => {
  if (isSwitchingMap()) return;
  const name = save();
  if (!name) return;
  showEditor(false);
  menuScreen.classList.remove('hidden');
  modeScreen.classList.add('hidden');
  overlay.classList.add('hidden');
  switchMap(name, () => {
    overlay.classList.remove('hidden');
    rememberLevel(name); // like any level pick: browser state, not a URL parameter
    levelsChanged(); // flow.js re-marks the list on the map it landed on
  });
});

/* ---------- screen ---------- */

export function showEditor(open) {
  screen.classList.toggle('hidden', !open);
  modeScreen.classList.toggle('hidden', open);
  overlay.classList.toggle('level', open); // lighter dimming, no game title
  if (!open) return;
  if (!grid.length) {
    grid = blankMap(20, 24);
    reflectSize();
    reflectDelete();
    setMessage('PAINT WITH THE LEFT BUTTON · RIGHT BUTTON CLEARS BACK TO GROUND');
  }
  rebuildLoadList();
  reflectTool();
  draw();
}

document.getElementById('edBtn').addEventListener('click', () => showEditor(true));
document.getElementById('edBack').addEventListener('click', () => showEditor(false));
window.addEventListener('resize', () => { if (!screen.classList.contains('hidden')) draw(); });
