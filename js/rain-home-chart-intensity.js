const SVG_NS = 'http://www.w3.org/2000/svg';
const SERIES_SESSION_PREFIX = 'rain-home-series-v1:';
const CHART_MIN_WIDTH_PX = 840;

export const RAIN_HOME_INTENSITY_THRESHOLDS = Object.freeze([0.5, 2, 5, 10]);

export function rainfallIntensityStyle(amountMm) {
  const amount = Number(amountMm);
  if (!Number.isFinite(amount) || amount <= 0) return { color:'#2aa6e8', opacity:0, label:'無' };
  if (amount < 0.5) return { color:'#2aa6e8', opacity:0.22, label:'偏弱' };
  if (amount < 2) return { color:'#1fc69a', opacity:0.26, label:'較弱至中等' };
  if (amount < 5) return { color:'#d6d600', opacity:0.30, label:'中等' };
  if (amount < 10) return { color:'#f28b20', opacity:0.34, label:'較強' };
  return { color:'#d73545', opacity:0.38, label:'強' };
}

export function buildSteppedIntensityStops(samples) {
  const rows = (Array.isArray(samples) ? samples : [])
    .map(sample => ({ offset:Math.max(0, Math.min(1, Number(sample?.offset))), amountMm:Number(sample?.amountMm) }))
    .filter(sample => Number.isFinite(sample.offset) && Number.isFinite(sample.amountMm))
    .sort((a, b) => a.offset - b.offset);
  if (!rows.length) return [];

  const stops = [];
  const push = (offset, style) => stops.push({
    offset:Math.max(0, Math.min(1, offset)),
    color:style.color,
    opacity:style.opacity
  });

  const firstStyle = rainfallIntensityStyle(rows[0].amountMm);
  push(0, firstStyle);
  push(rows[0].offset, firstStyle);
  for (let index = 0; index < rows.length - 1; index += 1) {
    const current = rows[index];
    const next = rows[index + 1];
    const midpoint = (current.offset + next.offset) / 2;
    push(midpoint, rainfallIntensityStyle(current.amountMm));
    push(midpoint, rainfallIntensityStyle(next.amountMm));
  }
  const lastStyle = rainfallIntensityStyle(rows.at(-1).amountMm);
  push(rows.at(-1).offset, lastStyle);
  push(1, lastStyle);
  return stops;
}

function injectStyles() {
  if (document.getElementById('rain-home-chart-intensity-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-home-chart-intensity-style';
  style.textContent = `
    .rain-home-chart-wrap[data-rain-home-intensity-v1]{padding-top:11px}
    .rain-home-intensity-legend{display:flex;align-items:center;gap:7px;margin:0 2px 9px;color:#7c898f;font-size:.65rem;line-height:1;white-space:nowrap}
    .rain-home-intensity-legend-label{color:#9ba7ac;font-weight:620}.rain-home-intensity-scale{width:118px;height:6px;border-radius:3px;background:linear-gradient(90deg,#2aa6e8 0 20%,#1fc69a 20% 40%,#d6d600 40% 60%,#f28b20 60% 80%,#d73545 80% 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
    .rain-home-chart-scroll{width:100%;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:#2b3b43 #080b0d;padding-bottom:5px}
    .rain-home-chart-scroll::-webkit-scrollbar{height:5px}.rain-home-chart-scroll::-webkit-scrollbar-track{background:#080b0d}.rain-home-chart-scroll::-webkit-scrollbar-thumb{background:#2b3b43;border-radius:4px}
    .rain-home-chart-scroll .rain-home-chart{width:max(100%,${CHART_MIN_WIDTH_PX}px);max-width:none;height:auto;touch-action:pan-x pan-y}
    .rain-home-chart[data-rain-home-intensity-v1] .rain-home-area{display:none}
    .rain-home-intensity-area{pointer-events:none}
    .rain-home-chart-scroll-hint{margin:2px 2px 0;color:#647178;font-size:.62rem;line-height:1.4}
    @media(max-width:700px){.rain-home-chart-wrap[data-rain-home-intensity-v1]{padding:10px 7px 10px}.rain-home-intensity-legend{margin-bottom:7px}.rain-home-intensity-scale{width:106px}.rain-home-chart-scroll .rain-home-chart{width:860px}.rain-home-chart-scroll-hint{font-size:.68rem}}
    @media(max-width:390px){.rain-home-chart-scroll .rain-home-chart{width:880px}}
  `;
  document.head.append(style);
}

function readSeriesPoints(chart) {
  const root = chart.closest('.rain-home-root[data-point-key]');
  const pointKey = root?.dataset?.pointKey;
  if (!pointKey) return [];
  try {
    const stored = JSON.parse(sessionStorage.getItem(`${SERIES_SESSION_PREFIX}${pointKey}`) || 'null');
    return Array.isArray(stored?.data?.points) ? stored.data.points : [];
  } catch {
    return [];
  }
}

function amountFromHit(hit) {
  const label = String(hit?.getAttribute('aria-label') || '');
  const match = label.match(/，([0-9]+(?:\.[0-9]+)?) mm \/ 30 min/);
  return match ? Number(match[1]) : NaN;
}

function chartRows(chart) {
  const stored = readSeriesPoints(chart);
  const hits = [...chart.querySelectorAll('[data-rain-home-point]')];
  const dots = [...chart.querySelectorAll('.rain-home-dot')];
  if (!hits.length || hits.length !== dots.length) return [];
  return hits.map((hit, index) => {
    const storedPoint = stored[index];
    const amountMm = Number.isFinite(Number(storedPoint?.amountMm)) ? Number(storedPoint.amountMm) : amountFromHit(hit);
    const frameIndex = Number.isInteger(Number(storedPoint?.frameIndex)) ? Number(storedPoint.frameIndex) : index;
    return {
      x:Number(hit.getAttribute('cx')),
      y:Number(hit.getAttribute('cy')),
      amountMm,
      frameIndex
    };
  }).filter(row => [row.x, row.y, row.amountMm].every(Number.isFinite));
}

function contiguousRows(rows) {
  const segments = [];
  let current = [];
  rows.forEach(row => {
    if (current.length && row.frameIndex !== current.at(-1).frameIndex + 1) {
      segments.push(current);
      current = [];
    }
    current.push(row);
  });
  if (current.length) segments.push(current);
  return segments;
}

function baselineY(chart) {
  const firstGrid = chart.querySelector('.rain-home-grid');
  const value = Number(firstGrid?.getAttribute('y1'));
  return Number.isFinite(value) ? value : null;
}

function addIntensityLayer(chart, rows) {
  chart.querySelector('[data-rain-home-intensity-defs]')?.remove();
  chart.querySelector('[data-rain-home-intensity-layer]')?.remove();
  if (!rows.length) return;

  const plotLeft = Number(chart.dataset.plotLeft);
  const plotWidth = Number(chart.dataset.plotWidth);
  const baseY = baselineY(chart);
  if (![plotLeft, plotWidth, baseY].every(Number.isFinite) || plotWidth <= 0) return;

  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.setAttribute('data-rain-home-intensity-defs', '1');
  const gradient = document.createElementNS(SVG_NS, 'linearGradient');
  const gradientId = `rain-home-intensity-${Math.random().toString(36).slice(2, 9)}`;
  gradient.id = gradientId;
  gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
  gradient.setAttribute('x1', String(plotLeft));
  gradient.setAttribute('x2', String(plotLeft + plotWidth));
  gradient.setAttribute('y1', '0');
  gradient.setAttribute('y2', '0');
  const samples = rows.map(row => ({
    offset:(row.x - plotLeft) / plotWidth,
    amountMm:row.amountMm
  }));
  buildSteppedIntensityStops(samples).forEach(stopData => {
    const stop = document.createElementNS(SVG_NS, 'stop');
    stop.setAttribute('offset', `${(stopData.offset * 100).toFixed(3)}%`);
    stop.setAttribute('stop-color', stopData.color);
    stop.setAttribute('stop-opacity', String(stopData.opacity));
    gradient.append(stop);
  });
  defs.append(gradient);
  chart.insertBefore(defs, chart.firstChild);

  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('data-rain-home-intensity-layer', '1');
  layer.setAttribute('aria-hidden', 'true');
  contiguousRows(rows).filter(segment => segment.length >= 2).forEach(segment => {
    const path = document.createElementNS(SVG_NS, 'path');
    const line = segment.map((row, index) => `${index ? 'L' : 'M'} ${row.x.toFixed(1)} ${row.y.toFixed(1)}`).join(' ');
    const first = segment[0];
    const last = segment.at(-1);
    path.setAttribute('class', 'rain-home-intensity-area');
    path.setAttribute('d', `${line} L ${last.x.toFixed(1)} ${baseY.toFixed(1)} L ${first.x.toFixed(1)} ${baseY.toFixed(1)} Z`);
    path.setAttribute('fill', `url(#${gradientId})`);
    layer.append(path);
  });
  const anchor = chart.querySelector('.rain-home-selection-guide') || chart.querySelector('.rain-home-line');
  chart.insertBefore(layer, anchor || null);
}

function addLegend(wrap) {
  if (wrap.querySelector('[data-rain-home-intensity-legend]')) return;
  const legend = document.createElement('div');
  legend.className = 'rain-home-intensity-legend';
  legend.setAttribute('data-rain-home-intensity-legend', '1');
  legend.setAttribute('role', 'img');
  legend.setAttribute('aria-label', '雨量強度固定色階：藍色低於 0.5、綠色 0.5 至 2、黃色 2 至 5、橙色 5 至 10、紅色 10 或以上毫米每 30 分鐘');
  legend.innerHTML = '<span class="rain-home-intensity-legend-label">雨量強度</span><span>弱</span><span class="rain-home-intensity-scale" aria-hidden="true"></span><span>強</span>';
  wrap.prepend(legend);
}

function wrapChartForScroll(wrap, chart) {
  let viewport = wrap.querySelector('.rain-home-chart-scroll');
  if (viewport) return viewport;
  viewport = document.createElement('div');
  viewport.className = 'rain-home-chart-scroll';
  viewport.setAttribute('data-rain-home-chart-scroll', '1');
  chart.before(viewport);
  viewport.append(chart);
  return viewport;
}

function addScrollHint(wrap, viewport) {
  if (wrap.querySelector('[data-rain-home-scroll-hint]')) return;
  const hint = document.createElement('div');
  hint.className = 'rain-home-chart-scroll-hint';
  hint.setAttribute('data-rain-home-scroll-hint', '1');
  hint.textContent = '左右滑動查看完整 2 小時 · 點按時間查看雨量';
  viewport.after(hint);
}

export function enhanceRainHomeChart(chart) {
  if (!chart || chart.dataset.rainHomeIntensityV1 === '1') return false;
  const wrap = chart.closest('.rain-home-chart-wrap');
  if (!wrap) return false;
  const rows = chartRows(chart);
  if (!rows.length) return false;

  injectStyles();
  wrap.dataset.rainHomeIntensityV1 = '1';
  chart.dataset.rainHomeIntensityV1 = '1';
  addIntensityLayer(chart, rows);
  addLegend(wrap);
  const viewport = wrapChartForScroll(wrap, chart);
  addScrollHint(wrap, viewport);
  return true;
}

function enhanceCurrentChart() {
  const chart = document.querySelector('.rain-home-root[data-view-kind="ready"] .rain-home-chart:not([data-rain-home-intensity-v1="1"])');
  if (chart) enhanceRainHomeChart(chart);
}

function initRainHomeChartIntensity() {
  injectStyles();
  enhanceCurrentChart();
  const content = document.getElementById('forecast-content');
  if (!content) return;
  const observer = new MutationObserver(() => enhanceCurrentChart());
  observer.observe(content, { childList:true, subtree:true });
  window.addEventListener('rain:location-change', () => queueMicrotask(enhanceCurrentChart));
  window.addEventListener('rain:refresh', () => queueMicrotask(enhanceCurrentChart));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initRainHomeChartIntensity, { once:true });
  else initRainHomeChartIntensity();
}
