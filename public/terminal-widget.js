/* Floating SSH widget. The iframe stays on Cloudflare Access: no shell or credentials
   are proxied through the HomeLab Express application. */
const HOMELAB_SSH_URL = 'https://homelabssh.thsouza.eng.br/';

function clampTerminalBounds(rect, viewport, margin = 12) {
  const spaceWidth = Math.max(1, viewport.width - margin * 2);
  const spaceHeight = Math.max(1, viewport.height - margin * 2);
  const minWidth = Math.min(340, spaceWidth);
  const minHeight = Math.min(260, spaceHeight);
  const width = Math.min(spaceWidth, Math.max(minWidth, Number(rect.width) || minWidth));
  const height = Math.min(spaceHeight, Math.max(minHeight, Number(rect.height) || minHeight));
  const left = Math.max(margin, Math.min(viewport.width - margin - width, Number(rect.left) || 0));
  const top = Math.max(margin, Math.min(viewport.height - margin - height, Number(rect.top) || 0));
  return { left, top, width, height };
}

function setupTerminalWidget() {
  const launcher = document.getElementById('terminal-launcher');
  const panel = document.getElementById('terminal-window');
  const frame = document.getElementById('terminal-frame');
  const handle = document.getElementById('terminal-titlebar');
  const resize = document.getElementById('terminal-resize');
  const minimize = document.getElementById('terminal-minimize');
  const maximize = document.getElementById('terminal-maximize');
  const close = document.getElementById('terminal-close');
  const popup = document.getElementById('terminal-popup');
  if (![launcher, panel, frame, handle, resize, minimize, maximize, close, popup].every(Boolean)) return;

  const storageKey = 'homelab.ssh.widget.bounds.v1';
  const margin = 12;
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  let loaded = false;
  let maximized = false;
  let restoreBounds = null;
  let current = null;

  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (stored && ['left', 'top', 'width', 'height'].every(key => Number.isFinite(stored[key]))) current = stored;
  } catch { /* Storage might be blocked. */ }

  if (!current) {
    const { width, height } = viewport();
    const w = Math.min(760, width - margin * 2);
    const h = Math.min(540, height - margin * 2 - 70);
    current = { left: width - w - 20, top: height - h - 88, width: w, height: h };
  }

  function applyBounds(bounds, save = true) {
    current = clampTerminalBounds(bounds, viewport(), margin);
    panel.style.left = current.left + 'px';
    panel.style.top = current.top + 'px';
    panel.style.width = current.width + 'px';
    panel.style.height = current.height + 'px';
    if (save && !maximized) {
      try { sessionStorage.setItem(storageKey, JSON.stringify(current)); } catch {}
    }
  }
  function expanded(value) {
    panel.hidden = !value;
    launcher.setAttribute('aria-expanded', String(value));
    launcher.setAttribute('aria-label', value ? 'Minimizar terminal SSH' : 'Abrir terminal SSH');
    if (value) minimize.focus();
    else launcher.focus();
  }
  function show() {
    if (!maximized) applyBounds(current);
    if (!loaded) {
      // A different Cloudflare Access application may require its own login.
      frame.src = HOMELAB_SSH_URL;
      loaded = true;
    }
    expanded(true);
  }
  function hide() { expanded(false); }
  function disconnect() {
    hide();
    frame.src = 'about:blank';
    loaded = false;
  }
  function toggleMaximize() {
    if (maximized) {
      maximized = false;
      applyBounds(restoreBounds || current);
      maximize.setAttribute('aria-label', 'Maximizar terminal');
      maximize.title = 'Maximizar';
    } else {
      restoreBounds = { ...current };
      maximized = true;
      const view = viewport();
      applyBounds({ left: margin, top: margin, width: view.width - 2 * margin, height: view.height - 2 * margin }, false);
      maximize.setAttribute('aria-label', 'Restaurar tamanho');
      maximize.title = 'Restaurar tamanho';
    }
  }

  function beginPointerManipulation(event, mode) {
    if (event.button !== 0 || maximized) return;
    if (mode === 'move' && event.target.closest('button, a')) return;
    event.preventDefault();
    const surface = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...current };
    surface.setPointerCapture(pointerId);
    const move = next => {
      if (next.pointerId !== pointerId) return;
      const dx = next.clientX - startX;
      const dy = next.clientY - startY;
      applyBounds(mode === 'move'
        ? { ...origin, left: origin.left + dx, top: origin.top + dy }
        : { ...origin, width: origin.width + dx, height: origin.height + dy }, false);
    };
    const end = next => {
      if (next.pointerId !== pointerId) return;
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', end);
      surface.removeEventListener('pointercancel', end);
      if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
      applyBounds(current);
    };
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
  }

  launcher.addEventListener('click', () => panel.hidden ? show() : hide());
  minimize.addEventListener('click', hide);
  maximize.addEventListener('click', toggleMaximize);
  close.addEventListener('click', disconnect);
  handle.addEventListener('pointerdown', event => beginPointerManipulation(event, 'move'));
  resize.addEventListener('pointerdown', event => beginPointerManipulation(event, 'resize'));
  resize.addEventListener('keydown', event => {
    if (maximized || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 50 : 20;
    applyBounds({ ...current,
      width: current.width + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      height: current.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)
    });
  });
  popup.addEventListener('click', () => {
    const win = window.open(HOMELAB_SSH_URL, 'homelab-ssh-popup', 'popup=yes,width=1000,height=650,resizable=yes,scrollbars=yes');
    if (!win) window.open(HOMELAB_SSH_URL, '_blank', 'noopener,noreferrer');
  });
  window.addEventListener('resize', () => {
    if (maximized) {
      const view = viewport();
      applyBounds({ left: margin, top: margin, width: view.width - margin * 2, height: view.height - margin * 2 }, false);
    } else applyBounds(current);
  });
  applyBounds(current);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { clampTerminalBounds };
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupTerminalWidget, { once: true });
  else setupTerminalWidget();
}
