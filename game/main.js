import * as THREE from 'three';
import { renderer, scene, camera } from './world/scene.js';
import { createWorld, ARENA } from './world/world.js';
import { entities } from './entities/entities.js';
import { game, stats, difficulty } from './core/state.js';
import { player, updatePlayer } from './entities/player.js';
import { separateMechs } from './core/helpers.js';
import { updateProjectiles } from './entities/projectiles.js';
import { updateParticles } from './entities/particles.js';
import { updateTurret, updateEnemyMech, updateWaves } from './systems/ai.js';
import { updateHud, drawMinimap } from './ui/hud.js';
import { MP } from './net/net.js';
import { remoteUpdate } from './systems/remote.js';
import './systems/input.js';
import './systems/mobile.js';
import './core/flow.js';
import './ui/lobby.js';

createWorld(scene);
window.__mech = { player, game, entities, MP }; // console/testing hook

/* ============================================================
   Camera
============================================================ */
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const p = player.group.position;
  const yaw = player.yaw;
  const behind = 21, up = 26;
  const cx = p.x - Math.sin(yaw) * behind;
  const cz = p.z - Math.cos(yaw) * behind;
  const k = 1 - Math.exp(-8 * dt);
  camera.position.x += (cx - camera.position.x) * k;
  camera.position.y += (player.y + up - camera.position.y) * k;
  camera.position.z += (cz - camera.position.z) * k;
  // aim well ahead of the mech: tilts the view up so more of the field shows
  camTarget.set(p.x + Math.sin(yaw) * 17, player.y + 2, p.z + Math.cos(yaw) * 17);
  camera.lookAt(camTarget);
}

/* ============================================================
   Main loop
============================================================ */
const clock = new THREE.Clock();
let salvageTrickle = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (game.state === 'playing') {
    game.elapsed += dt;

    updatePlayer(dt);
    if (!MP.active) updateWaves(); // PvP has no AI waves
    for (const e of entities) {
      if (!e.alive) continue;
      // remote entities are replicas driven by the network, never by local AI
      if (e.kind === 'turret' && !e.remote) updateTurret(e, dt);
      else if (e.kind === 'mech' && !MP.active) updateEnemyMech(e, dt);
    }
    separateMechs();
    updateProjectiles(dt);

    // passive salvage income (fixed rate in PvP so both sides earn the same)
    salvageTrickle += dt;
    if (salvageTrickle >= 1) {
      salvageTrickle -= 1;
      stats.salvage += 3 * (MP.active ? 1 : difficulty().salvageMult);
      updateHud();
    }
  }
  remoteUpdate(dt); // multiplayer: state send + opponent replica easing (no-op in SP)

  updateParticles(dt);
  if (game.state !== 'menu') {
    updateCamera(dt);
    drawMinimap();
  } else {
    // idle menu camera orbit, scaled so the whole map stays in frame
    const t = performance.now() * 0.0002;
    const r = (Math.max(ARENA.hw, ARENA.hd) * 1.1 + 25) / Math.min(1, camera.aspect);
    camera.position.set(Math.sin(t) * r, r * 0.85, Math.cos(t) * r);
    camera.lookAt(0, 0, 0);
  }

  renderer.render(scene, camera);
}
animate();
