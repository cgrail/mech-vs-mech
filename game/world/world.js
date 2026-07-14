import * as THREE from 'three';

/* ============================================================
   Arena: ground, walls, obstacle blocks
============================================================ */
export const ARENA = { hw: 80, hd: 130 };           // half width (x), half depth (z)
export const obstacles = [];                         // {x, z, hw, hd, h}

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
  tex.repeat.set(10, 16);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld(scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA.hw * 2 + 40, ARENA.hd * 2 + 40),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const blockMat = new THREE.MeshStandardMaterial({ color: 0x5c6a72, roughness: 0.9 });
  const blockMat2 = new THREE.MeshStandardMaterial({ color: 0x4d5a66, roughness: 0.9 });

  function addBlock(x, z, w, d, h, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || blockMat);
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    obstacles.push({ x, z, hw: w / 2, hd: d / 2, h });
    return m;
  }

  /* perimeter walls */
  addBlock(0, -ARENA.hd - 2, ARENA.hw * 2 + 8, 4, 12, blockMat2);
  addBlock(0, ARENA.hd + 2, ARENA.hw * 2 + 8, 4, 12, blockMat2);
  addBlock(-ARENA.hw - 2, 0, 4, ARENA.hd * 2 + 8, 12, blockMat2);
  addBlock(ARENA.hw + 2, 0, 4, ARENA.hd * 2 + 8, 12, blockMat2);

  /* symmetric urban blocks — lanes like a Future Cop street map */
  addBlock(-34, -62, 24, 16, 9);
  addBlock(34, -62, 24, 16, 9);
  addBlock(0, -34, 28, 12, 6);
  addBlock(-52, 0, 18, 34, 10, blockMat2);
  addBlock(52, 0, 18, 34, 10, blockMat2);
  addBlock(0, 34, 28, 12, 6);
  addBlock(-34, 62, 24, 16, 9);
  addBlock(34, 62, 24, 16, 9);
  addBlock(-14, 0, 8, 8, 5, blockMat2);
  addBlock(14, 0, 8, 8, 5, blockMat2);
}
