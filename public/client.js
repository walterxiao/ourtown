import { renderer, scene, camera, SCREEN_FWD, SCREEN_RGT, positionCamera } from './scene.js';
import { buildWorld, slotMap, claimSlotVisual, addModuleData, removeModuleMeshById, isPositionBlocked } from './world.js';
import { makeAvatar, remoteMap, spawnRemote, removeRemote, setRemoteTarget, lerpRemotes } from './avatar.js';
import { buildState, enterBuild, exitBuild, setTool, onBuildPointerMove, onBuildPointerDown, onBuildPointerUp } from './build.js';
import { isDown } from './input.js';
import { connect } from './network.js';
import {
  loginForm, loginError,
  hideLogin, showHud, setYouTag, updatePlayerList,
  showPromptButtons, clearPrompt, showBuildBar, hideBuildBar, setActiveTool, toast,
} from './ui.js';

// Signal to the fallback in index.html that the module graph loaded successfully.
window.__OURTOWN_READY__ = true;
const _loadStatus = document.getElementById('loadStatus');
if (_loadStatus) _loadStatus.remove();

// ─── Game state ───────────────────────────────────────────────────────────────

let me = null;       // { name, color, x, z }
let myAvatar = null;
let net = null;
let others = [];     // other players for UI list

const SPEED = 12;          // m/s (scaled up for the larger 80 m lots)
const MOVE_HZ = 12;        // server move updates per second
const MOVE_INTERVAL = 1000 / MOVE_HZ;

// ─── Login ────────────────────────────────────────────────────────────────────

console.log('[ourtown] client module loaded');

loginForm.addEventListener('submit', e => {
  e.preventDefault();
  console.log('[ourtown] submit clicked');
  const name = document.getElementById('name').value.trim();
  const pass = document.getElementById('pass').value;
  loginError.textContent = 'Connecting…';
  loginForm.querySelector('button').disabled = true;

  net = connect(name, pass, {
    open: () => { console.log('[ourtown] ws open'); loginError.textContent = 'Logging in…'; },
    'login-error': ({ reason }) => {
      console.warn('[ourtown] login-error:', reason);
      loginError.textContent = reason;
      loginForm.querySelector('button').disabled = false;
    },
    kicked: ({ reason }) => {
      toast(reason, 4000);
      setTimeout(() => location.reload(), 3000);
    },
    welcome: (msg) => {
      console.log('[ourtown] welcome', msg);
      try {
        const { you, slots, players, config } = msg;
        me = { name: you.name, color: you.color, x: you.x, z: you.z };
        others = players.filter(p => p.name !== me.name);

        hideLogin();
        showHud();
        setYouTag(me.name, me.color);
        updatePlayerList(others);

        buildWorld(slots, config);

        myAvatar = makeAvatar(me.name, me.color, true);
        myAvatar.position.set(me.x, 0, me.z);
        positionCamera(myAvatar.position);

        for (const p of others) spawnRemote(p);
        renderer.setAnimationLoop(tick);
      } catch (err) {
        console.error('[ourtown] welcome handler threw:', err);
        loginError.textContent = 'Init error: ' + err.message;
        loginForm.querySelector('button').disabled = false;
      }
    },

    'player-joined': ({ player }) => {
      if (player.name === me?.name) return;
      others = others.filter(p => p.name !== player.name);
      others.push(player);
      updatePlayerList(others);
      spawnRemote(player);
      toast(`${player.name} joined`);
    },
    'player-left': ({ name }) => {
      others = others.filter(p => p.name !== name);
      updatePlayerList(others);
      removeRemote(name);
      toast(`${name} left`);
    },
    'player-moved': ({ name, x, z }) => {
      if (name === me?.name) return;
      setRemoteTarget(name, x, z);
    },
    'slot-claimed': ({ slotId, ownerName }) => {
      claimSlotVisual(slotId, ownerName);
      toast(ownerName === me?.name ? 'You claimed your home!' : `${ownerName} claimed a home`);
    },
    'module-placed':  ({ slotId, module })   => addModuleData(slotId, module),
    'module-removed': ({ slotId, moduleId }) => removeModuleMeshById(slotId, moduleId),
    'claim-error': ({ reason }) => toast(reason),

    close: (ev) => {
      console.warn('[ourtown] ws close', ev);
      if (!me) {
        loginError.textContent = 'Connection closed before login completed.';
        loginForm.querySelector('button').disabled = false;
      } else {
        toast('Disconnected — reload to reconnect.', 8000);
      }
    },
    error: (ev) => {
      console.error('[ourtown] ws error', ev);
      loginError.textContent = 'Connection failed. Is the server running?';
      loginForm.querySelector('button').disabled = false;
    },
  });
});

// ─── Build bar toolbar buttons ────────────────────────────────────────────────

document.querySelectorAll('#buildBar .tool').forEach(btn => {
  btn.addEventListener('click', () => {
    setTool(btn.dataset.tool);
    setActiveTool(btn.dataset.tool);
  });
});

document.getElementById('exitBuild').addEventListener('click', leaveBuild);

// ─── Keyboard shortcuts (build mode) ─────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (!buildState.active) return;
  const map = { Digit1: 'wall', Digit2: 'door', Digit3: 'window', Digit4: 'tree', Digit5: 'pathway', KeyX: 'remove' };
  if (map[e.code]) { setTool(map[e.code]); setActiveTool(map[e.code]); }
  if (e.code === 'Escape') leaveBuild();
});

function leaveBuild() {
  exitBuild();
  hideBuildBar();
  updateContextPrompt();
}

// ─── Mouse ────────────────────────────────────────────────────────────────────
// In build mode:
//   - Mouse move without drag: shows a single-item hover preview
//   - Mouse down + drag: shows a ghost preview of every item that would be
//     placed along the line from start to current cursor
//   - Mouse up: commits all ghosted items as a single batch to the server

const gameCanvas = document.getElementById('game');

gameCanvas.addEventListener('pointermove', e => {
  onBuildPointerMove(e);
});

gameCanvas.addEventListener('pointerdown', e => {
  if (!buildState.active) return;
  try { gameCanvas.setPointerCapture(e.pointerId); } catch {}
  onBuildPointerDown(e);
});

// Listen on document so releasing off-canvas still commits cleanly.
document.addEventListener('pointerup', () => {
  onBuildPointerUp(msg => net?.send(msg));
});

// ─── Context prompt (claim / build) ──────────────────────────────────────────

function getNearbySlot() {
  if (!me) return null;
  let best = null, bestDist = Infinity;
  for (const entry of slotMap.values()) {
    const dx = me.x - entry.data.x;
    const dz = me.z - entry.data.z;
    const dist = Math.hypot(dx, dz);
    const thresh = entry.data.size / 2 + 5;
    if (dist < thresh && dist < bestDist) { best = entry; bestDist = dist; }
  }
  return best;
}

let _lastNearSlotId = null;
function updateContextPrompt() {
  if (buildState.active) return;
  const near = getNearbySlot();
  const id = near?.data.id ?? null;
  if (id === _lastNearSlotId) return;
  _lastNearSlotId = id;
  clearPrompt();

  if (!near) return;
  const s = near.data;

  if (!s.ownerName) {
    showPromptButtons([{
      label: 'Claim this home',
      onClick: () => net?.send({ type: 'claim-slot', slotId: s.id }),
    }]);
  } else if (s.ownerName === me?.name) {
    showPromptButtons([{
      label: 'Build',
      onClick: () => {
        enterBuild(s.id);
        showBuildBar();
        setActiveTool('wall');
        setTool('wall');
        clearPrompt();
        _lastNearSlotId = null;
      },
    }]);
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

let lastTime = null;
let lastMoveAt = 0;
const _moveDir = { x: 0, z: 0 };

function tick(timeMs) {
  if (lastTime === null) lastTime = timeMs;
  const dt = Math.min((timeMs - lastTime) / 1000, 0.1);
  lastTime = timeMs;

  if (me && myAvatar) {
    _moveDir.x = 0; _moveDir.z = 0;
    if (isDown('KeyW') || isDown('ArrowUp'))    { _moveDir.x += SCREEN_FWD.x; _moveDir.z += SCREEN_FWD.z; }
    if (isDown('KeyS') || isDown('ArrowDown'))  { _moveDir.x -= SCREEN_FWD.x; _moveDir.z -= SCREEN_FWD.z; }
    if (isDown('KeyD') || isDown('ArrowRight')) { _moveDir.x += SCREEN_RGT.x; _moveDir.z += SCREEN_RGT.z; }
    if (isDown('KeyA') || isDown('ArrowLeft'))  { _moveDir.x -= SCREEN_RGT.x; _moveDir.z -= SCREEN_RGT.z; }

    const len = Math.hypot(_moveDir.x, _moveDir.z);
    if (len > 0) {
      const dx = (_moveDir.x / len) * SPEED * dt;
      const dz = (_moveDir.z / len) * SPEED * dt;

      // Axis-separated collision: try X first, then Z, so you slide along walls.
      if (!isPositionBlocked(me.x + dx, me.z)) me.x += dx;
      if (!isPositionBlocked(me.x, me.z + dz)) me.z += dz;

      myAvatar.position.set(me.x, 0, me.z);
      myAvatar.rotation.y = Math.atan2(_moveDir.x, _moveDir.z);
    }

    if (timeMs - lastMoveAt > MOVE_INTERVAL) {
      net?.send({ type: 'move', x: me.x, z: me.z });
      lastMoveAt = timeMs;
    }

    positionCamera(myAvatar.position);
    updateContextPrompt();
  }

  lerpRemotes(dt);
  renderer.render(scene, camera);
}
