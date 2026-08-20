import { getForecastMapRuntimeSnapshot } from './forecast-map-runtime.js';

const HK_TIME = new Intl.DateTimeFormat('zh-HK', {
  timeZone:'Asia/Hong_Kong',
  hour:'2-digit',
  minute:'2-digit',
  hour12:false
});

let activeMode = 'off';

function ensureStyles() {
  if (document.getElementById('rain-map-area-summary-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-map-area-summary-style';
  style.textContent = `
    .rain-map-area-summary{position:absolute;z-index:1190;top:62px;left:12px;display:none;width:min(460px,calc(100% - 24px));padding:10px 12px;border:1px solid #39454b;background:rgba(0,0,0,.9);box-shadow:0 3px 12px rgba(0,0,0,.4);backdrop-filter:blur(8px);pointer-events:none}
    .rain-map-area-summary.visible{display:block}
    .rain-map-area-kicker{display:inline;color:#8ca0a9;font-size:.64rem;font-weight:650;letter-spacing:.03em;font-variant-numeric:tabular-nums}
    .rain-map-area-kicker::after{content:' · '}
    .rain-map-area-label{display:inline;color:#f1f8fb;font-size:.95rem;font-weight:680;line-height:1.35}
    .rain-map-area-detail{display:block;margin-top:4px;color:#91a0a7;font-size:.66rem;line-height:1.4;font-variant-numeric:tabular-nums}
    @media(max-width:700px){
      .rain-map-area-summary{top:50px;left:8px;width:calc(100% - 16px);max-width:560px;padding:7px 9px}
      .rain-map-area-kicker{font-size:.6rem}.rain-map-area-label{font-size:.82rem;line-height:1.3}.rain-map-area-detail{margin-top:3px;font-size:.6rem;line-height:1.32}
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
    <span class="rain-map-area-kicker" data-rain-area-time>正在分析目前時段…</span>
    <strong class="rain-map-area-label" data-rain-area-label>正在分析雨區…</strong>
    <span class="rain-map-area-detail" data-rain-area-detail></span>`;
  mapContainer.append(panel);
  return panel;
}

function selectedTimeText(snapshot) {
  const frame = snapshot?.selectedFrame;
  const time = new Date(frame?.time || '');
  const clock = Number.isNaN(time.getTime()) ? '—' : HK_TIME.format(time);
  const lead = Number(frame?.leadMinutes);
  return Number.isFinite(lead) ? `${clock} · +${lead} 分` : clock;
}

function syncSummary(snapshot = getForecastMapRuntimeSnapshot()) {
  const panel = ensureSummary();
  if (!panel) return;
  const summary = snapshot?.spatialSummary;
  const visible = activeMode === 'forecast' && snapshot?.visible && Boolean(summary);
  panel.classList.toggle('visible', visible);
  panel.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (!visible) return;

  const time = panel.querySelector('[data-rain-area-time]');
  const label = panel.querySelector('[data-rain-area-label]');
  const detail = panel.querySelector('[data-rain-area-detail]');
  if (time) time.textContent = selectedTimeText(snapshot);
  if (label) label.textContent = summary.label;
  if (detail) detail.textContent = summary.detail;
  panel.dataset.rainAreaStatus = summary.status || '';
  panel.removeAttribute('title');
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRainAreaSummary, { once:true });
} else {
  initRainAreaSummary();
}
