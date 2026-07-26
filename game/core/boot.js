/* ============================================================
   Boot handoff — the game's state lives in the browser, never
   in the address bar

   Nothing here ever writes a URL parameter. The few things that
   still need a page reload (redeploy, next level, entering or
   leaving a multiplayer match) park what the next load has to
   know — which map, which screen to open on, the match
   credentials — in sessionStorage under `mechBoot`, and the
   inline script in index.html consumes it exactly once, before
   any module runs, onto window.__mechBoot.

   Consumed once is the whole point: a *manual* refresh finds
   nothing left and always starts from the entry screen.

   No imports on purpose, so even net.js (which has to stay
   cycle-free) can read the match credentials from here.
============================================================ */
export const BOOT_KEY = 'mechBoot';

/* what this page load was handed:
     screen  'menu' | 'match' | 'lobby' — which overlay screen to open on
     level   the map to build (param or name), else the remembered one
     match   multiplayer credentials (see net.js) */
export const BOOT = (typeof window !== 'undefined' && window.__mechBoot) || {};

/* reload the page with a handoff for the next load */
export function bootReload(next) {
  try { sessionStorage.setItem(BOOT_KEY, JSON.stringify(next)); }
  catch { /* private mode: the reload still works, it just starts at the entry */ }
  location.reload();
}
