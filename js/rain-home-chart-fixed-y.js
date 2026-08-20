const CHART_SELECTOR = '.rain-home-chart-scroll .rain-home-chart';
const FIXED_LABEL_SELECTOR = '.rain-home-axis-label';

const bindings = new Set();

export function scrollPixelsToSvgUnits(scrollLeftPx, renderedWidthPx, viewBoxWidth) {
  const scrollLeft = Number(scrollLeftPx);
  const renderedWidth = Number(renderedWidthPx);
  const svgWidth = Number(viewBoxWidth);
  if (![scrollLeft, renderedWidth, svgWidth].every(Number.isFinite) || renderedWidth <= 0 || svgWidth <= 0) return 0;
  return scrollLeft * svgWidth / renderedWidth;
}

function injectStyles() {
  if (document.getElementById('rain-home-chart-fixed-y-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-home-chart-fixed-y-style';
  style.textContent = `
    .rain-home-chart[data-rain-home-fixed-y-axis="1"] .rain-home-axis-label[data-rain-home-fixed-y-label="1"]{
      pointer-events:none;
      paint-order:stroke fill;
      stroke:#06090b;
      stroke-width:5px;
      stroke-linejoin:round;
    }
  `;
  document.head.append(style);
}

function viewBoxWidth(chart) {
  const liveWidth = Number(chart?.viewBox?.baseVal?.width);
  if (Number.isFinite(liveWidth) && liveWidth > 0) return liveWidth;
  const parts = String(chart?.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
  return Number.isFinite(parts[2]) && parts[2] > 0 ? parts[2] : 0;
}

function cleanupDetachedBindings() {
  for (const binding of bindings) {
    if (!binding.viewport.isConnected || !binding.chart.isConnected) bindings.delete(binding);
  }
}

function syncBinding(binding) {
  if (!binding.viewport.isConnected || !binding.chart.isConnected) {
    bindings.delete(binding);
    return;
  }
  const renderedWidth = binding.chart.getBoundingClientRect().width;
  const delta = scrollPixelsToSvgUnits(binding.viewport.scrollLeft, renderedWidth, viewBoxWidth(binding.chart));
  const transform = `translate(${delta.toFixed(3)} 0)`;
  binding.labels.forEach(label => label.setAttribute('transform', transform));
}

function scheduleSync(binding) {
  if (binding.raf) return;
  binding.raf = requestAnimationFrame(() => {
    binding.raf = 0;
    syncBinding(binding);
  });
}

export function fixRainHomeYAxis(chart) {
  if (!chart || chart.dataset.rainHomeFixedYAxis === '1') return false;
  const viewport = chart.closest('.rain-home-chart-scroll');
  if (!viewport) return false;
  const labels = [...chart.querySelectorAll(FIXED_LABEL_SELECTOR)];
  if (!labels.length) return false;

  injectStyles();
  chart.dataset.rainHomeFixedYAxis = '1';
  labels.forEach(label => {
    label.dataset.rainHomeFixedYLabel = '1';
    label.setAttribute('pointer-events', 'none');
    chart.append(label);
  });

  const binding = { viewport, chart, labels, raf:0 };
  bindings.add(binding);
  viewport.addEventListener('scroll', () => scheduleSync(binding), { passive:true });
  syncBinding(binding);
  return true;
}

function enhanceCurrentChart() {
  cleanupDetachedBindings();
  const chart = document.querySelector(`${CHART_SELECTOR}:not([data-rain-home-fixed-y-axis="1"])`);
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
