import { FORECAST_RAIN_SCALE } from './forecast-map-renderer.js';
import { getForecastMapFrameSummaries, getForecastMapRuntimeSnapshot, setForecastMapIndex } from './forecast-map-runtime.js';

const HK_TIME = new Intl.DateTimeFormat('zh-HK', {
  timeZone:'Asia/Hong_Kong',
  hour:'2-digit',
  minute:'2-digit',
  hour12:false
});
const HK_DATE_TIME = new Intl.DateTimeFormat('zh-HK', {
  timeZone:'Asia/Hong_Kong',
  day:'2-digit',
  month:'2-digit',
  hour:'2-digit',
  minute:'2-digit',
  hour12:false
});

let ready = false;

function validDate(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeText(value) {
  const date = validDate(value);
  return date ? HK_TIME.format(date) : '—';
}

function windowText(window) {
  const start = validDate(window?.start);
  const end = validDate(window?.end);
  if (!start || !end) return '有效時段不詳';
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Hong_Kong', year:'numeric', month:'2-digit', day:'2-digit' }).format(start)
    === new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Hong_Kong', year:'numeric', month:'2-digit', day:'2-digit' }).format(end);
  return sameDay ? `${HK_TIME.format(start)}–${HK_TIME.format(end)}` : `${HK_DATE_TIME.format(start)}–${HK_DATE_TIME.format(end)}`;
}

function rgbaCss(rgba) {
  const [r,g,b,a = 255] = rgba || [];
  return `rgba(${Number(r)||0},${Number(g)||0},${Number(b)||0},${Math.max(0, Math.min(255, Number(a)||0)) / 255})`;
}

function ensureStyles() {
  if (document.getElementById('forecast-map-timeline-style')) return;
  const style = document.createElement('style');
  style.id = 'forecast-map-timeline-style';
  style.textContent = `
    .forecast-map-timeline{z-index:760}.forecast-map-timeline .timeline-head{gap:7px}.forecast-map-head{display:flex;align-items:center;gap:7px;min-width:0}.forecast-map-unit{padding:2px 5px;border:1px solid #3d5664;color:#9bdcff;font-size:.64rem;white-space:nowrap}.forecast-map-window{margin-left:auto;color:#d9d9d9;font-size:.72rem;white-space:nowrap}.forecast-map-counter{color:#818181;font-size:.68rem;white-space:nowrap}.forecast-frame-buttons{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin:8px 0 7px}.forecast-frame-button{min-width:0;height:34px;padding:0 4px;border:1px solid #3f464a;background:#090b0c;color:#9da7ac;font-size:.69rem;white-space:nowrap}.forecast-frame-button.active{border-color:#277ca6;background:#08202c;color:#f4fbff;box-shadow:inset 0 -2px 0 #22a7e0}.forecast-frame-button:active{background:#123347}.forecast-map-legend{display:flex;align-items:center;gap:5px;color:#8f969a;font-size:.61rem}.forecast-map-legend-title{margin-right:2px;color:#c0c5c8}.forecast-map-scale{display:flex;width:105px;height:6px;overflow:hidden;border-radius:2px}.forecast-map-scale i{display:block;flex:1;height:100%}.forecast-map-issued{margin-top:5px;color:#777f83;font-size:.6rem;line-height:1.3}.forecast-map-timeline.is-switching{opacity:.78;pointer-events:none}
    @media(max-width:700px){.forecast-map-timeline{bottom:calc(96px + var(--safe-bottom))}.forecast-map-head{gap:5px}.forecast-map-unit{font-size:.59rem}.forecast-map-window{font-size:.64rem}.forecast-frame-buttons{gap:4px;margin-top:7px}.forecast-frame-button{height:32px;font-size:.64rem}.forecast-map-scale{width:82px}.forecast-map-issued{font-size:.57rem}}
  `;
  document.head.append(style);
}

function ensureTimeline() {
  let panel = document.getElementById('forecast-map-timeline');
  if (panel) return panel;
  const radar = document.getElementById('radar-timeline');
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer) return null;

  panel = document.createElement('section');
  panel.id = 'forecast-map-timeline';
  panel.className = 'radar-timeline forecast-map-timeline map-hud hidden';
  panel.setAttribute('aria-label', '未來兩小時降雨預報時間軸');
  panel.innerHTML = `
    <div class="timeline-head">
      <span class="forecast-map-head"><span>兩小時預報</span><span class="forecast-map-unit">mm / 30分鐘</span></span>
      <span id="forecast-map-window" class="forecast-map-window">—</span>
      <span id="forecast-map-counter" class="forecast-map-counter">0/0</span>
    </div>
    <div id="forecast-frame-buttons" class="forecast-frame-buttons" role="group" aria-label="選擇預報有效時段"></div>
    <div class="forecast-map-legend">
      <span class="forecast-map-legend-title">半小時雨量</span>
      <span>0.05</span>
      <span id="forecast-map-scale" class="forecast-map-scale" aria-hidden="true"></span>
      <span>10+ mm</span>
    </div>
    <div id="forecast-map-issued" class="forecast-map-issued">HKO 預報更新 —</div>`;
  (radar || mapContainer.lastElementChild)?.insertAdjacentElement(radar ? 'afterend' : 'beforebegin', panel);

  const scale = panel.querySelector('#forecast-map-scale');
  FORECAST_RAIN_SCALE.forEach(stop => {
    const segment = document.createElement('i');
    segment.style.background = rgbaCss(stop.rgba);
    scale?.append(segment);
  });
  return panel;
}

function renderTimeline() {
  const panel = ensureTimeline();
  if (!panel) return;
  const snapshot = getForecastMapRuntimeSnapshot();
  const frames = getForecastMapFrameSummaries();
  if (!snapshot.ready || !snapshot.visible || !frames.length) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  const selected = frames[snapshot.index] || frames[0];
  const windowLabel = panel.querySelector('#forecast-map-window');
  if (windowLabel) windowLabel.textContent = windowText(selected?.window);
  const counter = panel.querySelector('#forecast-map-counter');
  if (counter) counter.textContent = `${snapshot.index + 1}/${frames.length}`;
  const issued = panel.querySelector('#forecast-map-issued');
  if (issued) issued.textContent = `HKO 預報更新 ${timeText(snapshot.issueTime)} · 每格約 2 km`;

  const buttons = panel.querySelector('#forecast-frame-buttons');
  if (buttons) {
    buttons.replaceChildren(...frames.map((frame, frameIndex) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'forecast-frame-button';
      button.dataset.forecastIndex = String(frameIndex);
      button.textContent = timeText(frame.time);
      button.title = `預報有效 ${windowText(frame.window)}`;
      button.setAttribute('aria-label', button.title);
      const selectedFrame = frameIndex === snapshot.index;
      button.classList.toggle('active', selectedFrame);
      button.setAttribute('aria-pressed', selectedFrame ? 'true' : 'false');
      return button;
    }));
  }
}

function setFrame(frameIndex) {
  const panel = ensureTimeline();
  if (!panel) return;
  panel.classList.add('is-switching');
  try {
    setForecastMapIndex(frameIndex);
    renderTimeline();
  } finally {
    panel.classList.remove('is-switching');
  }
}

function setVisibleForMode(mode) {
  const panel = ensureTimeline();
  if (!panel) return;
  if (mode === 'forecast') renderTimeline();
  else panel.classList.add('hidden');
}

function initForecastTimeline() {
  if (ready) return;
  ready = true;
  ensureStyles();
  const panel = ensureTimeline();
  panel?.addEventListener('click', event => {
    const button = event.target.closest('[data-forecast-index]');
    if (!button) return;
    setFrame(Number(button.dataset.forecastIndex));
  });
  window.addEventListener('rain:map-mode-change', event => setVisibleForMode(event.detail?.mode));
}

document.addEventListener('DOMContentLoaded', initForecastTimeline, { once:true });
