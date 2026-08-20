import {
  getForecastPlaybackState,
  setForecastPlaybackSpeed,
  stopForecastPlayback,
  toggleForecastPlayback
} from './forecast-map-timeline-core.js';
import { getForecastMapFrameSummaries, getForecastMapRuntimeSnapshot } from './forecast-map-runtime.js';
import { state } from './state.js';

export {
  getForecastPlaybackState,
  setForecastPlaybackSpeed,
  stopForecastPlayback,
  toggleForecastPlayback
};

const HK_TIME = new Intl.DateTimeFormat('zh-HK', {
  timeZone:'Asia/Hong_Kong',
  hour:'2-digit',
  minute:'2-digit',
  hour12:false
});
const INFO_HIDE_MS = 4500;

let infoTimer = null;

function timeText(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '—' : HK_TIME.format(date);
}

function windowText(window) {
  const start = new Date(window?.start || '');
  const end = new Date(window?.end || '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';
  return `${HK_TIME.format(start)}–${HK_TIME.format(end)}`;
}

function ensureMapFirstTimelinePosition() {
  if (document.getElementById('forecast-map-fullscreen-position-style')) return;
  const style = document.createElement('style');
  style.id = 'forecast-map-fullscreen-position-style';
  style.textContent = `
    body.rain-home-v2.rain-map-view .pivot-content-wrapper{flex:1 1 0!important;height:auto!important;min-height:0!important;overflow:hidden!important}
    body.rain-home-v2.rain-map-view #map-container,body.rain-home-v2.rain-map-view #rain-map{height:100%!important;min-height:0!important;overflow:hidden!important}
    #forecast-map-timeline.forecast-map-timeline{position:absolute!important;left:12px!important;right:12px!important;width:auto!important;max-width:none!important;bottom:calc(12px + var(--safe-bottom))!important;z-index:1220!important}
    #forecast-map-timeline #forecast-map-title,#forecast-map-timeline #forecast-map-unit,#forecast-map-timeline #forecast-map-window,#forecast-map-timeline #forecast-map-counter,#forecast-map-timeline #forecast-map-issued,#forecast-map-timeline .forecast-map-legend-title{display:none!important}
    .forecast-product-head{display:flex;align-items:center;gap:7px;min-width:0}.forecast-product-title{color:#e8eff2;font-size:.78rem;font-weight:650;white-space:nowrap}.forecast-info-button{display:inline-flex;align-items:center;justify-content:center;width:25px;height:25px;padding:0;border:1px solid #3f5966;background:#081016;color:#9bdcff;font-size:.75rem;line-height:1}.forecast-info-button[aria-expanded="true"]{border-color:#22a7e0;background:#08202c;color:#fff}.forecast-map-product-meta{margin-top:5px;color:#738188;font-size:.58rem;line-height:1.25}.forecast-map-product-legend-title{margin-right:2px;color:#c0c5c8}.forecast-map-info-note{position:absolute;right:0;bottom:calc(100% + 8px);width:min(390px,calc(100vw - 32px));padding:10px 12px;border:1px solid #365f73;background:rgba(2,10,14,.97);color:#d6e6ed;font-size:.7rem;line-height:1.5;box-shadow:0 6px 18px rgba(0,0,0,.45);z-index:1230}.forecast-map-info-note[hidden]{display:none!important}
    .forecast-mobile-scrubber{display:none;min-width:0;flex:1 1 auto;align-items:center;gap:9px;padding:0 2px}
    .forecast-mobile-scrubber input{width:100%;min-width:0;accent-color:#22a7e0}
    .forecast-mobile-scrubber-output{flex:0 0 88px;color:#eaf7fc;font-size:.7rem;font-weight:650;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    @media(max-width:700px){
      #forecast-map-timeline.forecast-map-timeline{left:8px!important;right:8px!important;bottom:calc(8px + var(--safe-bottom))!important}
      #forecast-map-timeline .forecast-frame-buttons{display:none!important}
      #forecast-map-timeline .forecast-mobile-scrubber{display:flex}
      #forecast-map-timeline .forecast-frame-control{align-items:center;margin:6px 0 5px}
      #forecast-map-timeline .forecast-map-legend{font-size:.58rem}
      .forecast-product-title{font-size:.72rem}.forecast-info-button{width:23px;height:23px}.forecast-map-product-meta{margin-top:4px;font-size:.55rem}.forecast-map-info-note{right:0;width:min(360px,calc(100vw - 24px));font-size:.68rem}
    }
  `;
  document.head.append(style);
}

function frameOutput(frame) {
  if (!frame) return '—';
  const lead = Number(frame.leadMinutes);
  return Number.isFinite(lead) ? `${timeText(frame.time)} · +${lead}` : timeText(frame.time);
}

function infoText(snapshot) {
  const swirls = snapshot?.source === 'swirls';
  const selected = snapshot?.selectedFrame;
  const selectedWindow = windowText(selected?.window);
  if (swirls) {
    return `時間點相隔 6 分鐘。雨量數值代表截至所選有效時間的 30 分鐘累積預測雨量。所選時段：${selectedWindow}。`;
  }
  return `目前使用 30 分鐘後備預報。雨量數值代表所選時段的 30 分鐘累積預測雨量。所選時段：${selectedWindow}。`;
}

function hideForecastInfo() {
  if (infoTimer) clearTimeout(infoTimer);
  infoTimer = null;
  const note = document.getElementById('forecast-map-info-note');
  const button = document.getElementById('forecast-map-info-button');
  if (note) note.hidden = true;
  button?.setAttribute('aria-expanded', 'false');
}

function showForecastInfo() {
  const note = document.getElementById('forecast-map-info-note');
  const button = document.getElementById('forecast-map-info-button');
  if (!note || !button) return;
  note.textContent = infoText(getForecastMapRuntimeSnapshot());
  note.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  if (infoTimer) clearTimeout(infoTimer);
  infoTimer = setTimeout(hideForecastInfo, INFO_HIDE_MS);
}

function toggleForecastInfo() {
  const note = document.getElementById('forecast-map-info-note');
  if (!note) return;
  if (note.hidden) showForecastInfo();
  else hideForecastInfo();
}

function ensureProductHud() {
  const panel = document.getElementById('forecast-map-timeline');
  if (!panel) return null;

  const head = panel.querySelector('.forecast-map-head');
  if (head && !head.querySelector('#forecast-product-head')) {
    const product = document.createElement('span');
    product.id = 'forecast-product-head';
    product.className = 'forecast-product-head';
    product.innerHTML = `
      <span class="forecast-product-title">兩小時預報</span>
      <button id="forecast-map-info-button" class="forecast-info-button" type="button" aria-label="查看預報資料說明" aria-expanded="false">ⓘ</button>`;
    head.append(product);
  }

  const legend = panel.querySelector('.forecast-map-legend');
  if (legend && !legend.querySelector('.forecast-map-product-legend-title')) {
    const title = document.createElement('span');
    title.className = 'forecast-map-product-legend-title';
    title.textContent = '雨量';
    legend.prepend(title);
  }

  let meta = panel.querySelector('#forecast-map-product-meta');
  if (!meta) {
    meta = document.createElement('div');
    meta.id = 'forecast-map-product-meta';
    meta.className = 'forecast-map-product-meta';
    panel.append(meta);
  }

  let note = panel.querySelector('#forecast-map-info-note');
  if (!note) {
    note = document.createElement('div');
    note.id = 'forecast-map-info-note';
    note.className = 'forecast-map-info-note';
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
    note.hidden = true;
    panel.append(note);
  }

  const infoButton = panel.querySelector('#forecast-map-info-button');
  if (infoButton && !infoButton.dataset.bound) {
    infoButton.dataset.bound = 'true';
    infoButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      toggleForecastInfo();
    });
  }

  return panel;
}

function syncProductHud(snapshot = getForecastMapRuntimeSnapshot()) {
  const panel = ensureProductHud();
  if (!panel) return;
  const meta = panel.querySelector('#forecast-map-product-meta');
  if (meta) {
    const source = snapshot?.source === 'swirls' ? 'SWIRLS' : '後備預報';
    meta.textContent = `${source} · 基準 ${timeText(snapshot?.issueTime)}`;
  }
  const note = panel.querySelector('#forecast-map-info-note');
  if (note && !note.hidden) note.textContent = infoText(snapshot);
}

function ensureMobileScrubber() {
  const panel = document.getElementById('forecast-map-timeline');
  const control = panel?.querySelector('.forecast-frame-control');
  if (!panel || !control) return null;
  let root = panel.querySelector('#forecast-mobile-scrubber');
  if (root) return root;

  root = document.createElement('div');
  root.id = 'forecast-mobile-scrubber';
  root.className = 'forecast-mobile-scrubber';
  root.innerHTML = `
    <input id="forecast-mobile-range" type="range" min="0" max="15" step="1" value="0" aria-label="選擇兩小時預報有效時間">
    <output id="forecast-mobile-output" class="forecast-mobile-scrubber-output" for="forecast-mobile-range">—</output>`;
  control.append(root);

  const range = root.querySelector('#forecast-mobile-range');
  const output = root.querySelector('#forecast-mobile-output');
  range?.addEventListener('input', () => {
    const frames = getForecastMapFrameSummaries();
    if (output) output.textContent = frameOutput(frames[Number(range.value)]);
  });
  range?.addEventListener('change', () => {
    const snapshot = getForecastMapRuntimeSnapshot();
    const targetIndex = Number(range.value);
    if (!Number.isInteger(targetIndex) || targetIndex === snapshot.index) return;
    stopForecastPlayback();
    const target = panel.querySelector(`[data-forecast-index="${targetIndex}"]`);
    if (target && !target.disabled) target.click();
    else syncMobileScrubber();
  });
  return root;
}

function syncMobileScrubber() {
  const root = ensureMobileScrubber();
  if (!root) return;
  const snapshot = getForecastMapRuntimeSnapshot();
  const frames = getForecastMapFrameSummaries();
  const range = root.querySelector('#forecast-mobile-range');
  const output = root.querySelector('#forecast-mobile-output');
  if (!range) return;
  range.max = String(Math.max(0, frames.length - 1));
  range.value = String(Math.max(0, Math.min(frames.length - 1, Number(snapshot.index) || 0)));
  range.disabled = !snapshot.ready || !snapshot.visible || frames.length < 2;
  if (output) output.textContent = frameOutput(frames[Number(range.value)]);
}

function refreshForecastMapViewport() {
  state.map?.invalidateSize?.({ pan:false, animate:false });
}

function syncForecastHud(snapshot = getForecastMapRuntimeSnapshot()) {
  ensureMobileScrubber();
  syncMobileScrubber();
  syncProductHud(snapshot);
}

function initForecastTimelinePolish() {
  ensureMapFirstTimelinePosition();
  ensureProductHud();
  syncForecastHud();
  window.addEventListener('rain:forecast-map-frame-change', event => {
    syncForecastHud(event.detail?.snapshot || getForecastMapRuntimeSnapshot());
  });
  window.addEventListener('rain:map-mode-change', event => {
    if (event.detail?.mode !== 'forecast') hideForecastInfo();
    syncForecastHud();
    requestAnimationFrame(refreshForecastMapViewport);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideForecastInfo();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hideForecastInfo();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initForecastTimelinePolish, { once:true });
} else {
  initForecastTimelinePolish();
}
