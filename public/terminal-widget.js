/* Opens Cloudflare's browser-rendered SSH terminal in a native browser window.
   No shell, credentials or tokens are handled by the HomeLab dashboard. */
const HOMELAB_SSH_URL = 'https://homelabssh.thsouza.eng.br/';

function terminalPopupFeatures(display = {}) {
  const dimension = (value, fallback) =>
    Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  const availableWidth = dimension(display.availWidth, 1280);
  const availableHeight = dimension(display.availHeight, 800);
  const offsetLeft = Number.isFinite(display.availLeft) ? display.availLeft : 0;
  const offsetTop = Number.isFinite(display.availTop) ? display.availTop : 0;
  const width = Math.min(980, Math.max(1, availableWidth - 32));
  const height = Math.min(680, Math.max(1, availableHeight - 32));
  const left = Math.round(offsetLeft + (availableWidth - width) / 2);
  const top = Math.round(offsetTop + (availableHeight - height) / 2);
  return 'popup=yes,width=' + width + ',height=' + height +
    ',left=' + left + ',top=' + top +
    ',resizable=yes,scrollbars=yes,noopener,noreferrer';
}

function setupTerminalPopup() {
  const launcher = document.getElementById('terminal-launcher');
  if (!launcher) return;
  launcher.addEventListener('click', event => {
    // Keep the native link behaviour for Ctrl/Meta/Shift clicks and other actions.
    if (event.defaultPrevented || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    // Must be called synchronously from the click to avoid popup blockers.
    window.open(HOMELAB_SSH_URL, '_blank', terminalPopupFeatures(window.screen));
    // Browsers may use a tab instead of a popup, depending on user settings.
    // With noopener, window.open may return null even after a successful opening.
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { terminalPopupFeatures };
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupTerminalPopup, { once: true });
  else setupTerminalPopup();
}
