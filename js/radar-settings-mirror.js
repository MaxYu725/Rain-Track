import { state } from './state.js';

function syncRadarSettingsMirror() {
  const range = document.getElementById('radar-range');
  const height = document.getElementById('radar-height');
  if (range) range.value = String(state.radar.range);
  if (height) height.value = String(state.radar.height);
}

document.addEventListener('click', event => {
  if (!event.target.closest?.('#radar-quick-controls [data-radar-range], #radar-quick-controls [data-radar-height]')) return;
  queueMicrotask(syncRadarSettingsMirror);
}, { capture:true });

window.addEventListener('rain:radar-frame-change', syncRadarSettingsMirror);
window.addEventListener('rain:map-mode-change', syncRadarSettingsMirror);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', syncRadarSettingsMirror, { once:true });
} else {
  syncRadarSettingsMirror();
}
