import './forecast-map-timeline.js';
import { state } from './state.js';
import { clearRadar, toggleRadar } from './radar.js';
import { clearForecastMap, loadForecastMap } from './forecast-map-runtime.js';
import { toast } from './ui.js';

const MODES = new Set(['off', 'radar', 'forecast']);

let activeMode = 'off';
let pendingMode = null;
let busy = false;
let sequence = 0;
let controlsReady = false;
let legacyObserver = null;
let lastNotifiedMode = null;

function normalizeMode(value) {
  return MODES.has(value) ? value : 'off';
}

function modeLabel(mode = activeMode) {
  if (mode === 'radar') return '雷達';
  if (mode === 'forecast') return '兩小時預報';
  return '關閉';
}

function controls() {
  const root = document.getElementById('rain-map-mode');
  return {
    root,
    buttons:[...(root?.querySelectorAll('[data-rain-map-mode]') || [])],
    legacyToggle:document.getElementById('toggle-radar'),
    status:document.getElementById('rain-map-mode-status')
  };
}

function syncSectionCopy(legacyToggle) {
  const section = legacyToggle?.closest('.settings-section');
  const heading = section?.querySelector('.panel-title');
  const intro = section?.querySelector('.settings-section-heading p');
  if (heading) heading.textContent = '雨勢圖層';
  if (intro) intro.textContent = '切換雷達觀測或未來兩小時降雨預報。';
}

function syncControls() {
  const { root, buttons, legacyToggle, status } = controls();
  const selectedMode = pendingMode || activeMode;
  const radarAvailable = Boolean(state.worker.capabilities.radarFrames) && !legacyToggle?.disabled;

  syncSectionCopy(legacyToggle);
  root?.setAttribute('aria-busy', busy ? 'true' : 'false');
  buttons.forEach(button => {
    const mode = normalizeMode(button.dataset.rainMapMode);
    const selected = mode === selectedMode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    button.disabled = busy || (mode === 'radar' && !radarAvailable);
  });

  if (legacyToggle) legacyToggle.checked = activeMode === 'radar';
  if (status) {
    status.textContent = busy
      ? `正在切換至${modeLabel(selectedMode)}…`
      : activeMode === 'forecast'
        ? '顯示官方未來兩小時格點降雨預報。'
        : activeMode === 'radar'
          ? '顯示 HKO 雷達觀測；可在下方調整範圍、高度及動畫。'
          : '雨勢圖層已關閉。';
  }
}

function notifyModeChange() {
  if (lastNotifiedMode === activeMode) return;
  lastNotifiedMode = activeMode;
  window.dispatchEvent(new CustomEvent('rain:map-mode-change', { detail:{ mode:activeMode } }));
}

function injectControls() {
  if (controlsReady) return;
  const legacyToggle = document.getElementById('toggle-radar');
  const legacyRow = legacyToggle?.closest('.toggle-row');
  const section = legacyRow?.closest('section');
  if (!legacyToggle || !legacyRow || !section) return;

  legacyRow.classList.add('hidden');

  if (!document.getElementById('rain-map-mode')) {
    const row = document.createElement('div');
    row.className = 'setting-row rain-map-mode-row';
    row.innerHTML = `
      <label>雨勢圖層</label>
      <div id="rain-map-mode" class="segmented-control rain-map-mode-control" role="group" aria-label="雨勢圖層模式">
        <button type="button" class="segment-btn active" data-rain-map-mode="off" aria-pressed="true">關閉</button>
        <button type="button" class="segment-btn" data-rain-map-mode="radar" aria-pressed="false">雷達</button>
        <button type="button" class="segment-btn" data-rain-map-mode="forecast" aria-pressed="false">2小時預報</button>
      </div>`;
    legacyRow.insertAdjacentElement('beforebegin', row);

    const status = document.createElement('div');
    status.id = 'rain-map-mode-status';
    status.className = 'panel-note settings-compact-note';
    status.textContent = '雨勢圖層已關閉。';
    row.insertAdjacentElement('afterend', status);
  }

  syncSectionCopy(legacyToggle);
  document.getElementById('rain-map-mode')?.addEventListener('click', event => {
    const button = event.target.closest('[data-rain-map-mode]');
    if (!button || button.disabled) return;
    setRainMapMode(button.dataset.rainMapMode);
  });

  legacyObserver = new MutationObserver(syncControls);
  legacyObserver.observe(legacyToggle, { attributes:true, attributeFilter:['disabled'] });
  controlsReady = true;
  syncControls();
  notifyModeChange();
}

export async function setRainMapMode(requestedMode) {
  const mode = normalizeMode(requestedMode);
  const token = ++sequence;
  pendingMode = mode;
  busy = true;
  syncControls();

  try {
    if (mode === 'off') {
      clearForecastMap();
      clearRadar({ restoreSheet:true });
      activeMode = 'off';
      return activeMode;
    }

    if (mode === 'radar') {
      clearForecastMap();
      await toggleRadar(true);
      if (token !== sequence) return activeMode;
      activeMode = state.layers.radar ? 'radar' : 'off';
      return activeMode;
    }

    clearRadar({ restoreSheet:true });
    const snapshot = await loadForecastMap({ frameIndex:0 });
    if (token !== sequence) {
      clearForecastMap();
      return activeMode;
    }
    if (!snapshot?.ready || !snapshot?.visible) throw new Error('兩小時預報圖層未能顯示');
    activeMode = 'forecast';
    return activeMode;
  } catch (error) {
    if (token === sequence) {
      clearForecastMap();
      if (mode === 'radar') clearRadar({ restoreSheet:true });
      activeMode = 'off';
      toast(`雨勢圖層載入失敗：${error?.message || error}`);
    }
    return activeMode;
  } finally {
    if (token === sequence) {
      busy = false;
      pendingMode = null;
      syncControls();
      notifyModeChange();
    }
  }
}

export function getRainMapMode() {
  return activeMode;
}

function initRainMapMode() {
  injectControls();
  if (!controlsReady) setTimeout(injectControls, 0);
}

document.addEventListener('DOMContentLoaded', initRainMapMode, { once:true });
