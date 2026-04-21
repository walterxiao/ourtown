import * as THREE from 'three';

const canvas = document.getElementById('game');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7fb8e8);
scene.fog = new THREE.Fog(0x7fb8e8, 120, 280);

export const VIEW_DEFAULT = 32;   // normal roaming zoom
export const VIEW_BUILD   = 28;   // build-mode zoom (lot fills screen)

let viewSize = VIEW_DEFAULT;

export const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);

// Camera sits at (+X +Y +Z) from target — true 45° isometric (yaw=45°, pitch≈35°)
const CAM_OFFSET = new THREE.Vector3(38, 38, 38);

// World-space WASD directions (projected onto XZ plane, matching camera 45° yaw)
// Screen-forward (W key) moves toward (-1, 0, -1)
// Screen-right  (D key) moves toward (+1, 0, -1)
export const SCREEN_FWD = new THREE.Vector3(-1, 0, -1).normalize();
export const SCREEN_RGT = new THREE.Vector3(1, 0, -1).normalize();

export function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  const asp = w / h;
  camera.left   = -viewSize * asp;
  camera.right  =  viewSize * asp;
  camera.top    =  viewSize;
  camera.bottom = -viewSize;
  camera.updateProjectionMatrix();
}

export function setZoom(v) { viewSize = v; resize(); }

window.addEventListener('resize', resize);
resize();

const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(40, 80, 20);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xb0c8ff, 0.6));

export function positionCamera(target) {
  camera.position.copy(target).add(CAM_OFFSET);
  camera.lookAt(target);
}
