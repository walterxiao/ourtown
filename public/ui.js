const $ = id => document.getElementById(id);

export const loginEl    = $('login');
export const loginForm  = $('loginForm');
export const nameInput  = $('name');
export const passInput  = $('pass');
export const loginError = $('loginError');

export function hideLogin() { loginEl.hidden = true; }
export function showHud()   { $('hud').hidden = false; }

export function setYouTag(name, color) {
  $('youTag').innerHTML = `<span style="color:${color}">&#9679;</span> ${esc(name)}`;
}

export function updatePlayerList(players) {
  const html = players
    .map(p => `<span style="color:${p.color}">&#9679; ${esc(p.name)}</span>`)
    .join('&ensp;');
  $('playerList').innerHTML = html || 'No one else here';
}

export function showPromptButtons(btns) {
  const bar = $('promptBar');
  bar.innerHTML = '';
  for (const b of btns) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    btn.addEventListener('click', b.onClick);
    bar.appendChild(btn);
  }
}

export function clearPrompt() { $('promptBar').innerHTML = ''; }

export function showBuildBar() { $('buildBar').hidden = false; }
export function hideBuildBar() { $('buildBar').hidden = true; }

export function setActiveTool(kind) {
  document.querySelectorAll('#buildBar .tool').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === kind);
  });
}

let _toastTimer = null;
export function toast(msg, ms = 2500) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
