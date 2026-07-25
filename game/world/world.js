import * as THREE from 'three';

/* ============================================================
   Level loading + terrain

   All levels live in one bundle, levels/levels.txt — a
   "=== <name>" line starts a level, file order is play order.
   Within a level, one character per 8x8 tile:
     g ground · l low ground · h high ground · w wall
     r ramp (slopes between the differing tiles next to it)
   Markers (terrain under them is inherited from the tile to
   their left):
     P player spawn · B blue base · R red base
     T red turret   · S enemy wave spawn point
   Pick a level with ?level=2 or ?level=name; a name not in the
   bundle falls back to levels/<name>.txt (handy for drafts)
============================================================ */
export const TILE = 8;
export const LOW = -4;            // floor of the lowest tier
export const WALL_H = 10;         // absolute top of wall tiles
export const STEP = 0.75;         // tallest ledge a mech can step up while walking

const TIER = { l: -4, g: 0, h: 4 };

export const ARENA = { hw: 0, hd: 0 };   // half width (x), half depth (z)
export const LEVEL = {
  rows: 0, cols: 0,
  playerSpawn: { x: 0, z: 0 },
  blueBase: { x: 0, z: 0 },
  redBase: { x: 0, z: 0 },
  redTurrets: [],
  enemySpawns: [],
};

let cells = [];  // [row][col] -> {t:'flat'|'wall', h} | {t:'ramp', axis, h0, h1}

const NEEDED = {
  P: 'a "P" player-spawn marker',
  B: 'a "B" blue-base marker',
  R: 'an "R" red-base marker',
  S: 'an "S" enemy-spawn marker',
};

/* Every check parseLevel makes, before it touches any global state. Returns
   the level's terrain rows (comments and blank lines dropped). The map editor
   (ui/editor.js) validates drafts with this, so a broken draft is reported
   the same way a broken bundle entry is — and never half-loaded. */
export function validateLevel(text, name) {
  const lines = String(text).split('\n').map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l && !l.startsWith('#'));
  const rows = lines.length;
  if (!rows) throw new Error(`Level "${name}" is empty — it has no terrain rows`);
  const cols = Math.max(...lines.map((l) => l.length));
  for (let r = 0; r < rows; r++) {
    if (lines[r].length !== cols) {
      throw new Error(`Level "${name}": terrain row ${r + 1} is ${lines[r].length} tiles wide but the widest row is ${cols} — all rows must be equal length`);
    }
    for (let c = 0; c < cols; c++) {
      if (!'glhwrPBRTS'.includes(lines[r][c])) {
        throw new Error(`Level "${name}": unknown tile character "${lines[r][c]}" at row ${r + 1}, column ${c + 1} — valid tiles are g l h w r and markers P B R T S`);
      }
    }
  }
  for (const ch in NEEDED) {
    if (!lines.some((l) => l.includes(ch))) {
      throw new Error(`Level "${name}" has no ${NEEDED[ch]} — every level needs one`);
    }
  }
  return lines;
}

function parseLevel(text, name) {
  const lines = validateLevel(text, name);
  const rows = lines.length;
  const cols = lines[0].length;
  LEVEL.rows = rows; LEVEL.cols = cols;
  // markers accumulate — a rebuild (rebuildWorld) must not keep the old map's
  LEVEL.redTurrets.length = 0;
  LEVEL.enemySpawns.length = 0;
  ARENA.hw = cols * TILE / 2;
  ARENA.hd = rows * TILE / 2;

  const cx = (c) => -ARENA.hw + (c + 0.5) * TILE;
  const cz = (r) => -ARENA.hd + (r + 0.5) * TILE;

  // pull out markers; the tile itself becomes plain terrain
  const chars = lines.map((l) => l.split(''));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = chars[r][c];
      if (!'PBRTS'.includes(ch)) continue;
      const p = { x: cx(c), z: cz(r) };
      if (ch === 'P') LEVEL.playerSpawn = p;
      else if (ch === 'B') LEVEL.blueBase = p;
      else if (ch === 'R') LEVEL.redBase = p;
      else if (ch === 'T') LEVEL.redTurrets.push(p);
      else LEVEL.enemySpawns.push(p);
      const left = chars[r][c - 1], right = chars[r][c + 1];
      chars[r][c] = left in TIER ? left : right in TIER ? right : 'g';
    }
  }
  cells = chars.map((row) => row.map((ch) => {
    if (ch === 'w') return { t: 'wall', h: WALL_H };
    if (ch === 'r') return { t: 'ramp', axis: 'x', h0: 0, h1: 0 };
    return { t: 'flat', h: TIER[ch] ?? 0 };
  }));

  // ramps slope between their flat neighbours — the steepest axis wins
  const flatH = (r, c) => {
    const cell = cells[r] && cells[r][c];
    return cell && cell.t === 'flat' ? cell.h : null;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[r][c];
      if (cell.t !== 'ramp') continue;
      const L = flatH(r, c - 1), R = flatH(r, c + 1);
      const U = flatH(r - 1, c), D = flatH(r + 1, c);
      const dx = L !== null && R !== null ? Math.abs(L - R) : -1;
      const dz = U !== null && D !== null ? Math.abs(U - D) : -1;
      if (dx >= dz && dx > 0) { cell.axis = 'x'; cell.h0 = L; cell.h1 = R; }
      else if (dz > 0) { cell.axis = 'z'; cell.h0 = U; cell.h1 = D; }
      else cells[r][c] = { t: 'flat', h: L ?? R ?? U ?? D ?? 0 };
    }
  }
}

/* ============================================================
   Terrain queries
============================================================ */
function cellAt(x, z) {
  const c = Math.floor((x + ARENA.hw) / TILE);
  const r = Math.floor((z + ARENA.hd) / TILE);
  if (r < 0 || r >= LEVEL.rows || c < 0 || c >= LEVEL.cols) return null;
  return cells[r][c];
}

/* walking-surface height at a world position (walls count as their top) */
export function groundHeightAt(x, z) {
  const cell = cellAt(x, z);
  if (!cell || cell.t === 'wall') return WALL_H;
  if (cell.t === 'ramp') {
    const f = cell.axis === 'x'
      ? (x + ARENA.hw) / TILE - Math.floor((x + ARENA.hw) / TILE)
      : (z + ARENA.hd) / TILE - Math.floor((z + ARENA.hd) / TILE);
    return cell.h0 + (cell.h1 - cell.h0) * f;
  }
  return cell.h;
}

/* push a circle standing at height y out of tiles too tall to step onto */
export function collideTerrain(pos, r, y) {
  const c0 = Math.floor((pos.x - r + ARENA.hw) / TILE), c1 = Math.floor((pos.x + r + ARENA.hw) / TILE);
  const r0 = Math.floor((pos.z - r + ARENA.hd) / TILE), r1 = Math.floor((pos.z + r + ARENA.hd) / TILE);
  for (let tr = r0; tr <= r1; tr++) {
    for (let tc = c0; tc <= c1; tc++) {
      const cell = (cells[tr] || [])[tc];
      const h = !cell || cell.t === 'wall' ? WALL_H
        : cell.t === 'ramp' ? Math.min(cell.h0, cell.h1) : cell.h;
      if (h <= y + STEP) continue;
      const ox = -ARENA.hw + (tc + 0.5) * TILE, oz = -ARENA.hd + (tr + 0.5) * TILE;
      const nx = Math.max(ox - TILE / 2, Math.min(pos.x, ox + TILE / 2));
      const nz = Math.max(oz - TILE / 2, Math.min(pos.z, oz + TILE / 2));
      const dx = pos.x - nx, dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 < 1e-6) { // center inside: push along smallest axis
        const px = TILE / 2 - Math.abs(pos.x - ox);
        const pz = TILE / 2 - Math.abs(pos.z - oz);
        if (px < pz) pos.x += (pos.x >= ox ? 1 : -1) * (px + r);
        else pos.z += (pos.z >= oz ? 1 : -1) * (pz + r);
      } else {
        // measure the step right at the contact edge, so a walker part-way
        // up a ramp isn't blocked by the level the ramp leads onto
        const d = Math.sqrt(d2);
        const hEdge = groundHeightAt(nx + dx / d * 0.5, nz + dz / d * 0.5);
        if (h <= Math.max(y, hEdge) + STEP) continue;
        pos.x += dx / d * (r - d);
        pos.z += dz / d * (r - d);
      }
    }
  }
}

/* static terrain layer for the minimap */
export function drawTerrainMinimap(g, w, h) {
  for (let r = 0; r < LEVEL.rows; r++) {
    for (let c = 0; c < LEVEL.cols; c++) {
      const cell = cells[r][c];
      if (cell.t === 'wall') {
        g.fillStyle = '#525f78';
      } else {
        const hh = cell.t === 'ramp' ? (cell.h0 + cell.h1) / 2 : cell.h;
        g.fillStyle = `hsl(215, 14%, ${22 + (hh - LOW) * 3}%)`;
      }
      g.fillRect(c / LEVEL.cols * w, r / LEVEL.rows * h, w / LEVEL.cols + 0.5, h / LEVEL.rows + 0.5);
    }
  }
}

/* ============================================================
   World meshes
============================================================ */
function makeGroundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#6e6c5c';
  g.fillRect(0, 0, 512, 512);
  const tile = 128;
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const l = 96 + Math.floor(Math.random() * 40);
      g.fillStyle = `rgb(${l + 12},${l + 8},${l - 10})`;
      g.fillRect(tx * tile + 2, ty * tile + 2, tile - 4, tile - 4);
      g.strokeStyle = 'rgba(30,28,20,0.55)';
      g.lineWidth = 3;
      g.strokeRect(tx * tile + 2, ty * tile + 2, tile - 4, tile - 4);
      // grime blotches
      for (let i = 0; i < 5; i++) {
        g.fillStyle = `rgba(40,38,25,${Math.random() * 0.18})`;
        g.beginPath();
        g.arc(tx * tile + Math.random() * tile, ty * tile + Math.random() * tile, 6 + Math.random() * 20, 0, 7);
        g.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const TEX_SCALE = 20; // world units per texture repeat

/* merge same-height tile runs into as few boxes as possible */
function greedyRects(match) {
  const used = Array.from({ length: LEVEL.rows }, () => new Array(LEVEL.cols).fill(false));
  const rects = [];
  for (let r = 0; r < LEVEL.rows; r++) {
    for (let c = 0; c < LEVEL.cols; c++) {
      if (used[r][c] || !match(cells[r][c])) continue;
      let w = 1;
      while (c + w < LEVEL.cols && !used[r][c + w] && match(cells[r][c + w])) w++;
      let d = 1;
      outer: while (r + d < LEVEL.rows) {
        for (let i = 0; i < w; i++) if (used[r + d][c + i] || !match(cells[r + d][c + i])) break outer;
        d++;
      }
      for (let rr = r; rr < r + d; rr++) for (let i = 0; i < w; i++) used[rr][c + i] = true;
      rects.push({ r, c, w, d });
    }
  }
  return rects;
}

/* every terrain mesh hangs off one group, so a rebuild is a swap
   (see rebuildWorld — the lobby previews other maps that way) */
let terrainGroup = null;

export function createWorld(parent) {
  if (terrainGroup) {
    parent.remove(terrainGroup);
    const dead = new Set();   // materials are shared between meshes
    terrainGroup.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const m of [o.material].flat()) dead.add(m);
    });
    for (const m of dead) { m.map?.dispose(); m.dispose(); }
  }
  const group = terrainGroup = new THREE.Group();
  parent.add(group);

  const groundTex = makeGroundTexture();
  const topMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x5b5648, roughness: 0.9 });
  const rampMat = new THREE.MeshStandardMaterial({ color: 0x6b6555, roughness: 0.9 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x4d5a66, roughness: 0.9 });

  // base plane at the lowest tier
  const pw = LEVEL.cols * TILE + 40, pd = LEVEL.rows * TILE + 40;
  const planeTex = groundTex.clone();
  planeTex.repeat.set(pw / TEX_SCALE, pd / TEX_SCALE);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(pw, pd),
    new THREE.MeshStandardMaterial({ map: planeTex, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = LOW;
  ground.receiveShadow = true;
  group.add(ground);

  function addBox(rect, top, mat) {
    const w = rect.w * TILE, d = rect.d * TILE, bottom = LOW - 2;
    const mx = -ARENA.hw + rect.c * TILE + w / 2;
    const mz = -ARENA.hd + rect.r * TILE + d / 2;
    const geo = new THREE.BoxGeometry(w, top - bottom, d);
    if (Array.isArray(mat)) {
      // world-aligned UVs on the +y face so the ground texture doesn't stretch
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 8; i < 12; i++) uv.setXY(i, (mx + pos.getX(i)) / TEX_SCALE, (mz + pos.getZ(i)) / TEX_SCALE);
    }
    const m = new THREE.Mesh(geo, mat);
    m.position.set(mx, (top + bottom) / 2, mz);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }

  // raised flat terrain, one merged box set per height tier
  const tierMats = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];
  const heights = [...new Set(cells.flat().filter((c) => c.t === 'flat' && c.h > LOW).map((c) => c.h))];
  for (const h of heights) {
    for (const rect of greedyRects((c) => c.t === 'flat' && c.h === h)) addBox(rect, h, tierMats);
  }
  for (const rect of greedyRects((c) => c.t === 'wall')) addBox(rect, WALL_H, wallMat);

  // ramps: boxes with the top face tilted into a wedge
  for (let r = 0; r < LEVEL.rows; r++) {
    for (let c = 0; c < LEVEL.cols; c++) {
      const cell = cells[r][c];
      if (cell.t !== 'ramp') continue;
      const geo = new THREE.BoxGeometry(TILE, 1, TILE);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > 0) {
          const f = (cell.axis === 'x' ? pos.getX(i) : pos.getZ(i)) / TILE + 0.5;
          pos.setY(i, cell.h0 + (cell.h1 - cell.h0) * f);
        } else {
          pos.setY(i, LOW - 2);
        }
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, rampMat);
      m.position.set(-ARENA.hw + (c + 0.5) * TILE, 0, -ARENA.hd + (r + 0.5) * TILE);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
  }
}

/* Swap in another map without reloading the page: re-parse into the same
   LEVEL / ARENA / grid every other module reads, then rebuild the terrain
   meshes. The entities are the caller's problem — they are standing on the
   old map's ground until it puts them back (core/mapswitch.js). */
export function rebuildWorld(parent, text, name) {
  parseLevel(text, name);
  createWorld(parent);
  levelName = name;
}

/* ============================================================
   Load the level before the rest of the game boots
   (top-level await: every module importing this one waits)
============================================================ */
const param = new URLSearchParams(location.search).get('level') || '1';
/* the map the world is currently built on. A `let`, because the level
   select and the lobby swap maps in place (see core/mapswitch.js) and
   ES module bindings are live — every importer follows it. */
export let levelName = /^\d+$/.test(param) ? `level${param}` : param;

/* one request fetches every level; the level-select menu (flow.js)
   reads titles from this list without any further HTTP calls */
export const levels = []; // [{ name, text }] in play order
{
  let res;
  try {
    res = await fetch('levels/levels.txt');
  } catch {
    throw new Error('Could not load levels/levels.txt — the request never reached the server');
  }
  if (!res.ok) throw new Error(`Could not load levels/levels.txt (HTTP ${res.status})`);
  let cur = null;
  for (const line of (await res.text()).split('\n')) {
    const m = line.match(/^===\s*(\S+)/);
    if (m) levels.push(cur = { name: m[1], text: '' });
    else if (cur) cur.text += line + '\n';
  }
  if (!levels.length) throw new Error('levels/levels.txt contains no levels — every level must start with a "=== <name>" line');
}

/* ---------- maps made in the in-game editor ----------
   They live in localStorage, not in the bundle, and are appended to `levels`
   so the level select, ?level=<name> and the next-level flow treat them like
   any other map. They stay single player: the lobby only offers maps the
   server can serve (ui/lobby.js filters `user` out), which is also what keeps
   a match from being staged on a map only one player has. */
export const USER_LEVELS_KEY = 'mechUserLevels';

export function userLevels() {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_LEVELS_KEY));
    return Array.isArray(raw)
      ? raw.filter((l) => l && typeof l.name === 'string' && typeof l.text === 'string')
      : [];
  } catch { return []; } // corrupted store: behave as if there were none
}

for (const l of userLevels()) {
  if (!levels.some((b) => b.name === l.name)) levels.push({ name: l.name, text: l.text, user: true });
}

/* numeric levels keep their short ?level=N form, named levels use the name */
export const levelParam = (name) => name.match(/^level(\d+)$/)?.[1] ?? name;

/* a level's menu entry — its first comment line, "# TITLE — description".
   Used by the level select (flow.js) and the lobby's map picker (lobby.js);
   the server parses the same line for its /levels list. */
export function levelMeta({ name, text }) {
  const first = text.split('\n').find((l) => l.startsWith('#')) || '';
  const m = first.match(/^#\s*(.+?)\s+—\s*(.*)/);
  return {
    title: m && m[1].length <= 20 ? m[1].toUpperCase() : name.toUpperCase(),
    desc: m ? m[2] : '',
  };
}

let levelText = levels.find((l) => l.name === levelName)?.text;
if (levelText === undefined) {
  // not in the bundle — try a standalone file, so a draft level can be
  // played with ?level=<name> before it's merged into levels.txt
  let res;
  try {
    res = await fetch(`levels/${encodeURIComponent(levelName)}.txt`);
  } catch {
    throw new Error(`Level "${levelName}" is not in levels/levels.txt, and fetching levels/${levelName}.txt failed`);
  }
  if (!res.ok) throw new Error(`Level "${levelName}" is not in levels/levels.txt and levels/${levelName}.txt does not exist (HTTP ${res.status})`);
  levelText = await res.text();
}
parseLevel(levelText, levelName);
