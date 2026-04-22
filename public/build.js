import * as THREE from 'three';
import { scene, camera, setZoom, VIEW_DEFAULT, VIEW_BUILD } from './scene.js';
import { slotMap } from './world.js';

const CELL = 2;
const PLAT_Y = 0.15;
const CELL_TOOLS = new Set(['tree', 'pathway']);

// ─── State ────────────────────────────────────────────────────────────────────

export const buildState = { active: false, slotId: null, tool: 'wall' };

// ─── Hover preview meshes ────────────────────────────────────────────────────

const hoverMat = new THREE.MeshBasicMaterial({ color: 0x4c9dff, transparent: true, opacity: 0.45, depthWrite: false });

// Edge hover (thin tall slab, 2 m × 3 m × 0.3 m)
const edgeMesh = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3.1, 0.3), hoverMat);
edgeMesh.position.y = 3.1 / 2;
const edgeGroup = new THREE.Group();
edgeGroup.add(edgeMesh);
edgeGroup.visible = false;
scene.add(edgeGroup);

// Cell hover (flat 2 m × 2 m pad)
const cellMesh = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.2, 1.95), hoverMat);
const cellGroup = new THREE.Group();
cellGroup.add(cellMesh);
cellGroup.visible = false;
scene.add(cellGroup);

const TOOL_COLORS = {
  wall: 0x4c9dff, door: 0xff9d4c, window: 0x4cdfff,
  tree: 0x4cff6e, pathway: 0xd4c691, remove: 0xff4c4c,
};

// ─── Grid overlay ─────────────────────────────────────────────────────────────

const gridGroup = new THREE.Group();
gridGroup.visible = false;
scene.add(gridGroup);

// ─── Raycaster ────────────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();
const mouse2d = new THREE.Vector2();
const hitPt = new THREE.Vector3();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PLAT_Y);

let hovered = null; // { mode: 'edge' | 'cell', ex, ez, orient? }

// ─── Public API ───────────────────────────────────────────────────────────────

export function enterBuild(slotId) {
  buildState.active = true;
  buildState.slotId = slotId;
  _buildGrid(slotId);
  edgeGroup.visible = false;
  cellGroup.visible = false;
  gridGroup.visible = true;
  setZoom(VIEW_BUILD);
}

export function exitBuild() {
  buildState.active = false;
  buildState.slotId = null;
  hovered = null;
  edgeGroup.visible = false;
  cellGroup.visible = false;
  gridGroup.visible = false;
  while (gridGroup.children.length) gridGroup.remove(gridGroup.children[0]);
  setZoom(VIEW_DEFAULT);
}

export function setTool(kind) {
  buildState.tool = kind;
  hoverMat.color.setHex(TOOL_COLORS[kind] ?? 0x4c9dff);
  // Hide whichever preview doesn't match the new tool; the next mouse-move repositions.
  if (CELL_TOOLS.has(kind)) edgeGroup.visible = false;
  else if (kind !== 'remove') cellGroup.visible = false;
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
  if (!raycaster.ray.intersectPlane(groundPlane, hitPt)) {
    edgeGroup.visible = false; cellGroup.visible = false;
    return;
  }

  const { x: sx, z: sz, size } = e.data;
  const cells = size / CELL;
  const ox = sx - size / 2;
  const oz = sz - size / 2;
  const gx = (hitPt.x - ox) / CELL;
  const gz = (hitPt.z - oz) / CELL;

  const tool = buildState.tool;

  if (CELL_TOOLS.has(tool)) {
    _hoverCell(ox, oz, gx, gz, cells);
  } else if (tool === 'remove') {
    _hoverNearestModule(e, ox, oz, hitPt.x, hitPt.z);
  } else {
    _hoverEdge(ox, oz, gx, gz, cells);
  }
}

export function onBuildClick(sendFn) {
  if (!buildState.active || !hovered) return;
  const { slotId, tool } = buildState;

  if (tool === 'remove') {
    if (hovered.mode !== 'module') return;
    sendFn({ type: 'remove-module', slotId, moduleId: hovered.moduleId });
    return;
  }

  if (CELL_TOOLS.has(tool)) {
    if (hovered.mode !== 'cell') return;
    sendFn({ type: 'place-module', slotId, module: { kind: tool, ex: hovered.ex, ez: hovered.ez, orient: 'c' } });
  } else {
    if (hovered.mode !== 'edge') return;
    sendFn({ type: 'place-module', slotId, module: { kind: tool, ex: hovered.ex, ez: hovered.ez, orient: hovered.orient } });
  }
}

// ─── Hover helpers ────────────────────────────────────────────────────────────

function _hoverEdge(ox, oz, gx, gz, cells) {
  const exX = Math.floor(gx), ezX = Math.round(gz);
  const distX = Math.abs(gz - ezX);
  const exZ = Math.round(gx), ezZ = Math.floor(gz);
  const distZ = Math.abs(gx - exZ);

  let edge = null;
  if (distX <= distZ) {
    if (exX >= 0 && exX < cells && ezX >= 0 && ezX <= cells) edge = { ex: exX, ez: ezX, orient: 'x' };
  } else {
    if (exZ >= 0 && exZ <= cells && ezZ >= 0 && ezZ < cells) edge = { ex: exZ, ez: ezZ, orient: 'z' };
  }

  cellGroup.visible = false;
  if (!edge) { edgeGroup.visible = false; hovered = null; return; }

  const wx = edge.orient === 'x' ? ox + (edge.ex + 0.5) * CELL : ox + edge.ex * CELL;
  const wz = edge.orient === 'x' ? oz + edge.ez * CELL       : oz + (edge.ez + 0.5) * CELL;
  edgeGroup.position.set(wx, PLAT_Y, wz);
  edgeMesh.rotation.y = edge.orient === 'z' ? Math.PI / 2 : 0;
  edgeGroup.visible = true;
  hovered = { mode: 'edge', ...edge };
}

function _hoverCell(ox, oz, gx, gz, cells) {
  const cx = Math.floor(gx), cz = Math.floor(gz);
  edgeGroup.visible = false;
  if (cx < 0 || cx >= cells || cz < 0 || cz >= cells) {
    cellGroup.visible = false; hovered = null; return;
  }
  cellGroup.position.set(ox + (cx + 0.5) * CELL, PLAT_Y + 0.1, oz + (cz + 0.5) * CELL);
  cellGroup.visible = true;
  hovered = { mode: 'cell', ex: cx, ez: cz };
}

function _hoverNearestModule(entry, ox, oz, hx, hz) {
  let best = null, bestD = Infinity;
  for (const mod of entry.data.modules) {
    let mx, mz;
    if (mod.orient === 'x') { mx = ox + (mod.ex + 0.5) * CELL; mz = oz + mod.ez * CELL; }
    else if (mod.orient === 'z') { mx = ox + mod.ex * CELL; mz = oz + (mod.ez + 0.5) * CELL; }
    else { mx = ox + (mod.ex + 0.5) * CELL; mz = oz + (mod.ez + 0.5) * CELL; }
    const d = Math.hypot(hx - mx, hz - mz);
    if (d < bestD) { bestD = d; best = { mod, mx, mz }; }
  }

  if (!best || bestD > 1.5) {
    edgeGroup.visible = false; cellGroup.visible = false; hovered = null; return;
  }
  const { mod, mx, mz } = best;
  if (mod.orient === 'c') {
    cellGroup.position.set(mx, PLAT_Y + 0.1, mz);
    cellGroup.visible = true; edgeGroup.visible = false;
  } else {
    edgeGroup.position.set(mx, PLAT_Y, mz);
    edgeMesh.rotation.y = mod.orient === 'z' ? Math.PI / 2 : 0;
    edgeGroup.visible = true; cellGroup.visible = false;
  }
  hovered = { mode: 'module', moduleId: mod.id };
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
    pts.push(new THREE.Vector3(ox, PLAT_Y + 0.02, wz), new THREE.Vector3(ox + size, PLAT_Y + 0.02, wz));
  }
  for (let gx = 0; gx <= cells; gx++) {
    const wx = ox + gx * CELL;
    pts.push(new THREE.Vector3(wx, PLAT_Y + 0.02, oz), new THREE.Vector3(wx, PLAT_Y + 0.02, oz + size));
  }

  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
  gridGroup.add(lines);
}
