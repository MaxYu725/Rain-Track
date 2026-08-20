import { getRainMapMode, setRainMapMode } from './rain-map-mode.js';

let entryButton = null;
let busy = false;

function ensureRadarEntryStyles() {
  if (document.getElementById('radar-entry-style')) return;
  const style = document.createElement('style');
  style.id = 'radar-entry-style';
  style.textContent = `
    .radar-entry-button{width:auto!important;min-width:48px!important;padding:0 10px!important;font-size:.74rem!important;font-weight:650!important;letter-spacing:.02em}
    .radar-entry-button.active{border-color:#1aa7df!important;background:#071b24!important;color:#e9f8ff!important;box-shadow:inset 0 -2px 0 #22a7e0}
    .radar-entry-button[aria-busy="true"]{opacity:.62;cursor:progress}
    @media(max-width:430px){.radar-entry-button{min-width:44px!important;padding:0 8px!important;font-size:.7rem!important}}
  `;
  document.head.append(style);
}

function syncRadarEntry(mode = getRainMapMode()) {
  if (!entryButton) return;
  const active = mode === 'radar';
  entryButton.classList.toggle('active', active);
  entryButton.setAttribute('aria-pressed', active ? 'true' : 'false');
  entryButton.title = active ? '返回定位預報' : '查看即時雷達';
  entryButton.setAttribute('aria-label', active ? '關閉即時雷達並返回定位預報' : '查看即時雷達');
  entryButton.textContent = active ? '返回' : '雷達';
}

async function toggleRadarEntry() {
  if (busy) return;
  busy = true;
  entryButton.disabled = true;
  entryButton.setAttribute('aria-busy', 'true');
  const requested = getRainMapMode() === 'radar' ? 'off' : 'radar';
  try {
    const mode = await setRainMapMode(requested);
    syncRadarEntry(mode);
  } finally {
    busy = false;
    entryButton.disabled = false;
    entryButton.setAttribute('aria-busy', 'false');
  }
}

function ensureRadarEntry() {
  if (document.getElementById('radar-entry-button')) {
    entryButton = document.getElementById('radar-entry-button');
    syncRadarEntry();
    return;
  }

  const controls = document.querySelector('.global-controls');
  if (!controls) return;
  ensureRadarEntryStyles();

  entryButton = document.createElement('button');
  entryButton.id = 'radar-entry-button';
  entryButton.className = 'metro-btn radar-entry-button';
  entryButton.type = 'button';
  entryButton.setAttribute('aria-pressed', 'false');
  entryButton.setAttribute('aria-busy', 'false');
  entryButton.textContent = '雷達';
  entryButton.addEventListener('click', () => void toggleRadarEntry());

  const refresh = document.getElementById('refresh-button');
  controls.insertBefore(entryButton, refresh || document.getElementById('drawer-button') || null);
  syncRadarEntry();
}

window.addEventListener('rain:map-mode-change', event => syncRadarEntry(event.detail?.mode || 'off'));

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureRadarEntry, { once:true });
} else {
  ensureRadarEntry();
}
