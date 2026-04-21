import { renderer, scene, camera, SCREEN_FWD, SCREEN_RGT, positionCamera } from './scene.js';
import { buildWorld, slotMap, claimSlotVisual, addModuleData, removeModuleMeshById } from './world.js';
import { makeAvatar, remoteMap, spawnRemote, removeRemote, setRemoteTarget, lerpRemotes } from './avatar.js';
import { buildState, enterBuild, exitBuild, setTool, onBuildMouseMove, onBuildClick } from './build.js';
import { isDown } from './input.js';
import { connect } from './network.js';
import {
  loginForm, loginError,
  hideLogin, showHud, setYouTag, updatePlayerList,
  showPromptButtons, clearPrompt, showBuildBar, hideBuildBar, setActiveTool, toast,
} from './ui.js';

// ─── Game state ───────────────────────────────────────────────────────────────

let me = null;       // { name, color, x, z }
let myAvatar = null;
let net = null;
let others = [];     // other players for UI list

const SPEED = 8;           // m/s
const MOVE_HZ = 12;        // server move updates per second
const MOVE_INTERVAL = 1000 / MOVE_HZ;

// ─── Login ────────────────────────────────────────────────────────────────────

loginForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const pass = document.getElementById('pass').value;
  loginError.textContent = '';
  loginForm.querySelector('button').disabled = true;

  net = connect(name, pass, {
    'login-error': ({ reason }) => {
      loginError.textContent = reason;
      loginForm.querySelector('button').disabled = false;
    },
    kicked: ({ reason }) => {
      toast(reason, 4000);
      setTimeout(() => location.reload(), 3000);
    },
    welcome: ({ you, slots, players, config }) => {
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

    close: () => toast('Disconnected — reload to reconnect.', 8000),
    error: () => { loginError.textContent = 'Connection failed.'; loginForm.querySelector('button').disabled = false; },
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
  const map = { Digit1: 'wall', Digit2: 'door', Digit3: 'window', KeyX: 'remove' };
  if (map[e.code]) { setTool(map[e.code]); setActiveTool(map[e.code]); }
  if (e.code === 'Escape') leaveBuild();
});

function leaveBuild() {
  exitBuild();
  hideBuildBar();
  updateContextPrompt();
}

// ─── Mouse ────────────────────────────────────────────────────────────────────

const gameCanvas = document.getElementById('game');
let pointerDownPos = null;

gameCanvas.addEventListener('pointermove', onBuildMouseMove);

gameCanvas.addEventListener('pointerdown', e => {
  pointerDownPos = { x: e.clientX, y: e.clientY };
});

gameCanvas.addEventListener('pointerup', e => {
  if (!pointerDownPos) return;
  const dx = e.clientX - pointerDownPos.x;
  const dy = e.clientY - pointerDownPos.y;
  pointerDownPos = null;
  if (Math.hypot(dx, dy) > 5) return; // drag, not click

  if (buildState.active) {
    onBuildClick(msg => net?.send(msg));
  }
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
    // Compute movement direction
    _moveDir.x = 0; _moveDir.z = 0;
    if (isDown('KeyW') || isDown('ArrowUp'))    { _moveDir.x += SCREEN_FWD.x; _moveDir.z += SCREEN_FWD.z; }
    if (isDown('KeyS') || isDown('ArrowDown'))  { _moveDir.x -= SCREEN_FWD.x; _moveDir.z -= SCREEN_FWD.z; }
    if (isDown('KeyD') || isDown('ArrowRight')) { _moveDir.x += SCREEN_RGT.x; _moveDir.z += SCREEN_RGT.z; }
    if (isDown('KeyA') || isDown('ArrowLeft'))  { _moveDir.x -= SCREEN_RGT.x; _moveDir.z -= SCREEN_RGT.z; }

    const len = Math.hypot(_moveDir.x, _moveDir.z);
    if (len > 0) {
      me.x += (_moveDir.x / len) * SPEED * dt;
      me.z += (_moveDir.z / len) * SPEED * dt;
      myAvatar.position.set(me.x, 0, me.z);
      myAvatar.rotation.y = Math.atan2(_moveDir.x, _moveDir.z);
    }

    positionCamera(myAvatar.position);

    if (timeMs - lastMoveAt > MOVE_INTERVAL) {
      net?.send({ type: 'move', x: me.x, z: me.z });
      lastMoveAt = timeMs;
    }

    updateContextPrompt();
  }

  lerpRemotes(dt);
  renderer.render(scene, camera);
}
