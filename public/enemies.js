import * as THREE from 'three';
import { scene } from './scene.js';

// ─── Enemy rendering ──────────────────────────────────────────────────────────

const enemyMap = new Map();     // id -> { group, hpBar, hpFill, maxHp, tx, tz }
const LERP = 10;

const ENEMY_MAT = new THREE.MeshLambertMaterial({ color: 0x9b2a2a });
const HP_BG_MAT = new THREE.MeshBasicMaterial({ color: 0x222222, depthTest: false });
const HP_FG_MAT = new THREE.MeshBasicMaterial({ color: 0x55dd55, depthTest: false });

function makeEnemyMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.0, 6), ENEMY_MAT);
  body.position.y = 0.5;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), ENEMY_MAT);
  head.position.y = 1.2;
  g.add(head);
  // HP bar (camera-facing sprite via two thin plates)
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.18), HP_BG_MAT);
  bg.position.y = 2.0;
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.14), HP_FG_MAT);
  fg.position.set(0, 2.0, 0.001);
  // Always face camera via sprite-like trick: rotate to horizontal + keep Y up
  g.add(bg, fg);
  return { group: g, bg, fg };
}

export function spawnEnemy(e) {
  if (enemyMap.has(e.id)) return;
  const { group, fg } = makeEnemyMesh();
  group.position.set(e.x, 0, e.z);
  scene.add(group);
  enemyMap.set(e.id, { group, hpFill: fg, maxHp: e.maxHp, hp: e.hp, tx: e.x, tz: e.z });
}

export function moveEnemy(id, x, z) {
  const r = enemyMap.get(id);
  if (r) { r.tx = x; r.tz = z; }
}

export function damageEnemy(id, hp) {
  const r = enemyMap.get(id);
  if (!r) return;
  r.hp = hp;
  const pct = Math.max(0, Math.min(1, hp / r.maxHp));
  r.hpFill.scale.x = pct;
  r.hpFill.position.x = -(1 - pct) * 0.58;
  // Color from green → yellow → red
  const c = r.hpFill.material.color;
  if (pct > 0.5) c.setRGB(1 - (pct - 0.5) * 2 * 0.4, 0.87, 0.33);
  else c.setRGB(1, pct * 2 * 0.8, 0.2);
}

export function killEnemy(id) {
  const r = enemyMap.get(id);
  if (!r) return;
  scene.remove(r.group);
  enemyMap.delete(id);
}

export function clearEnemies() {
  for (const r of enemyMap.values()) scene.remove(r.group);
  enemyMap.clear();
}

export function lerpEnemies(dt, cameraDir) {
  const k = Math.min(1, LERP * dt);
  for (const r of enemyMap.values()) {
    r.group.position.x += (r.tx - r.group.position.x) * k;
    r.group.position.z += (r.tz - r.group.position.z) * k;
    // Keep HP bars roughly camera-facing (our camera is fixed-angle iso)
    if (cameraDir) {
      r.group.rotation.y = Math.atan2(cameraDir.x, cameraDir.z);
    }
  }
}

// ─── Path visualization ───────────────────────────────────────────────────────

let pathMesh = null;

export function drawPath(points) {
  if (pathMesh) { scene.remove(pathMesh); pathMesh = null; }
  if (!points || points.length < 2) return;
  const mat = new THREE.LineBasicMaterial({ color: 0xff6e4c, transparent: true, opacity: 0.65 });
  const pts = points.map(p => new THREE.Vector3(p.x, 0.12, p.z));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  pathMesh = new THREE.Line(geo, mat);
  scene.add(pathMesh);
}

// ─── Tower-fire effect (brief laser) ──────────────────────────────────────────

const fireGroup = new THREE.Group();
scene.add(fireGroup);
const fireLines = [];  // { line, decayAt }

export function showTowerFire(tx, tz, enemyX, enemyZ) {
  const mat = new THREE.LineBasicMaterial({ color: 0xffee66, transparent: true, opacity: 0.9 });
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(tx, 3.5, tz),
    new THREE.Vector3(enemyX, 1.2, enemyZ),
  ]);
  const line = new THREE.Line(geo, mat);
  fireGroup.add(line);
  fireLines.push({ line, decayAt: performance.now() + 140 });
}

export function tickFireEffects() {
  const now = performance.now();
  for (let i = fireLines.length - 1; i >= 0; i--) {
    const f = fireLines[i];
    if (now >= f.decayAt) {
      fireGroup.remove(f.line);
      f.line.geometry.dispose(); f.line.material.dispose();
      fireLines.splice(i, 1);
    }
  }
}

export function enemyPos(id) {
  const r = enemyMap.get(id);
  return r ? { x: r.group.position.x, z: r.group.position.z } : null;
}
