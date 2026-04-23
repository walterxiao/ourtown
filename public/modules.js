import * as THREE from 'three';

const WALL_W = 2, WALL_H = 3, WALL_T = 0.2;

const MAT = {
  wall:       new THREE.MeshLambertMaterial({ color: 0xe8d5b5 }),
  door:       new THREE.MeshLambertMaterial({ color: 0xd4a96a }),
  glass:      new THREE.MeshLambertMaterial({ color: 0x9ec8f0, transparent: true, opacity: 0.55 }),
  sill:       new THREE.MeshLambertMaterial({ color: 0xe8d5b5 }),
  trunk:      new THREE.MeshLambertMaterial({ color: 0x7a5230 }),
  leaves:     new THREE.MeshLambertMaterial({ color: 0x3e8b45 }),
  path:       new THREE.MeshLambertMaterial({ color: 0xb4ab96 }),
  towerStone: new THREE.MeshLambertMaterial({ color: 0x7c8591 }),
  towerRoof:  new THREE.MeshLambertMaterial({ color: 0x5a2e2a }),
};

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

// Edge modules (wall/door/window) built in 'x' orientation; 'z' rotates 90° about Y.
// Cell modules (tree/pathway) use orient 'c' and don't rotate.
function buildContent(g, kind) {
  if (kind === 'wall') {
    const m = box(WALL_W, WALL_H, WALL_T, MAT.wall);
    m.position.y = WALL_H / 2;
    g.add(m);
  } else if (kind === 'door') {
    const lp = box(0.18, WALL_H, WALL_T, MAT.door); lp.position.set(-0.91, WALL_H / 2, 0);
    const rp = box(0.18, WALL_H, WALL_T, MAT.door); rp.position.set( 0.91, WALL_H / 2, 0);
    const li = box(WALL_W, 0.45, WALL_T, MAT.door); li.position.set(0, WALL_H - 0.22, 0);
    g.add(lp, rp, li);
  } else if (kind === 'window') {
    const bot = box(WALL_W, 0.9, WALL_T, MAT.sill); bot.position.set(0, 0.45, 0);
    const top = box(WALL_W, 0.9, WALL_T, MAT.sill); top.position.set(0, 2.55, 0);
    const gl  = box(WALL_W - 0.1, 1.0, WALL_T * 0.5, MAT.glass); gl.position.set(0, 1.5, 0);
    g.add(bot, top, gl);
  } else if (kind === 'tree') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.3, 8), MAT.trunk);
    trunk.position.y = 0.65;
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.8, 8), MAT.leaves);
    canopy.position.y = 2.1;
    g.add(trunk, canopy);
  } else if (kind === 'pathway') {
    const tile = box(1.95, 0.06, 1.95, MAT.path);
    tile.position.y = 0.03;
    g.add(tile);
  } else if (kind === 'tower') {
    // Two-stage stone tower with a pitched roof
    const base = box(1.7, 1.2, 1.7, MAT.towerStone); base.position.y = 0.6;
    const mid  = box(1.3, 2.2, 1.3, MAT.towerStone); mid.position.y  = 1.2 + 1.1;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.0, 4), MAT.towerRoof);
    roof.position.y = 1.2 + 2.2 + 0.5;
    roof.rotation.y = Math.PI / 4;
    g.add(base, mid, roof);
  }
}

export function makeModuleMesh(kind, orient) {
  const g = new THREE.Group();
  buildContent(g, kind);
  if (orient === 'z') g.rotation.y = Math.PI / 2;
  return g;
}
