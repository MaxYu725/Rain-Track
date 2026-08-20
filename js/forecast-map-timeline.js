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

function timeText(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '—' : HK_TIME.format(date);
}

function ensureMapFirstTimelinePosition() {
  if (document.getElementById('forecast-map-fullscreen-position-style')) return;
  const style = document.createElement('style');
  style.id = 'forecast-map-fullscreen-position-style';
  style.textContent = `
    body.rain-home-v2.rain-map-view .pivot-content-wrapper{flex:1 1 0!important;height:auto!important;min-height:0!important;overflow:hidden!important}
    body.rain-home-v2.rain-map-view #map-container,body.rain-home-v2.rain-map-view #rain-map{height:100%!important;min-height:0!important;overflow:hidden!important}
    #forecast-map-timeline.forecast-map-timeline{position:absolute!important;left:12px!important;right:12px!important;width:auto!important;max-width:none!important;bottom:calc(12px + var(--safe-bottom))!important;z-index:1220!important}
    .forecast-mobile-scrubber{display:none;min-width:0;flex:1 1 auto;align-items:center;gap:9px;padding:0 2px}
    .forecast-mobile-scrubber input{width:100%;min-width:0;accent-color:#22a7e0}
    .forecast-mobile-scrubber-output{flex:0 0 88px;color:#eaf7fc;font-size:.7rem;font-weight:650;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    @media(max-width:700px){
      #forecast-map-timeline.forecast-map-timeline{left:8px!important;right:8px!important;bottom:calc(8px + var(--safe-bottom))!important}
      #forecast-map-timeline .forecast-frame-buttons{display:none!important}
      #forecast-map-timeline .forecast-mobile-scrubber{display:flex}
      #forecast-map-timeline .forecast-frame-control{align-items:center}
    }
  `;
  document.head.append(style);
}

function frameOutput(frame) {
  if (!frame) return '—';
  const lead = Number(frame.leadMinutes);
  return Number.isFinite(lead) ? `${timeText(frame.time)} · +${lead}` : timeText(frame.time);
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

function initForecastTimelinePolish() {
  ensureMapFirstTimelinePosition();
  ensureMobileScrubber();
  syncMobileScrubber();
  window.addEventListener('rain:forecast-map-frame-change', syncMobileScrubber);
  window.addEventListener('rain:map-mode-change', () => {
    ensureMobileScrubber();
    syncMobileScrubber();
    requestAnimationFrame(refreshForecastMapViewport);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initForecastTimelinePolish, { once:true });
} else {
  initForecastTimelinePolish();
}
