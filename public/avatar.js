import * as THREE from 'three';
import { scene } from './scene.js';
import { makeTextSprite } from './sprites.js';

const LERP = 8; // position lerp speed

export function makeAvatar(name, color, isMe = false) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.2, 8), mat);
  body.position.y = 0.6;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), mat);
  head.position.y = 1.44;
  g.add(head);

  if (!isMe) {
    const label = makeTextSprite(name, color);
    label.position.y = 2.4;
    g.add(label);
  }

  scene.add(g);
  return g;
}

// ─── Remote player manager ────────────────────────────────────────────────────

export const remoteMap = new Map(); // name -> { group, tx, tz }

export function spawnRemote({ name, x, z, color }) {
  if (remoteMap.has(name)) return;
  const group = makeAvatar(name, color, false);
  group.position.set(x, 0, z);
  remoteMap.set(name, { group, tx: x, tz: z });
}

export function removeRemote(name) {
  const r = remoteMap.get(name);
  if (!r) return;
  scene.remove(r.group);
  remoteMap.delete(name);
}

export function setRemoteTarget(name, x, z) {
  const r = remoteMap.get(name);
  if (r) { r.tx = x; r.tz = z; }
}

export function lerpRemotes(dt) {
  const k = Math.min(1, LERP * dt);
  for (const r of remoteMap.values()) {
    r.group.position.x += (r.tx - r.group.position.x) * k;
    r.group.position.z += (r.tz - r.group.position.z) * k;
  }
}
