import * as THREE from 'three';
import { scene } from './scene.js';
import { makeTextSprite } from './sprites.js';
import { makeModuleMesh } from './modules.js';

const CELL = 2;          // meters per grid cell
const PLAT_H = 0.15;     // slot platform thickness

export const slotMap = new Map(); // slotId -> entry

// ─── World build ──────────────────────────────────────────────────────────────

export function buildWorld(slots, cfg) {
  addGround();
  addRoads(cfg);
  for (const s of slots) addSlot(s);
}

function addGround() {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.MeshLambertMaterial({ color: 0x6ba84f }),
  );
  m.rotation.x = -Math.PI / 2;
  scene.add(m);
}

function addRoads({ SLOT_SIZE, ROAD_WIDTH, SLOT_ROWS, SLOT_COLS }) {
  const pitchX = SLOT_SIZE + ROAD_WIDTH;
  const pitchZ = SLOT_SIZE + ROAD_WIDTH + 4;
  const roadMat  = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const driveMat = new THREE.MeshLambertMaterial({ color: 0xa8a8a8 });

  // Main horizontal road between the two rows (exactly fills the gap, touches
  // the front edge of every slot on both sides).
  const spanX = (SLOT_COLS - 1) * pitchX + SLOT_SIZE + 30;
  addBox(spanX, 0.08, ROAD_WIDTH + 4, roadMat, 0, 0.04, 0);

  // Per-slot driveway: a 2.5 × 3 m pad leading from the main road into the
  // front edge of the slot. Row 0 is north of the road (driveway on south
  // edge of slot), row 1 is south of the road (driveway on north edge).
  const driveW = 2.5, driveLen = 3;
  const halfSlot = SLOT_SIZE / 2;
  for (let col = 0; col < SLOT_COLS; col++) {
    const cx = (col - (SLOT_COLS - 1) / 2) * pitchX;
    for (let row = 0; row < SLOT_ROWS; row++) {
      const cz = (row - (SLOT_ROWS - 1) / 2) * pitchZ;
      const sign = row === 0 ? +1 : -1;               // direction from slot center toward road
      const frontZ = cz + sign * halfSlot;            // slot's road-facing edge
      const driveCenterZ = frontZ - sign * (driveLen / 2);
      addBox(driveW, 0.1, driveLen, driveMat, cx, 0.06, driveCenterZ);
    }
  }
}

function addBox(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  scene.add(m);
}

// ─── Slots ────────────────────────────────────────────────────────────────────

function addSlot(s) {
  const g = new THREE.Group();
  g.position.set(s.x, 0, s.z);

  const claimed = !!s.ownerName;
  const platMat = new THREE.MeshLambertMaterial({ color: claimed ? 0x7ab85a : 0x9fd66c });
  const plat = new THREE.Mesh(new THREE.BoxGeometry(s.size, PLAT_H, s.size), platMat);
  plat.position.y = PLAT_H / 2;
  g.add(plat);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(s.size, PLAT_H, s.size)),
    new THREE.LineBasicMaterial({ color: 0x4a8a30 }),
  );
  edges.position.y = PLAT_H / 2;
  g.add(edges);

  const modulesGroup = new THREE.Group();
  modulesGroup.position.y = PLAT_H;
  g.add(modulesGroup);

  const label = makeSlotLabel(s);
  g.add(label);

  scene.add(g);

  const entry = { data: s, group: g, platMat, modulesGroup, label, moduleMeshes: new Map() };
  slotMap.set(s.id, entry);

  for (const mod of s.modules) _placeMesh(entry, mod);
}

function makeSlotLabel(s) {
  const text  = s.ownerName ? s.ownerName : 'Empty';
  const color = s.ownerName ? '#ffd76a' : '#aaaaaa';
  const sp = makeTextSprite(text, color);
  sp.position.y = 5.5;
  return sp;
}

function _refreshLabel(entry) {
  entry.group.remove(entry.label);
  entry.label.material.map.dispose();
  entry.label.material.dispose();
  entry.label = makeSlotLabel(entry.data);
  entry.group.add(entry.label);
}

// ─── Public mutation API (called by client.js on server messages) ─────────────

export function claimSlotVisual(slotId, ownerName) {
  const e = slotMap.get(slotId);
  if (!e) return;
  e.data.ownerName = ownerName;
  e.platMat.color.setHex(0x7ab85a);
  _refreshLabel(e);
}

export function addModuleData(slotId, mod) {
  const e = slotMap.get(slotId);
  if (!e) return;
  // Remove any existing module on the same edge (server dedupes, this handles local echo)
  const old = e.data.modules.find(m => m.ex === mod.ex && m.ez === mod.ez && m.orient === mod.orient);
  if (old) _removeMesh(e, old.id);
  e.data.modules.push(mod);
  _placeMesh(e, mod);
}

export function removeModuleMeshById(slotId, moduleId) {
  const e = slotMap.get(slotId);
  if (!e) return;
  _removeMesh(e, moduleId);
}

function _placeMesh(entry, mod) {
  const mesh = makeModuleMesh(mod.kind, mod.orient);
  const half = entry.data.size / 2;
  if (mod.orient === 'x') {
    mesh.position.set(-half + (mod.ex + 0.5) * CELL, 0, -half + mod.ez * CELL);
  } else if (mod.orient === 'z') {
    mesh.position.set(-half + mod.ex * CELL, 0, -half + (mod.ez + 0.5) * CELL);
  } else { // 'c' — cell center
    mesh.position.set(-half + (mod.ex + 0.5) * CELL, 0, -half + (mod.ez + 0.5) * CELL);
  }
  entry.modulesGroup.add(mesh);
  entry.moduleMeshes.set(mod.id, mesh);
}

// ─── Collision ────────────────────────────────────────────────────────────────
// Walls, windows, and trees block movement. Doors and pathways are passable.

const TREE_RADIUS = 0.55;

export function isPositionBlocked(x, z, playerRadius = 0.45) {
  for (const entry of slotMap.values()) {
    const { data } = entry;
    const reach = data.size / 2 + 2;
    if (Math.abs(data.x - x) > reach || Math.abs(data.z - z) > reach) continue;

    const half = data.size / 2;
    const ox = data.x - half;
    const oz = data.z - half;

    for (const mod of data.modules) {
      if (mod.kind === 'door' || mod.kind === 'pathway') continue;

      if (mod.orient === 'c') {
        // Tree or tower: circle-vs-circle
        const cx = ox + (mod.ex + 0.5) * CELL;
        const cz = oz + (mod.ez + 0.5) * CELL;
        const r = mod.kind === 'tower' ? 0.9 : TREE_RADIUS;
        if (Math.hypot(x - cx, z - cz) < playerRadius + r) return true;
      } else {
        // Wall/window: point-to-segment
        let ax, az, bx, bz;
        if (mod.orient === 'x') {
          ax = ox + mod.ex * CELL;         az = oz + mod.ez * CELL;
          bx = ox + (mod.ex + 1) * CELL;   bz = az;
        } else {
          ax = ox + mod.ex * CELL;         az = oz + mod.ez * CELL;
          bx = ax;                          bz = oz + (mod.ez + 1) * CELL;
        }
        if (_segDist(x, z, ax, az, bx, bz) < playerRadius + 0.1) return true;
      }
    }
  }
  return false;
}

function _segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function _removeMesh(entry, moduleId) {
  const mesh = entry.moduleMeshes.get(moduleId);
  if (mesh) { entry.modulesGroup.remove(mesh); entry.moduleMeshes.delete(moduleId); }
  entry.data.modules = entry.data.modules.filter(m => m.id !== moduleId);
}
