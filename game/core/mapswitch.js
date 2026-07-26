import { scene } from '../world/scene.js';
import { levelName, levels, LEVEL, rebuildWorld, groundHeightAt } from '../world/world.js';
import { entities, blueBase, redBase, makeTurretEntity, removeEntity } from '../entities/entities.js';
import { player } from '../entities/player.js';
import { spawnPointFor } from './helpers.js';
import { game } from './state.js';
import { resetFlags } from '../systems/ctf.js';
import { MP } from '../net/net.js';

/* ============================================================
   Map switching — one path for the level select and the lobby

   Swapping maps happens in place, with no page reload: the old map
   sinks away, world.js re-parses the new level into the same LEVEL /
   ARENA / grid every module reads, the bases, marker turrets and the
   player mech are put back on the new ground, and the new map drops
   in from above. The fly animation used to be split across the level
   switch's page load; it is now one uninterrupted sequence, and the
   lobby's map preview is the very same call.

   Everything (terrain + entities) sits directly in the scene and the
   camera does not, so flying the whole level is just animating
   scene.position.y.

   Only safe from the menu — nothing here resets a game in progress.
   A finished match still returns to the menu through a reload, so the
   level select can only ever be reached with a fresh world.
============================================================ */
const FLY_DIST = 500;
const OUT_MS = 800;
const IN_MS = 1000;

let switching = false;
let queued = null;   // a map asked for mid-flight: the last one wins

export function isSwitchingMap() { return switching; }

function flyLevel(from, to, ease, ms) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    (function step() {
      const t = Math.min((performance.now() - t0) / ms, 1);
      scene.position.y = from + (to - from) * ease(t);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    })();
  });
}

/* put the entities back where the new map's markers want them */
function replaceEntities() {
  // the old map's marker turrets stood on terrain that no longer exists
  for (const e of [...entities]) if (e.kind === 'turret') removeEntity(e);
  for (const [base, at] of [[blueBase, LEVEL.blueBase], [redBase, LEVEL.redBase]]) {
    base.group.position.set(at.x, groundHeightAt(at.x, at.z), at.z);
  }
  if (!MP.active) for (const t of LEVEL.redTurrets) makeTurretEntity('red', t.x, t.z);
  resetFlags(); // capture-the-flag stands are derived from the new base markers

  const { pos, face } = spawnPointFor(player.team);
  player.y = groundHeightAt(pos.x, pos.z);
  player.vy = 0;
  player.group.position.set(pos.x, player.y, pos.z);
  player.yaw = Math.atan2(face.x - pos.x, face.z - pos.z);
}

/* `onRebuilt` fires between the two halves of the animation — the moment
   the new map exists but is still up in the air (the level select shows
   its overlay again there, the way the reload used to). */
export async function switchMap(name, onRebuilt) {
  if (game.state !== 'menu') return;   // never pull the map out of a live game
  if (switching) { queued = { name, onRebuilt }; return; }
  if (name === levelName) { onRebuilt?.(); return; }
  const entry = levels.find((l) => l.name === name);
  if (!entry) { onRebuilt?.(); return; } // not in this page's bundle: stay put

  switching = true;
  try {
    await flyLevel(0, -FLY_DIST, (t) => t * t * t, OUT_MS);
    rebuildWorld(scene, entry.text, entry.name); // also moves levelName on
    replaceEntities();
    onRebuilt?.();
    await flyLevel(FLY_DIST, 0, (t) => 1 - (1 - t) ** 3, IN_MS);
  } catch (err) {
    // a level this build can't parse: leave the world where it can be seen
    console.error(err);
    scene.position.y = 0;
    onRebuilt?.();
  } finally {
    switching = false;
  }

  const next = queued;
  queued = null;
  if (next) await switchMap(next.name, next.onRebuilt);
}
