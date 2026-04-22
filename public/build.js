import * as THREE from 'three';
import { scene, camera, setZoom, VIEW_DEFAULT, VIEW_BUILD } from './scene.js';
import { slotMap } from './world.js';
import { makeModuleMesh } from './modules.js';

const CELL = 2;
const PLAT_Y = 0.15;
const CELL_TOOLS = new Set(['tree', 'pathway']);

// ─── State ────────────────────────────────────────────────────────────────────

export const buildState = { active: false, slotId: null, tool: 'wall' };

// ─── Hover preview (single item under cursor, shown when NOT dragging) ───────

const hoverMat = new THREE.MeshBasicMaterial({ color: 0x4c9dff, transparent: true, opacity: 0.45, depthWrite: false });

const edgeMesh = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3.1, 0.3), hoverMat);
edgeMesh.position.y = 3.1 / 2;
const edgeGroup = new THREE.Group();
edgeGroup.add(edgeMesh);
edgeGroup.visible = false;
scene.add(edgeGroup);

const cellMesh = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.2, 1.95), hoverMat);
const cellGroup = new THREE.Group();
cellGroup.add(cellMesh);
cellGroup.visible = false;
scene.add(cellGroup);

const TOOL_COLORS = {
  wall: 0x4c9dff, door: 0xff9d4c, window: 0x4cdfff,
  tree: 0x4cff6e, pathway: 0xd4c691, remove: 0xff4c4c,
};

// ─── Drag preview (ghost versions of items to be placed on release) ──────────

const previewGroup = new THREE.Group();
scene.add(previewGroup);
let _previewMeshes = [];

// ─── Grid overlay ─────────────────────────────────────────────────────────────

const gridGroup = new THREE.Group();
gridGroup.visible = false;
scene.add(gridGroup);

// ─── Raycaster ────────────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();
const mouse2d = new THREE.Vector2();
const hitPt = new THREE.Vector3();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PLAT_Y);

let hovered = null;                     // single-hover state (mouse, not dragging)
let _dragActive = false;
let _dragStartX = null, _dragStartZ = null;
let _pendingActions = [];               // queued messages to commit on release

// ─── Public: enter/exit build, tool selection, single-hover ──────────────────

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
  _dragActive = false;
  _clearDragPreview();
  _pendingActions.length = 0;
  edgeGroup.visible = false;
  cellGroup.visible = false;
  gridGroup.visible = false;
  while (gridGroup.children.length) gridGroup.remove(gridGroup.children[0]);
  setZoom(VIEW_DEFAULT);
}

export function setTool(kind) {
  buildState.tool = kind;
  hoverMat.color.setHex(TOOL_COLORS[kind] ?? 0x4c9dff);
  if (CELL_TOOLS.has(kind)) edgeGroup.visible = false;
  else if (kind !== 'remove') cellGroup.visible = false;
}

// ─── Public: pointer handling ────────────────────────────────────────────────

export function onBuildPointerMove(event) {
  if (!buildState.active) return;
  if (_dragActive) {
    _updateDragPreview(event);
  } else {
    _updateSingleHover(event);
  }
}

export function onBuildPointerDown(event) {
  if (!buildState.active) return;
  _dragActive = true;
  // Hide single-hover; the drag preview takes over.
  edgeGroup.visible = false;
  cellGroup.visible = false;
  _clearDragPreview();
  _pendingActions.length = 0;
  const hit = _raycastGround(event);
  if (hit) {
    _dragStartX = hit.x;
    _dragStartZ = hit.z;
    _rebuildDragPreview(hit.x, hit.z);
  } else {
    _dragStartX = null;
    _dragStartZ = null;
  }
}

export function onBuildPointerUp(sendFn) {
  if (!_dragActive) return;
  _dragActive = false;
  // Commit every queued action in order
  for (const action of _pendingActions) sendFn(action);
  _pendingActions.length = 0;
  _clearDragPreview();
  _dragStartX = null;
  _dragStartZ = null;
}

// ─── Raycast helper ──────────────────────────────────────────────────────────

function _raycastGround(event) {
  mouse2d.set(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(mouse2d, camera);
  if (!raycaster.ray.intersectPlane(groundPlane, hitPt)) return null;
  return { x: hitPt.x, z: hitPt.z };
}

// ─── Single-hover (no drag) ──────────────────────────────────────────────────

function _updateSingleHover(event) {
  const e = slotMap.get(buildState.slotId);
  if (!e) return;
  const hit = _raycastGround(event);
  if (!hit) { edgeGroup.visible = false; cellGroup.visible = false; hovered = null; return; }

  const { x: sx, z: sz, size } = e.data;
  const cells = size / CELL;
  const ox = sx - size / 2;
  const oz = sz - size / 2;
  const gx = (hit.x - ox) / CELL;
  const gz = (hit.z - oz) / CELL;

  const tool = buildState.tool;
  if (CELL_TOOLS.has(tool))      _hoverCell(ox, oz, gx, gz, cells);
  else if (tool === 'remove')    _hoverNearestModule(e, ox, oz, hit.x, hit.z);
  else                           _hoverEdge(ox, oz, gx, gz, cells);
}

function _hoverEdge(ox, oz, gx, gz, cells) {
  const edge = _pickEdge(gx, gz, cells);
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
    const c = _moduleCenter(mod, ox, oz);
    const d = Math.hypot(hx - c.x, hz - c.z);
    if (d < bestD) { bestD = d; best = { mod, c }; }
  }
  if (!best || bestD > 1.5) {
    edgeGroup.visible = false; cellGroup.visible = false; hovered = null; return;
  }
  const { mod, c } = best;
  if (mod.orient === 'c') {
    cellGroup.position.set(c.x, PLAT_Y + 0.1, c.z);
    cellGroup.visible = true; edgeGroup.visible = false;
  } else {
    edgeGroup.position.set(c.x, PLAT_Y, c.z);
    edgeMesh.rotation.y = mod.orient === 'z' ? Math.PI / 2 : 0;
    edgeGroup.visible = true; cellGroup.visible = false;
  }
  hovered = { mode: 'module', moduleId: mod.id };
}

// ─── Drag preview / commit ────────────────────────────────────────────────────

function _updateDragPreview(event) {
  const hit = _raycastGround(event);
  if (!hit) return;
  if (_dragStartX === null) { _dragStartX = hit.x; _dragStartZ = hit.z; }
  _rebuildDragPreview(hit.x, hit.z);
}

function _rebuildDragPreview(endX, endZ) {
  _clearDragPreview();
  _pendingActions.length = 0;
  if (_dragStartX === null) return;

  const e = slotMap.get(buildState.slotId);
  if (!e) return;

  const { x: sx, z: sz, size } = e.data;
  const cells = size / CELL;
  const ox = sx - size / 2;
  const oz = sz - size / 2;
  const tool = buildState.tool;

  const dx = endX - _dragStartX;
  const dz = endZ - _dragStartZ;
  const dist = Math.hypot(dx, dz);

  // Once the drag is long enough to reveal intent, lock to the dominant axis
  // and the start row/column. This prevents perpendicular walls from spiking
  // out when the cursor drifts slightly off-axis. A pure click (dist≈0) keeps
  // freeform behaviour.
  let lockOrient = null;   // 'x' or 'z' for edge tools
  let lockRow = null;      // ez when lockOrient === 'x'
  let lockCol = null;      // ex when lockOrient === 'z'
  const startGx = (_dragStartX - ox) / CELL;
  const startGz = (_dragStartZ - oz) / CELL;

  if (dist > 0.6 && tool !== 'remove') {
    lockOrient = Math.abs(dx) >= Math.abs(dz) ? 'x' : 'z';
    if (lockOrient === 'x') lockRow = Math.round(startGz);
    else                    lockCol = Math.round(startGx);
  }

  // Step small enough not to skip a 2 m cell/edge on a diagonal
  const steps = Math.max(1, Math.ceil(dist / 0.25));
  const seenKeys = new Set();

  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const sampleX = _dragStartX + dx * t;
    const sampleZ = _dragStartZ + dz * t;
    const gx = (sampleX - ox) / CELL;
    const gz = (sampleZ - oz) / CELL;

    if (tool === 'remove') {
      _collectRemoveAt(e, ox, oz, sampleX, sampleZ, seenKeys);
    } else if (CELL_TOOLS.has(tool)) {
      _collectCellAt(tool, ox, oz, gx, gz, cells, seenKeys, lockOrient, lockRow, lockCol);
    } else {
      _collectEdgeAt(tool, ox, oz, gx, gz, cells, seenKeys, lockOrient, lockRow, lockCol);
    }
  }
}

function _collectEdgeAt(tool, ox, oz, gx, gz, cells, seen, lockOrient, lockRow, lockCol) {
  let edge;
  if (lockOrient === 'x') {
    const ex = Math.floor(gx);
    const ez = lockRow;
    if (ex < 0 || ex >= cells || ez < 0 || ez > cells) return;
    edge = { ex, ez, orient: 'x' };
  } else if (lockOrient === 'z') {
    const ex = lockCol;
    const ez = Math.floor(gz);
    if (ex < 0 || ex > cells || ez < 0 || ez >= cells) return;
    edge = { ex, ez, orient: 'z' };
  } else {
    edge = _pickEdge(gx, gz, cells);
    if (!edge) return;
  }

  const key = `p:${edge.ex},${edge.ez},${edge.orient}`;
  if (seen.has(key)) return;
  seen.add(key);

  const mesh = _makeGhost(tool, edge.orient);
  const wx = edge.orient === 'x' ? ox + (edge.ex + 0.5) * CELL : ox + edge.ex * CELL;
  const wz = edge.orient === 'x' ? oz + edge.ez * CELL       : oz + (edge.ez + 0.5) * CELL;
  mesh.position.set(wx, PLAT_Y, wz);
  previewGroup.add(mesh);
  _previewMeshes.push(mesh);

  _pendingActions.push({
    type: 'place-module',
    slotId: buildState.slotId,
    module: { kind: tool, ex: edge.ex, ez: edge.ez, orient: edge.orient },
  });
}

function _collectCellAt(tool, ox, oz, gx, gz, cells, seen, lockOrient, lockRow, lockCol) {
  let cx = Math.floor(gx), cz = Math.floor(gz);
  // Lock the off-axis coordinate so a horizontal drag stays in one row.
  if (lockOrient === 'x' && lockRow !== null) cz = Math.min(cells - 1, Math.max(0, lockRow));
  if (lockOrient === 'z' && lockCol !== null) cx = Math.min(cells - 1, Math.max(0, lockCol));
  if (cx < 0 || cx >= cells || cz < 0 || cz >= cells) return;

  const key = `p:${cx},${cz},c`;
  if (seen.has(key)) return;
  seen.add(key);

  const mesh = _makeGhost(tool, 'c');
  mesh.position.set(ox + (cx + 0.5) * CELL, PLAT_Y, oz + (cz + 0.5) * CELL);
  previewGroup.add(mesh);
  _previewMeshes.push(mesh);

  _pendingActions.push({
    type: 'place-module',
    slotId: buildState.slotId,
    module: { kind: tool, ex: cx, ez: cz, orient: 'c' },
  });
}

function _collectRemoveAt(entry, ox, oz, hx, hz, seen) {
  for (const mod of entry.data.modules) {
    const key = `r:${mod.id}`;
    if (seen.has(key)) continue;
    const c = _moduleCenter(mod, ox, oz);
    if (Math.hypot(hx - c.x, hz - c.z) > 1.3) continue;
    seen.add(key);

    // Red highlight box over the module
    const isCell = mod.orient === 'c';
    const geo = isCell
      ? new THREE.BoxGeometry(2.05, 0.25, 2.05)
      : new THREE.BoxGeometry(2.15, 3.15, 0.35);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff4c4c, transparent: true, opacity: 0.4, depthWrite: false });
    const box = new THREE.Mesh(geo, mat);
    if (mod.orient === 'z') box.rotation.y = Math.PI / 2;
    box.position.set(c.x, isCell ? PLAT_Y + 0.12 : PLAT_Y + 3.15 / 2, c.z);
    previewGroup.add(box);
    _previewMeshes.push(box);

    _pendingActions.push({
      type: 'remove-module',
      slotId: buildState.slotId,
      moduleId: mod.id,
    });
  }
}

function _clearDragPreview() {
  for (const m of _previewMeshes) {
    previewGroup.remove(m);
    m.traverse?.(c => { c.geometry?.dispose?.(); c.material?.dispose?.(); });
  }
  _previewMeshes.length = 0;
}

function _makeGhost(kind, orient) {
  const g = makeModuleMesh(kind, orient);
  g.traverse(child => {
    if (!child.isMesh) return;
    const mat = child.material.clone();
    mat.transparent = true;
    mat.opacity = 0.45;
    mat.depthWrite = false;
    child.material = mat;
  });
  return g;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function _pickEdge(gx, gz, cells) {
  const exX = Math.floor(gx), ezX = Math.round(gz);
  const distX = Math.abs(gz - ezX);
  const exZ = Math.round(gx), ezZ = Math.floor(gz);
  const distZ = Math.abs(gx - exZ);

  if (distX <= distZ) {
    if (exX >= 0 && exX < cells && ezX >= 0 && ezX <= cells) return { ex: exX, ez: ezX, orient: 'x' };
  } else {
    if (exZ >= 0 && exZ <= cells && ezZ >= 0 && ezZ < cells) return { ex: exZ, ez: ezZ, orient: 'z' };
  }
  return null;
}

function _moduleCenter(mod, ox, oz) {
  if (mod.orient === 'x') return { x: ox + (mod.ex + 0.5) * CELL, z: oz + mod.ez * CELL };
  if (mod.orient === 'z') return { x: ox + mod.ex * CELL, z: oz + (mod.ez + 0.5) * CELL };
  return { x: ox + (mod.ex + 0.5) * CELL, z: oz + (mod.ez + 0.5) * CELL };
}

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
