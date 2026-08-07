/* ============================================================
   Camera views — over the shoulder, or from a bird's eye

   Two entries, one geometry each: where the camera rides
   relative to the mech, and the point ahead of it that it aims
   at. Nothing else describes a camera — main.js flies whatever
   is current (updateCamera), systems/input.js switches it on a
   key, systems/mobile.js on the HUD button, and systems/vision.js
   reads `fogShift` because the render fog is measured from the
   *camera*: pulling it up into the bird's eye would otherwise
   fog the district the mech is standing in.

   Which one is picked is remembered like every other setting —
   localStorage, never the address bar — and announced as
   `mech:viewchanged`, the same way a rebound key is, so anything
   that draws the view (the touch button's face) redraws itself.

   It is a camera, not a rule: the simulation never reads it, so
   both views are safe in PvP the way fog of war is, and both
   builds offer them (Engine/State.swift holds the same table).
============================================================ */

export const VIEWS = {
  chase: {
    id: 'chase', label: 'CHASE', short: 'CHASE', icon: '🎥',
    behind: 21, up: 26,      // where the camera sits, relative to the mech
    ahead: 17, lookY: 2,     // …and the point in front of it that it aims at
  },
  bird: {
    // straight down the mech's own axis, high enough that no sky is in
    // frame and about twice the district is: the tactical view. The mech
    // still sits a little below centre, so the ground it is walking into
    // gets the screen.
    id: 'bird', label: "BIRD'S EYE", short: 'BIRD', icon: '🚁',
    behind: 12, up: 58,
    ahead: 9, lookY: 0,
  },
};

const STORE = 'mechView';
const saved = localStorage.getItem(STORE);
let current = VIEWS[saved] ? saved : 'chase';

/* the view being flown right now, and the one the toggle would give */
export const camView = () => VIEWS[current];
export const nextView = () => (current === 'bird' ? VIEWS.chase : VIEWS.bird);

export function setView(name) {
  if (!VIEWS[name] || name === current) return;
  current = name;
  try { localStorage.setItem(STORE, name); } catch { /* private mode: this life only */ }
  window.dispatchEvent(new Event('mech:viewchanged'));
}

export const toggleView = () => setView(nextView().id);

/* How much further from the mech this camera sits than the chase camera does.
   The fog bands (systems/vision.js) are distances from the camera but describe
   what the *mech* can make out, so they travel with it. */
const camDist = (v) => Math.hypot(v.behind, v.up);
export const fogShift = () => camDist(camView()) - camDist(VIEWS.chase);
