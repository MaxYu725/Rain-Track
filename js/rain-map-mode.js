import { getForecastPlaybackState, setForecastPlaybackSpeed, stopForecastPlayback, toggleForecastPlayback } from './forecast-map-timeline.js';
import { state } from './state.js';
import { clearRadar, toggleRadar } from './radar.js';
import { clearForecastMap, getForecastMapRuntimeSnapshot, loadForecastMap, setForecastMapOpacity } from './forecast-map-runtime.js';
import { toast } from './ui.js';

const MODES = new Set(['off', 'radar', 'forecast']);
const DEFAULT_FORECAST_OPACITY = 72;

let activeMode = 'off';
let pendingMode = null;
let busy = false;
let sequence = 0;
let controlsReady = false;
let legacyObserver = null;
let lastNotifiedMode = null;
let forecastOpacity = normalizeForecastOpacity(localStorage.getItem('hkRainForecastOpacity'));
let forecastAutoplay = localStorage.getItem('hkRainForecastAutoplay') === '1';

function normalizeMode(value) {
  return MODES.has(value) ? value : 'off';
}

function normalizeForecastOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_FORECAST_OPACITY;
  return Math.max(20, Math.min(100, Math.round(number)));
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
  const heading = section?.querySelector(':scope > .settings-section-heading .panel-title, :scope > .panel-title');
  const intro = section?.querySelector(':scope > .settings-section-heading p');
  if (heading) heading.textContent = '雨勢圖層';
  if (intro) intro.textContent = '雷達觀測與兩小時預報使用各自獨立設定。';
}

function forecastStatusText() {
  const snapshot = getForecastMapRuntimeSnapshot();
  if (snapshot.source === 'swirls') return '顯示 HKO SWIRLS 未來兩小時預報：每 6 分鐘一個有效時間，每格為 30 分鐘累積雨量。';
  if (snapshot.source === 'nowcast-fallback') return 'SWIRLS 暫不可用，現正顯示原有 30 分鐘兩小時預報後備資料。';
  return '正在準備未來兩小時降雨預報。';
}

function ensureSettingsStyles() {
  if (document.getElementById('rain-mode-settings-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-mode-settings-style';
  style.textContent = `
    .rain-mode-settings-panel{margin-top:12px;padding-top:11px;border-top:1px solid #29333a}.rain-mode-settings-panel.hidden{display:none}.rain-mode-settings-heading{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 9px}.rain-mode-settings-title{color:#22a7e0;font-size:.85rem;font-weight:700}.rain-mode-settings-heading small{color:#727d83;font-size:.58rem;text-align:right}.rain-forecast-play-action{margin-top:8px}.rain-forecast-play-action.playing{border-color:#277ca6;background:#08202c;color:#f4fbff;box-shadow:inset 0 -2px 0 #22a7e0}.rain-forecast-autoplay-row{margin-top:5px}.rain-mode-settings-panel .settings-compact-note{margin-top:8px}
  `;
  document.head.append(style);
}

function ensureSettingsPanels(legacyToggle) {
  const section = legacyToggle?.closest('.settings-section');
  const commonStatus = document.getElementById('rain-map-mode-status');
  if (!section || !commonStatus) return;
  ensureSettingsStyles();

  let radarPanel = document.getElementById('rain-radar-settings');
  if (!radarPanel) {
    radarPanel = document.createElement('div');
    radarPanel.id = 'rain-radar-settings';
    radarPanel.className = 'rain-mode-settings-panel hidden';
    radarPanel.innerHTML = '<div class="rain-mode-settings-heading"><span class="rain-mode-settings-title">雷達設定</span><small>只影響雷達觀測</small></div>';
    commonStatus.insertAdjacentElement('afterend', radarPanel);
  }

  const radarItems = [
    document.getElementById('radar-range')?.closest('.setting-row'),
    document.getElementById('radar-height-row'),
    document.getElementById('radar-opacity')?.closest('.setting-row'),
    document.getElementById('radar-data-mode')?.closest('.setting-row'),
    document.getElementById('radar-speed')?.closest('.setting-row'),
    document.getElementById('radar-status-note')
  ].filter(Boolean);
  radarItems.forEach(item => {
    if (item.parentElement !== radarPanel) radarPanel.append(item);
  });

  let forecastPanel = document.getElementById('rain-forecast-settings');
  if (!forecastPanel) {
    forecastPanel = document.createElement('div');
    forecastPanel.id = 'rain-forecast-settings';
    forecastPanel.className = 'rain-mode-settings-panel hidden';
    forecastPanel.innerHTML = `
      <div class="rain-mode-settings-heading"><span class="rain-mode-settings-title">2小時預報設定</span><small>只影響預報圖層</small></div>
      <div class="setting-row range-setting">
        <label for="forecast-map-opacity">透明度</label>
        <input id="forecast-map-opacity" type="range" min="20" max="100" value="${forecastOpacity}">
        <span id="forecast-map-opacity-value">${forecastOpacity}%</span>
      </div>
      <div class="setting-row">
        <label for="forecast-playback-speed">播放速度</label>
        <select id="forecast-playback-speed"><option value="1600">慢</option><option value="1000">標準</option><option value="650">快</option></select>
      </div>
      <label class="toggle-row rain-forecast-autoplay-row"><input id="forecast-autoplay-toggle" type="checkbox"><span>進入預報時自動播放</span></label>
      <button id="forecast-settings-play" class="wide-btn rain-forecast-play-action" type="button">▶ 播放兩小時預報</button>
      <div class="panel-note settings-compact-note">SWIRLS 每 6 分鐘一個有效時間；每格仍代表 30 分鐘累積雨量。</div>`;
    radarPanel.insertAdjacentElement('afterend', forecastPanel);

    forecastPanel.querySelector('#forecast-map-opacity')?.addEventListener('input', event => {
      forecastOpacity = normalizeForecastOpacity(event.target.value);
      localStorage.setItem('hkRainForecastOpacity', String(forecastOpacity));
      setForecastMapOpacity(forecastOpacity / 100);
      syncForecastSettings();
    });
    forecastPanel.querySelector('#forecast-playback-speed')?.addEventListener('change', event => {
      setForecastPlaybackSpeed(event.target.value);
      syncForecastSettings();
    });
    forecastPanel.querySelector('#forecast-autoplay-toggle')?.addEventListener('change', event => {
      forecastAutoplay = Boolean(event.target.checked);
      localStorage.setItem('hkRainForecastAutoplay', forecastAutoplay ? '1' : '0');
      if (!forecastAutoplay) stopForecastPlayback();
      else if (activeMode === 'forecast' && !busy) toggleForecastPlayback(true);
      syncForecastSettings();
    });
    forecastPanel.querySelector('#forecast-settings-play')?.addEventListener('click', () => {
      toggleForecastPlayback();
      syncForecastSettings();
    });
  }
}

function syncForecastSettings() {
  const panel = document.getElementById('rain-forecast-settings');
  if (!panel) return;
  const opacity = panel.querySelector('#forecast-map-opacity');
  const opacityValue = panel.querySelector('#forecast-map-opacity-value');
  const speed = panel.querySelector('#forecast-playback-speed');
  const autoplay = panel.querySelector('#forecast-autoplay-toggle');
  const play = panel.querySelector('#forecast-settings-play');
  const playback = getForecastPlaybackState();

  if (opacity) opacity.value = String(forecastOpacity);
  if (opacityValue) opacityValue.textContent = `${forecastOpacity}%`;
  if (speed) speed.value = String(playback.delay);
  if (autoplay) autoplay.checked = forecastAutoplay;
  if (play) {
    play.textContent = playback.playing ? '❚❚ 暫停兩小時預報' : '▶ 播放兩小時預報';
    play.classList.toggle('playing', playback.playing);
    play.setAttribute('aria-pressed', playback.playing ? 'true' : 'false');
    play.disabled = busy || (pendingMode || activeMode) !== 'forecast';
  }
}

function syncModeSpecificSettings(selectedMode, legacyToggle) {
  ensureSettingsPanels(legacyToggle);
  document.getElementById('rain-radar-settings')?.classList.toggle('hidden', selectedMode !== 'radar');
  document.getElementById('rain-forecast-settings')?.classList.toggle('hidden', selectedMode !== 'forecast');
  syncForecastSettings();
}

function syncControls() {
  const { root, buttons, legacyToggle, status } = controls();
  const selectedMode = pendingMode || activeMode;
  const radarAvailable = Boolean(state.worker.capabilities.radarFrames) && !legacyToggle?.disabled;

  syncSectionCopy(legacyToggle);
  syncModeSpecificSettings(selectedMode, legacyToggle);
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
        ? forecastStatusText()
        : activeMode === 'radar'
          ? '顯示 HKO 雷達觀測；下方只顯示雷達專用設定。'
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
  ensureSettingsPanels(legacyToggle);
  document.getElementById('rain-map-mode')?.addEventListener('click', event => {
    const button = event.target.closest('[data-rain-map-mode]');
    if (!button || button.disabled) return;
    setRainMapMode(button.dataset.rainMapMode);
  });

  legacyObserver = new MutationObserver(syncControls);
  legacyObserver.observe(section, { childList:true, subtree:true, attributes:true, attributeFilter:['disabled'] });
  window.addEventListener('rain:forecast-playback-change', syncForecastSettings);
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
      stopForecastPlayback();
      clearForecastMap();
      clearRadar({ restoreSheet:true });
      activeMode = 'off';
      return activeMode;
    }

    if (mode === 'radar') {
      stopForecastPlayback();
      clearForecastMap();
      await toggleRadar(true);
      if (token !== sequence) return activeMode;
      activeMode = state.layers.radar ? 'radar' : 'off';
      return activeMode;
    }

    clearRadar({ restoreSheet:true });
    const snapshot = await loadForecastMap({ frameIndex:0, opacity:forecastOpacity / 100 });
    if (token !== sequence) {
      clearForecastMap();
      return activeMode;
    }
    if (!snapshot?.ready || !snapshot?.visible) throw new Error('兩小時預報圖層未能顯示');
    activeMode = 'forecast';
    return activeMode;
  } catch (error) {
    if (token === sequence) {
      stopForecastPlayback();
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
      if (activeMode === 'forecast' && forecastAutoplay) toggleForecastPlayback(true);
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
