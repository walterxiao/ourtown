import * as THREE from 'three';
import { scene, camera, setZoom, VIEW_DEFAULT, VIEW_BUILD } from './scene.js';
import { slotMap } from './world.js';

const CELL = 2;
const PLAT_Y = 0.15;

// ─── State ────────────────────────────────────────────────────────────────────

export const buildState = { active: false, slotId: null, tool: 'wall' };

// ─── Hover preview mesh ───────────────────────────────────────────────────────

const hoverMat = new THREE.MeshBasicMaterial({ color: 0x4c9dff, transparent: true, opacity: 0.45, depthWrite: false });
const hoverMesh = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3.1, 0.3), hoverMat);
hoverMesh.position.y = 3.1 / 2;
const hoverGroup = new THREE.Group();
hoverGroup.add(hoverMesh);
hoverGroup.visible = false;
scene.add(hoverGroup);

const TOOL_COLORS = { wall: 0x4c9dff, door: 0xff9d4c, window: 0x4cdfff, remove: 0xff4c4c };

// ─── Grid overlay ─────────────────────────────────────────────────────────────

const gridGroup = new THREE.Group();
gridGroup.visible = false;
scene.add(gridGroup);

// ─── Raycaster ────────────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();
const mouse2d = new THREE.Vector2();
const hitPt = new THREE.Vector3();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PLAT_Y);

let hoveredEdge = null; // { ex, ez, orient }

// ─── Public API ───────────────────────────────────────────────────────────────

export function enterBuild(slotId) {
  buildState.active = true;
  buildState.slotId = slotId;
  _buildGrid(slotId);
  hoverGroup.visible = false;
  gridGroup.visible = true;
  setZoom(VIEW_BUILD);
}

export function exitBuild() {
  buildState.active = false;
  buildState.slotId = null;
  hoveredEdge = null;
  hoverGroup.visible = false;
  gridGroup.visible = false;
  while (gridGroup.children.length) gridGroup.remove(gridGroup.children[0]);
  setZoom(VIEW_DEFAULT);
}

export function setTool(kind) {
  buildState.tool = kind;
  hoverMat.color.setHex(TOOL_COLORS[kind] ?? 0x4c9dff);
}

export function onBuildMouseMove(event) {
  if (!buildState.active) return;
  const e = slotMap.get(buildState.slotId);
  if (!e) return;

  mouse2d.set(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(mouse2d, camera);
  if (!raycaster.ray.intersectPlane(groundPlane, hitPt)) { hoverGroup.visible = false; return; }

  const { x: sx, z: sz, size } = e.data;
  const cells = size / CELL;
  const ox = sx - size / 2;
  const oz = sz - size / 2;
  const gx = (hitPt.x - ox) / CELL;
  const gz = (hitPt.z - oz) / CELL;

  // Candidate 'x' edge: wall runs along X at integer gz
  const exX = Math.floor(gx), ezX = Math.round(gz);
  const distX = Math.abs(gz - ezX);

  // Candidate 'z' edge: wall runs along Z at integer gx
  const exZ = Math.round(gx), ezZ = Math.floor(gz);
  const distZ = Math.abs(gx - exZ);

  let edge = null;
  if (distX <= distZ) {
    if (exX >= 0 && exX < cells && ezX >= 0 && ezX <= cells) {
      edge = { ex: exX, ez: ezX, orient: 'x' };
    }
  } else {
    if (exZ >= 0 && exZ <= cells && ezZ >= 0 && ezZ < cells) {
      edge = { ex: exZ, ez: ezZ, orient: 'z' };
    }
  }

  hoveredEdge = edge;

  if (edge) {
    const wx = edge.orient === 'x'
      ? ox + (edge.ex + 0.5) * CELL
      : ox + edge.ex * CELL;
    const wz = edge.orient === 'x'
      ? oz + edge.ez * CELL
      : oz + (edge.ez + 0.5) * CELL;
    hoverGroup.position.set(wx, PLAT_Y, wz);
    hoverMesh.rotation.y = edge.orient === 'z' ? Math.PI / 2 : 0;
    hoverGroup.visible = true;
  } else {
    hoverGroup.visible = false;
  }
}

export function onBuildClick(sendFn) {
  if (!buildState.active || !hoveredEdge) return;
  const { slotId, tool } = buildState;
  const { ex, ez, orient } = hoveredEdge;

  if (tool === 'remove') {
    const e = slotMap.get(slotId);
    if (!e) return;
    const mod = e.data.modules.find(m => m.ex === ex && m.ez === ez && m.orient === orient);
    if (mod) sendFn({ type: 'remove-module', slotId, moduleId: mod.id });
  } else {
    sendFn({ type: 'place-module', slotId, module: { kind: tool, ex, ez, orient } });
  }
}

// ─── Private ──────────────────────────────────────────────────────────────────

function _buildGrid(slotId) {
  while (gridGroup.children.length) gridGroup.remove(gridGroup.children[0]);
  const e = slotMap.get(slotId);
  if (!e) return;
  const { x: sx, z: sz, size } = e.data;
  const cells = size / CELL;
  const ox = sx - size / 2;
  const oz = sz - size / 2;

  const pts = [];
  for (let gz = 0; gz <= cells; gz++) {
    const wz = oz + gz * CELL;
    pts.push(new THREE.Vector3(ox, 0, wz), new THREE.Vector3(ox + size, 0, wz));
  }
  for (let gx = 0; gx <= cells; gx++) {
    const wx = ox + gx * CELL;
    pts.push(new THREE.Vector3(wx, 0, oz), new THREE.Vector3(wx, 0, oz + size));
  }

  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
  gridGroup.add(lines);
}
