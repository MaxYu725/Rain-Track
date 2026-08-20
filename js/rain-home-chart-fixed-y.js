const CHART_SELECTOR = '.rain-home-chart-scroll .rain-home-chart';
const AXIS_LABEL_SELECTOR = '.rain-home-axis-label';
const GUTTER_WIDTH_PX = 48;

const bindings = new Set();

export function axisLabelCenterPx(labelTopPx, labelHeightPx, chartTopPx) {
  const labelTop = Number(labelTopPx);
  const labelHeight = Number(labelHeightPx);
  const chartTop = Number(chartTopPx);
  if (![labelTop, labelHeight, chartTop].every(Number.isFinite) || labelHeight < 0) return 0;
  return Math.max(0, labelTop - chartTop + labelHeight / 2);
}

function injectStyles() {
  if (document.getElementById('rain-home-chart-fixed-y-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-home-chart-fixed-y-style';
  style.textContent = `
    .rain-home-chart-stage{position:relative}
    .rain-home-chart-y-gutter{
      position:absolute;z-index:5;left:0;top:0;width:${GUTTER_WIDTH_PX}px;height:0;
      pointer-events:none;overflow:hidden;background:#06090b;
      border-right:1px solid rgba(70,88,96,.42);
      box-shadow:5px 0 8px rgba(6,9,11,.38)
    }
    .rain-home-chart-y-gutter-label{
      position:absolute;right:7px;transform:translateY(-50%);
      color:#68757b;font:10px/1 "Segoe UI","Microsoft JhengHei",sans-serif;
      font-variant-numeric:tabular-nums;white-space:nowrap
    }
    .rain-home-chart[data-rain-home-fixed-y-axis="2"] .rain-home-axis-label{opacity:0}
    @media(max-width:700px){.rain-home-chart-y-gutter{width:${GUTTER_WIDTH_PX}px}.rain-home-chart-y-gutter-label{font-size:14px}}
    @media(max-width:390px){.rain-home-chart-y-gutter-label{font-size:15px}}
  `;
  document.head.append(style);
}

function cleanupDetachedBindings() {
  for (const binding of bindings) {
    if (!binding.viewport.isConnected || !binding.chart.isConnected || !binding.gutter.isConnected) {
      binding.resizeObserver?.disconnect?.();
      bindings.delete(binding);
    }
  }
}

function ensureStage(viewport) {
  const existing = viewport.closest('.rain-home-chart-stage');
  if (existing) return existing;
  const stage = document.createElement('div');
  stage.className = 'rain-home-chart-stage';
  stage.setAttribute('data-rain-home-chart-stage', '1');
  viewport.before(stage);
  stage.append(viewport);
  return stage;
}

function createGutter(stage, labels) {
  stage.querySelector('[data-rain-home-y-gutter]')?.remove();
  const gutter = document.createElement('div');
  gutter.className = 'rain-home-chart-y-gutter';
  gutter.setAttribute('data-rain-home-y-gutter', '1');
  gutter.setAttribute('aria-hidden', 'true');
  const clones = labels.map(label => {
    const clone = document.createElement('span');
    clone.className = 'rain-home-chart-y-gutter-label';
    clone.textContent = String(label.textContent || '').trim();
    gutter.append(clone);
    return clone;
  });
  stage.append(gutter);
  return { gutter, clones };
}

function syncBinding(binding) {
  if (!binding.viewport.isConnected || !binding.chart.isConnected || !binding.gutter.isConnected) {
    binding.resizeObserver?.disconnect?.();
    bindings.delete(binding);
    return;
  }
  const chartRect = binding.chart.getBoundingClientRect();
  if (!(chartRect.width > 0 && chartRect.height > 0)) return;
  binding.gutter.style.height = `${chartRect.height.toFixed(1)}px`;
  binding.labels.forEach((label, index) => {
    const rect = label.getBoundingClientRect();
    const top = axisLabelCenterPx(rect.top, rect.height, chartRect.top);
    binding.clones[index].style.top = `${top.toFixed(1)}px`;
  });
}

function scheduleSync(binding) {
  if (binding.raf) return;
  binding.raf = requestAnimationFrame(() => {
    binding.raf = 0;
    syncBinding(binding);
  });
}

export function fixRainHomeYAxis(chart) {
  if (!chart || chart.dataset.rainHomeFixedYAxis === '2') return false;
  const viewport = chart.closest('.rain-home-chart-scroll');
  if (!viewport) return false;
  const labels = [...chart.querySelectorAll(AXIS_LABEL_SELECTOR)];
  if (!labels.length) return false;

  injectStyles();
  labels.forEach(label => {
    label.removeAttribute('transform');
    label.removeAttribute('data-rain-home-fixed-y-label');
  });
  chart.dataset.rainHomeFixedYAxis = '2';

  const stage = ensureStage(viewport);
  const { gutter, clones } = createGutter(stage, labels);
  const binding = { viewport, chart, gutter, labels, clones, resizeObserver:null, raf:0 };
  bindings.add(binding);

  if (typeof ResizeObserver === 'function') {
    binding.resizeObserver = new ResizeObserver(() => scheduleSync(binding));
    binding.resizeObserver.observe(chart);
  }
  requestAnimationFrame(() => syncBinding(binding));
  return true;
}

function enhanceCurrentChart() {
  cleanupDetachedBindings();
  const chart = document.querySelector(`${CHART_SELECTOR}:not([data-rain-home-fixed-y-axis="2"])`);
  if (chart) fixRainHomeYAxis(chart);
}

function initFixedYAxis() {
  injectStyles();
  enhanceCurrentChart();
  const content = document.getElementById('forecast-content');
  if (!content) return;
  const observer = new MutationObserver(() => enhanceCurrentChart());
  observer.observe(content, { childList:true, subtree:true });
  window.addEventListener('resize', () => {
    cleanupDetachedBindings();
    bindings.forEach(binding => scheduleSync(binding));
  }, { passive:true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFixedYAxis, { once:true });
  else initFixedYAxis();
}
