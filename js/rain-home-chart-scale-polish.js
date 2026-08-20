import { rainfallScaleSpec } from './rain-home-chart-scale.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SERIES_SESSION_PREFIX = 'rain-home-series-v1:';

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

function contiguousRows(rows) {
  const segments = [];
  let current = [];
  for (const row of rows) {
    if (current.length && row.frameIndex !== current.at(-1).frameIndex + 1) {
      segments.push(current);
      current = [];
    }
    current.push(row);
  }
  if (current.length) segments.push(current);
  return segments;
}

function formatAxis(value, step) {
  if (step < 1) return Number(value).toFixed(step < 0.1 ? 2 : 1).replace(/\.0+$/, '');
  return String(Math.round(value));
}

function resetFixedYAxis(chart) {
  if (chart.dataset.rainHomeFixedYAxis !== '2') return;
  chart.closest('.rain-home-chart-stage')?.querySelector('[data-rain-home-y-gutter]')?.remove();
  delete chart.dataset.rainHomeFixedYAxis;
}

function replaceYAxis(chart, spec, plotTop, plotBottom, plotLeft, plotRight) {
  chart.querySelectorAll('.rain-home-grid,.rain-home-axis-label').forEach(node => node.remove());
  const anchor = chart.querySelector('.rain-home-unavailable-zone') || chart.firstChild;
  const fragment = document.createDocumentFragment();
  const plotHeight = plotBottom - plotTop;

  spec.ticks.forEach(value => {
    const y = plotTop + plotHeight * (1 - Number(value) / spec.max);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'rain-home-grid');
    line.setAttribute('x1', String(plotLeft));
    line.setAttribute('x2', String(plotRight));
    line.setAttribute('y1', y.toFixed(1));
    line.setAttribute('y2', y.toFixed(1));
    fragment.append(line);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'rain-home-axis-label');
    label.setAttribute('x', String(plotLeft - 8));
    label.setAttribute('y', (y + 4).toFixed(1));
    label.setAttribute('text-anchor', 'end');
    label.textContent = formatAxis(value, spec.step);
    fragment.append(label);
  });
  chart.insertBefore(fragment, anchor);
}

function updateGeometry(chart, points, spec) {
  const hits = [...chart.querySelectorAll('[data-rain-home-point]')];
  const dots = [...chart.querySelectorAll('.rain-home-dot')];
  if (!hits.length || hits.length !== dots.length || hits.length !== points.length) return false;

  const guide = chart.querySelector('.rain-home-selection-guide');
  const firstLead = chart.querySelector('.rain-home-first-lead');
  const unavailable = chart.querySelector('.rain-home-unavailable-zone');
  const plotTop = Number(guide?.getAttribute('y1') ?? firstLead?.getAttribute('y1') ?? unavailable?.getAttribute('y'));
  const plotBottom = Number(guide?.getAttribute('y2') ?? firstLead?.getAttribute('y2'));
  const plotLeft = Number(chart.dataset.plotLeft);
  const plotWidth = Number(chart.dataset.plotWidth);
  const plotRight = plotLeft + plotWidth;
  if (![plotTop, plotBottom, plotLeft, plotWidth, plotRight].every(Number.isFinite) || plotBottom <= plotTop || plotWidth <= 0) return false;

  const yFor = amount => plotTop + (plotBottom - plotTop) * (1 - Math.min(spec.max, Math.max(0, Number(amount) || 0)) / spec.max);
  const rows = points.map((point, index) => ({
    x:Number(hits[index].getAttribute('cx')),
    y:yFor(point.amountMm),
    amountMm:Number(point.amountMm) || 0,
    frameIndex:Number.isInteger(Number(point.frameIndex)) ? Number(point.frameIndex) : index
  }));
  if (!rows.every(row => Number.isFinite(row.x) && Number.isFinite(row.y))) return false;

  resetFixedYAxis(chart);
  replaceYAxis(chart, spec, plotTop, plotBottom, plotLeft, plotRight);

  rows.forEach((row, index) => {
    hits[index].setAttribute('cy', row.y.toFixed(1));
    dots[index].setAttribute('cy', row.y.toFixed(1));
  });

  const segments = contiguousRows(rows);
  const linePaths = [...chart.querySelectorAll('.rain-home-line')];
  if (linePaths.length === segments.length) {
    linePaths.forEach((path, index) => {
      path.setAttribute('d', segments[index].map((row, rowIndex) => `${rowIndex ? 'L' : 'M'} ${row.x.toFixed(1)} ${row.y.toFixed(1)}`).join(' '));
    });
  }

  const area = chart.querySelector('.rain-home-area');
  if (area && segments.length === 1 && segments[0].length >= 2) {
    const segment = segments[0];
    const line = segment.map((row, index) => `${index ? 'L' : 'M'} ${row.x.toFixed(1)} ${row.y.toFixed(1)}`).join(' ');
    area.setAttribute('d', `${line} L ${segment.at(-1).x.toFixed(1)} ${plotBottom.toFixed(1)} L ${segment[0].x.toFixed(1)} ${plotBottom.toFixed(1)} Z`);
  }

  const intensityPaths = [...chart.querySelectorAll('[data-rain-home-intensity-layer] .rain-home-intensity-area')];
  if (intensityPaths.length === segments.filter(segment => segment.length >= 2).length) {
    segments.filter(segment => segment.length >= 2).forEach((segment, index) => {
      const line = segment.map((row, rowIndex) => `${rowIndex ? 'L' : 'M'} ${row.x.toFixed(1)} ${row.y.toFixed(1)}`).join(' ');
      intensityPaths[index].setAttribute('d', `${line} L ${segment.at(-1).x.toFixed(1)} ${plotBottom.toFixed(1)} L ${segment[0].x.toFixed(1)} ${plotBottom.toFixed(1)} Z`);
    });
  }

  chart.dataset.rainHomeScaleMax = String(spec.max);
  chart.dataset.rainHomeScaleStep = String(spec.step);
  chart.dataset.rainHomeScalePolish = '1';
  return true;
}

export function polishRainHomeChartScale(chart) {
  if (!chart || chart.dataset.rainHomeScalePolish === '1') return false;
  const points = readSeriesPoints(chart);
  if (!points.length) return false;
  const peak = points.reduce((max, point) => Math.max(max, Number(point?.amountMm) || 0), 0);
  return updateGeometry(chart, points, rainfallScaleSpec(peak));
}

function enhanceCurrentChart() {
  const chart = document.querySelector('.rain-home-root[data-view-kind="ready"] .rain-home-chart:not([data-rain-home-scale-polish="1"])');
  if (chart) polishRainHomeChartScale(chart);
}

function initRainHomeChartScalePolish() {
  enhanceCurrentChart();
  const content = document.getElementById('forecast-content');
  if (!content) return;
  const observer = new MutationObserver(() => enhanceCurrentChart());
  observer.observe(content, { childList:true, subtree:true });
  window.addEventListener('rain:location-change', () => queueMicrotask(enhanceCurrentChart));
  window.addEventListener('rain:refresh', () => queueMicrotask(enhanceCurrentChart));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initRainHomeChartScalePolish, { once:true });
  else initRainHomeChartScalePolish();
}
