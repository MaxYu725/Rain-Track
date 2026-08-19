import { getForecastMapRuntimeSnapshot } from './forecast-map-runtime.js';

let activeMode = 'off';

function ensureStyles() {
  if (document.getElementById('rain-map-area-summary-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-map-area-summary-style';
  style.textContent = `
    .rain-map-area-summary{position:absolute;z-index:1190;top:62px;right:12px;display:none;width:min(330px,calc(100% - 24px));padding:10px 12px;border:1px solid #39454b;background:rgba(0,0,0,.88);box-shadow:0 3px 12px rgba(0,0,0,.4);backdrop-filter:blur(8px);pointer-events:none}
    .rain-map-area-summary.visible{display:block}
    .rain-map-area-kicker{color:#7d8c93;font-size:.61rem;letter-spacing:.04em;text-transform:uppercase}
    .rain-map-area-label{display:block;margin-top:3px;color:#f1f8fb;font-size:.88rem;font-weight:650;line-height:1.35}
    .rain-map-area-detail{display:block;margin-top:4px;color:#8f9da3;font-size:.64rem;line-height:1.4;font-variant-numeric:tabular-nums}
    @media(max-width:700px){
      .rain-map-area-summary{top:54px;right:10px;width:min(310px,calc(100% - 20px));padding:8px 10px}
      .rain-map-area-label{font-size:.82rem}.rain-map-area-detail{font-size:.61rem}
    }
  `;
  document.head.append(style);
}

function ensureSummary() {
  let panel = document.getElementById('rain-map-area-summary');
  if (panel) return panel;
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer) return null;

  panel = document.createElement('aside');
  panel.id = 'rain-map-area-summary';
  panel.className = 'rain-map-area-summary';
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-label', '所選預報時段雨區摘要');
  panel.innerHTML = `
    <span class="rain-map-area-kicker">所選預報時段</span>
    <strong class="rain-map-area-label" data-rain-area-label>正在分析雨區…</strong>
    <span class="rain-map-area-detail" data-rain-area-detail></span>`;
  mapContainer.append(panel);
  return panel;
}

function syncSummary(snapshot = getForecastMapRuntimeSnapshot()) {
  const panel = ensureSummary();
  if (!panel) return;
  const summary = snapshot?.spatialSummary;
  const visible = activeMode === 'forecast' && snapshot?.visible && Boolean(summary);
  panel.classList.toggle('visible', visible);
  panel.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (!visible) return;

  const label = panel.querySelector('[data-rain-area-label]');
  const detail = panel.querySelector('[data-rain-area-detail]');
  if (label) label.textContent = summary.label;
  if (detail) detail.textContent = `${summary.detail} · 判讀門檻 ≥ ${summary.thresholdMm} mm / 30 min`;
}

function initRainAreaSummary() {
  ensureStyles();
  ensureSummary();
  window.addEventListener('rain:map-mode-change', event => {
    activeMode = event.detail?.mode || 'off';
    syncSummary();
  });
  window.addEventListener('rain:forecast-map-frame-change', event => {
    syncSummary(event.detail?.snapshot || getForecastMapRuntimeSnapshot());
  });
}

document.addEventListener('DOMContentLoaded', initRainAreaSummary, { once:true });
