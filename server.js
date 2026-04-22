import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const STATE_FILE = path.join(__dirname, 'state.json');
const PASSCODE = 'xiao';
const AUTOSAVE_MS = 30_000;

const SLOT_SIZE = 40;      // meters per slot edge
const ROAD_WIDTH = 6;
const SLOT_ROWS = 2;
const SLOT_COLS = 5;

function createInitialSlots() {
  const slots = [];
  const pitchX = SLOT_SIZE + ROAD_WIDTH;
  const pitchZ = SLOT_SIZE + ROAD_WIDTH + 4;
  for (let row = 0; row < SLOT_ROWS; row++) {
    for (let col = 0; col < SLOT_COLS; col++) {
      slots.push({
        id: `slot-${row}-${col}`,
        x: (col - (SLOT_COLS - 1) / 2) * pitchX,
        z: (row - (SLOT_ROWS - 1) / 2) * pitchZ,
        size: SLOT_SIZE,
        ownerName: null,
        modules: [],
      });
    }
  }
  return slots;
}

let state;
try {
  const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const expectedCount = SLOT_ROWS * SLOT_COLS;
  const sameShape = Array.isArray(loaded.slots)
    && loaded.slots.length === expectedCount
    && loaded.slots[0]?.size === SLOT_SIZE;

  if (sameShape) {
    state = loaded;
  } else {
    // Slot size or layout changed: regenerate, but preserve ownership
    // so returning players keep their claim. Modules are cleared because
    // their grid coords were sized for the old layout.
    console.warn('[ourtown] slot layout changed; preserved ownership, cleared modules.');
    const freshSlots = createInitialSlots();
    const oldById = new Map((loaded.slots || []).map(s => [s.id, s]));
    for (const s of freshSlots) {
      const old = oldById.get(s.id);
      if (old?.ownerName) s.ownerName = old.ownerName;
    }
    state = { slots: freshSlots };
  }
} catch {
  state = { slots: createInitialSlots() };
}

let dirty = false;
function markDirty() { dirty = true; }
function saveStateSync() {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE);
  dirty = false;
}
setInterval(() => { if (dirty) { try { saveStateSync(); } catch (e) { console.error('save failed', e); } } }, AUTOSAVE_MS);
process.on('SIGINT', () => { try { saveStateSync(); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { saveStateSync(); } catch {} process.exit(0); });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const PUBLIC_DIR = path.join(__dirname, 'public');
const THREE_FILE = path.join(__dirname, 'node_modules', 'three', 'build', 'three.module.js');

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  let filePath;
  if (urlPath === '/vendor/three.module.js') {
    filePath = THREE_FILE;
  } else {
    filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });

// playerName -> { ws, name, x, z, color }
const players = new Map();

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg, exceptWs) {
  const str = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c !== exceptWs && c.readyState === 1) c.send(str); });
}

function colorFromName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 131 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 55%)`;
}

function sanitizeModule(m, slot) {
  if (!m || typeof m !== 'object') return null;
  const kind = String(m.kind);
  if (!['wall', 'door', 'window', 'tree', 'pathway'].includes(kind)) return null;
  const ex = Number(m.ex), ez = Number(m.ez);
  if (!Number.isInteger(ex) || !Number.isInteger(ez)) return null;

  const cells = Math.round(slot.size / 2);
  const orient = m.orient;

  if (kind === 'tree' || kind === 'pathway') {
    if (orient !== 'c') return null;
    if (ex < 0 || ex >= cells || ez < 0 || ez >= cells) return null;
  } else {
    if (orient !== 'x' && orient !== 'z') return null;
    const maxEx = orient === 'x' ? cells - 1 : cells;
    const maxEz = orient === 'x' ? cells : cells - 1;
    if (ex < 0 || ez < 0 || ex > maxEx || ez > maxEz) return null;
  }

  return {
    id: Math.random().toString(36).slice(2, 10),
    kind, ex, ez, orient,
  };
}

wss.on('connection', (ws) => {
  let me = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'login') {
      if (msg.passcode !== PASSCODE) {
        send(ws, { type: 'login-error', reason: 'Wrong passcode.' });
        return;
      }
      const name = String(msg.name || '').trim().slice(0, 24);
      if (!/^[A-Za-z0-9 _-]{1,24}$/.test(name)) {
        send(ws, { type: 'login-error', reason: 'Name must be 1-24 letters, numbers, space, - or _.' });
        return;
      }
      // Kick a previous connection for the same name, if any.
      const prev = players.get(name);
      if (prev && prev.ws !== ws && prev.ws.readyState === 1) {
        send(prev.ws, { type: 'kicked', reason: 'Logged in from another tab.' });
        try { prev.ws.close(); } catch {}
      }
      me = { ws, name, x: 0, z: 0, color: colorFromName(name) };
      // Spawn near owned slot, if any; else on the central road.
      const own = state.slots.find(s => s.ownerName === name);
      if (own) { me.x = own.x; me.z = own.z + own.size / 2 + 3; }
      players.set(name, me);

      send(ws, {
        type: 'welcome',
        you: publicPlayer(me),
        slots: state.slots,
        players: Array.from(players.values(), publicPlayer).filter(p => p.name !== name),
        config: { SLOT_SIZE, ROAD_WIDTH, SLOT_ROWS, SLOT_COLS },
      });
      broadcast({ type: 'player-joined', player: publicPlayer(me) }, ws);
      return;
    }

    if (!me) return;

    if (msg.type === 'move') {
      const x = Number(msg.x), z = Number(msg.z);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      me.x = clamp(x, -500, 500);
      me.z = clamp(z, -500, 500);
      broadcast({ type: 'player-moved', name: me.name, x: me.x, z: me.z }, ws);
      return;
    }

    if (msg.type === 'claim-slot') {
      const slot = state.slots.find(s => s.id === msg.slotId);
      if (!slot) return;
      if (slot.ownerName) { send(ws, { type: 'claim-error', reason: 'Slot already claimed.' }); return; }
      if (state.slots.some(s => s.ownerName === me.name)) {
        send(ws, { type: 'claim-error', reason: 'You already own a home.' });
        return;
      }
      slot.ownerName = me.name;
      markDirty();
      broadcast({ type: 'slot-claimed', slotId: slot.id, ownerName: me.name });
      return;
    }

    if (msg.type === 'place-module') {
      const slot = state.slots.find(s => s.id === msg.slotId);
      if (!slot || slot.ownerName !== me.name) return;
      const mod = sanitizeModule(msg.module, slot);
      if (!mod) return;
      // Replace any existing module on the same edge.
      slot.modules = slot.modules.filter(m => !(m.ex === mod.ex && m.ez === mod.ez && m.orient === mod.orient));
      slot.modules.push(mod);
      markDirty();
      broadcast({ type: 'module-placed', slotId: slot.id, module: mod });
      return;
    }

    if (msg.type === 'remove-module') {
      const slot = state.slots.find(s => s.id === msg.slotId);
      if (!slot || slot.ownerName !== me.name) return;
      const before = slot.modules.length;
      slot.modules = slot.modules.filter(m => m.id !== msg.moduleId);
      if (slot.modules.length !== before) {
        markDirty();
        broadcast({ type: 'module-removed', slotId: slot.id, moduleId: msg.moduleId });
      }
      return;
    }
  });

  ws.on('close', () => {
    if (me && players.get(me.name) && players.get(me.name).ws === ws) {
      players.delete(me.name);
      broadcast({ type: 'player-left', name: me.name });
    }
  });
});

function publicPlayer(p) { return { name: p.name, x: p.x, z: p.z, color: p.color }; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

server.listen(PORT, () => console.log(`Our Town listening on http://localhost:${PORT}`));
