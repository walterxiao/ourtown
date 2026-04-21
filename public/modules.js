import * as THREE from 'three';

const WALL_W = 2, WALL_H = 3, WALL_T = 0.2;

const MAT = {
  wall:   new THREE.MeshLambertMaterial({ color: 0xe8d5b5 }),
  door:   new THREE.MeshLambertMaterial({ color: 0xd4a96a }),
  glass:  new THREE.MeshLambertMaterial({ color: 0x9ec8f0, transparent: true, opacity: 0.55 }),
  sill:   new THREE.MeshLambertMaterial({ color: 0xe8d5b5 }),
};

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

// All module geometry built in 'x' orientation (extends along X, thickness along Z).
// 'z' orientation rotates the group 90° around Y.
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
  }
}

export function makeModuleMesh(kind, orient) {
  const g = new THREE.Group();
  buildContent(g, kind);
  if (orient === 'z') g.rotation.y = Math.PI / 2;
  return g;
}
