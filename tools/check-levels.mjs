/* Off-line level checker: mirrors world.js parsing + the walkability rules
   (STEP climbs, free drops, JUMP_REACH ledge jumps) so a map can be checked
   for unreachable regions and one-way pits without opening a browser — the
   two traps CLAUDE.md warns about are both invisible when read by eye.

   usage: npm run check-levels                     (the whole bundle)
          node tools/check-levels.mjs levels/levels.txt level57 level58   */
import { readFileSync } from 'node:fs';

const TILE = 8, WALL_H = 10, STEP = 0.75, JUMP_REACH = 4.5;
const TIER = { l: -4, g: 0, h: 4 };
const SUB = 8;                         // samples per tile edge (1 unit apart)

function parse(text, name) {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l && !l.startsWith('#'));
  const errs = [];
  if (!lines.length) return { errs: [`${name}: empty`] };
  const cols = Math.max(...lines.map((l) => l.length));
  lines.forEach((l, r) => {
    if (l.length !== cols) errs.push(`${name}: row ${r + 1} is ${l.length} wide, widest is ${cols}`);
    for (const ch of l) if (!'glhwrPBRTS'.includes(ch)) errs.push(`${name}: bad tile "${ch}" in row ${r + 1}`);
  });
  for (const ch of 'PBRS') if (!lines.some((l) => l.includes(ch))) errs.push(`${name}: no "${ch}" marker`);
  const rows = lines.length;
  const chars = lines.map((l) => l.split(''));
  const markers = { P: [], B: [], R: [], T: [], S: [] };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = chars[r][c];
      if (!'PBRTS'.includes(ch)) continue;
      markers[ch].push({ r, c });
      const left = chars[r][c - 1], right = chars[r][c + 1];
      chars[r][c] = left in TIER ? left : right in TIER ? right : 'g';
    }
  }
  const cells = chars.map((row) => row.map((ch) => (
    ch === 'w' ? { t: 'wall', h: WALL_H }
      : ch === 'r' ? { t: 'ramp', axis: 'x', h0: 0, h1: 0 }
        : { t: 'flat', h: TIER[ch] ?? 0 })));
  const flatH = (r, c) => (cells[r] && cells[r][c] && cells[r][c].t === 'flat' ? cells[r][c].h : null);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[r][c];
      if (cell.t !== 'ramp') continue;
      const L = flatH(r, c - 1), R = flatH(r, c + 1), U = flatH(r - 1, c), D = flatH(r + 1, c);
      const dx = L !== null && R !== null ? Math.abs(L - R) : -1;
      const dz = U !== null && D !== null ? Math.abs(U - D) : -1;
      if (dx >= dz && dx > 0) { cell.axis = 'x'; cell.h0 = L; cell.h1 = R; }
      else if (dz > 0) { cell.axis = 'z'; cell.h0 = U; cell.h1 = D; }
      else cells[r][c] = { t: 'flat', h: L ?? R ?? U ?? D ?? 0 };
    }
  }
  return { errs, rows, cols, cells, markers, chars };
}

/* height field sampled SUB times per tile; walls are holes, not surfaces */
function field(lv) {
  const W = lv.cols * SUB, H = lv.rows * SUB;
  const h = new Float32Array(W * H);
  const solid = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = lv.cells[Math.floor(y / SUB)][Math.floor(x / SUB)];
      if (cell.t === 'wall') { solid[y * W + x] = 1; h[y * W + x] = WALL_H; continue; }
      if (cell.t === 'ramp') {
        const f = (cell.axis === 'x' ? x % SUB : y % SUB) / SUB;
        h[y * W + x] = cell.h0 + (cell.h1 - cell.h0) * f;
      } else h[y * W + x] = cell.h;
    }
  }
  return { W, H, h, solid };
}

/* flood fill over sample points. climb <= limit up, any drop down */
function reach(f, seeds, limit, reverse = false) {
  const { W, H, h, solid } = f;
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (const s of seeds) if (!solid[s] && !seen[s]) { seen[s] = 1; stack.push(s); }
  const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i - x) / W;
    for (const [dx, dy] of D) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (seen[j] || solid[j]) continue;
      // forward: can we step from i to j?  reverse: from j to i?
      const rise = reverse ? h[i] - h[j] : h[j] - h[i];
      if (rise > limit) continue;
      seen[j] = 1; stack.push(j);
    }
  }
  return seen;
}

const idxOf = (f, m) => (m.r * SUB + SUB / 2) * f.W + m.c * SUB + SUB / 2;

function check(name, text) {
  const lv = parse(text, name);
  const out = [...(lv.errs || [])];
  if (!lv.cells) return out;
  const f = field(lv);
  const spawn = [lv.markers.P[0], ...lv.markers.S].filter(Boolean);
  const keyPts = [
    ...lv.markers.P.map((m) => ['P', m]), ...lv.markers.B.map((m) => ['B', m]),
    ...lv.markers.R.map((m) => ['R', m]), ...lv.markers.S.map((m, i) => [`S${i + 1}`, m]),
    ...lv.markers.T.map((m, i) => [`T${i + 1}`, m]),
  ];
  for (const [tag, m] of keyPts) {
    if (lv.cells[m.r][m.c].t === 'wall') out.push(`${name}: marker ${tag} at row ${m.r + 1} col ${m.c + 1} sits in a wall`);
  }
  // every marker must be mutually reachable with jump-assisted walking
  const seeds = spawn.map((m) => idxOf(f, m));
  const fwd = reach(f, [seeds[0]], JUMP_REACH);
  for (const [tag, m] of keyPts) {
    if (!fwd[idxOf(f, m)]) out.push(`${name}: ${tag} (row ${m.r + 1} col ${m.c + 1}) is unreachable from the player spawn`);
  }
  // one-way pits: anywhere you can walk into but not walk back out of
  const back = reach(f, [seeds[0]], JUMP_REACH, true);
  let trapped = 0, sample = null;
  for (let i = 0; i < fwd.length; i++) {
    if (fwd[i] && !back[i]) {
      trapped++;
      if (!sample) sample = i;
    }
  }
  if (trapped) {
    const x = sample % f.W, y = (sample - x) / f.W;
    out.push(`${name}: ${trapped} sample points are one-way traps (e.g. row ${Math.floor(y / SUB) + 1} col ${Math.floor(x / SUB) + 1})`);
  }
  return out;
}

const file = process.argv[2] || 'levels/levels.txt';
const only = process.argv.slice(3);
const bundle = readFileSync(file, 'utf8');
const parts = bundle.split(/^=== /m).slice(1);
let bad = 0;
for (const part of parts) {
  const nl = part.indexOf('\n');
  const name = part.slice(0, nl).trim();
  if (only.length && !only.includes(name)) continue;
  const msgs = check(name, part.slice(nl + 1));
  if (msgs.length) { bad++; for (const m of msgs) console.log('  ✗ ' + m); }
  else console.log(`  ✓ ${name}`);
}
console.log(bad ? `\n${bad} level(s) with findings` : '\nall clear');
