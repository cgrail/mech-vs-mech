/* ============================================================
   Map thumbnails — the picture on every map card

   The game ships no artwork for its 60-odd districts, so a map's
   picture is drawn from the level text itself: one pixel per 8×8
   tile, scaled up blocky (`image-rendering: pixelated` in
   style.css). That is enough to recognise a map by — the forts at
   either end, the chasms, the plateaus, where the spawns sit.

   Same palette as the iOS port's MapThumbs (UI/LobbyStyles.swift),
   so a room's map looks the same on a phone and in a browser.
   Cached per level text as a data URL: the level select builds
   60 of these at once, and rebuilds them whenever the map editor
   changes the list.
============================================================ */

/* terrain tiers run blue-grey light to dark, walls read as pale structure,
   ramps warm — the one thing you look for on a map. `v` chasms are left
   transparent, so a hole in the map reads as one against the dark backing. */
const TERRAIN = { l: '#1e2740', g: '#33405c', h: '#4a5d80', r: '#7a6540', w: '#8b93ab' };
const MARKERS = { P: '#6fe3ff', B: '#3d7bff', R: '#ff4a3d', T: '#ff9a3a', S: '#c06ad8' };

const cache = new Map(); // level text → data URL

function render(text) {
  const rows = text.split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!rows.length) return null;
  const cols = Math.max(...rows.map((r) => r.length));
  if (!cols) return null;

  const c = document.createElement('canvas');
  c.width = cols;
  c.height = rows.length;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = MARKERS[row[x]] || TERRAIN[row[x]];
      if (!col) continue; // a chasm, or a character this build doesn't know
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c.toDataURL();
}

/* an <img> of the map, or null when there is no text to draw (a room on a map
   this page's bundle doesn't have — the caller shows a placeholder) */
export function mapThumb(text, cls = 'thumb') {
  if (!text) return null;
  let url = cache.get(text);
  if (url === undefined) {
    url = render(text);
    cache.set(text, url);
  }
  if (!url) return null;
  const img = document.createElement('img');
  img.className = cls;
  img.src = url;
  img.alt = '';
  return img;
}

/* the thumbnail, or a dim placeholder tile of the same size */
export function thumbBox(text, cls = 'thumbBox') {
  const box = document.createElement('span');
  box.className = cls;
  const img = mapThumb(text);
  if (img) box.appendChild(img);
  else box.classList.add('empty');
  return box;
}
