import * as THREE from 'three';
import { renderer, scene, camera } from './world/scene.js';
import { createWorld } from './world/world.js';
import { entities } from './entities/entities.js';
import { game, stats, difficulty } from './core/state.js';
import { player, updatePlayer } from './entities/player.js';
import { separateMechs } from './core/helpers.js';
import { updateProjectiles } from './entities/projectiles.js';
import { updateParticles } from './entities/particles.js';
import { updateGhost } from './systems/build.js';
import { updateTurret, updateEnemyMech, updateWaves } from './systems/ai.js';
import { updateHud, drawMinimap } from './ui/hud.js';
import './systems/input.js';
import './systems/mobile.js';
import './core/flow.js';

createWorld(scene);
window.__mech = { player, game, entities }; // console/testing hook

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
  camTarget.set(p.x + Math.sin(yaw) * 10, player.y + 2, p.z + Math.cos(yaw) * 10);
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
    updateWaves();
    for (const e of entities) {
      if (!e.alive) continue;
      if (e.kind === 'turret') updateTurret(e, dt);
      else if (e.kind === 'mech') updateEnemyMech(e, dt);
    }
    separateMechs();
    updateProjectiles(dt);
    updateGhost();

    // passive salvage income
    salvageTrickle += dt;
    if (salvageTrickle >= 1) {
      salvageTrickle -= 1;
      stats.salvage += 3 * difficulty().salvageMult;
      updateHud();
    }
  }

  updateParticles(dt);
  if (game.state !== 'menu') {
    updateCamera(dt);
    drawMinimap();
  } else {
    // idle menu camera orbit
    const t = performance.now() * 0.0002;
    camera.position.set(Math.sin(t) * 100, 55, Math.cos(t) * 100);
    camera.lookAt(0, 0, 0);
  }

  renderer.render(scene, camera);
}
animate();
