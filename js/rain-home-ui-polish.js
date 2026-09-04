export function splitNowNextTimingText(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const parts = text.split(/\s+·\s+/).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return [];
  return [
    { label:'現在', text:parts[0] },
    { label:'接下來', text:parts.slice(1).join(' · ') }
  ];
}

export function observedRadarLooksDry(classNames) {
  const names = Array.isArray(classNames) ? classNames : [];
  if (!names.length) return false;
  return names.every(value => !/\blevel-[1-5]\b/.test(String(value || '')));
}

export function forecastDisplayRatio(leadMinutes, {
  firstLeadMinutes = 30,
  horizonMinutes = 120
} = {}) {
  const lead = Number(leadMinutes);
  const first = Number(firstLeadMinutes);
  const horizon = Number(horizonMinutes);
  if (![lead, first, horizon].every(Number.isFinite) || horizon <= first) return null;
  return Math.max(0, Math.min(1, (lead - first) / (horizon - first)));
}

function injectStyles() {
  if (document.getElementById('rain-home-ui-polish-v3-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-home-ui-polish-v3-style';
  style.textContent = `
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-location{padding-bottom:12px}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-summary{padding:17px 0 15px}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-verdict{max-width:610px;font-size:clamp(1.85rem,5vw,2.5rem);font-weight:390;line-height:1.05}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-detail{max-width:610px;margin-top:10px;color:#9aa6ac;line-height:1.5}
    .rain-home-root[data-rain-home-ui-polish="3"].is-dry-now-next .rain-home-summary{padding-bottom:12px}
    .rain-home-root[data-rain-home-ui-polish="3"].is-dry-now-next .rain-home-verdict{font-size:clamp(1.8rem,4.8vw,2.35rem)}
    .rain-home-root[data-rain-home-ui-polish="3"].is-dry-now-next .rain-home-detail{display:none}

    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-timing[data-rain-home-timing-polished="1"]{
      display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:12px;color:#aab7bd;font-size:.74rem;font-weight:540;line-height:1.34
    }
    .rain-home-now-next-item{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:7px;padding:7px 8px;border:1px solid #1c292f;background:#050a0d}
    .rain-home-now-next-label{color:#7f949e;font-size:.62rem;font-weight:720;letter-spacing:.06em;white-space:nowrap}
    .rain-home-now-next-copy{min-width:0;color:#aab7bd}

    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-observed{margin-bottom:11px}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-observed.is-dry{padding:8px 10px 7px}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-observed.is-dry .rain-home-observed-summary{margin-top:3px;color:#8f9ca2}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-observed.is-dry .rain-home-observed-track,
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-observed.is-dry .rain-home-observed-legend{display:none}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-observed.is-dry .rain-home-observed-times{margin-top:5px;padding-top:5px;border-top:1px solid #162126}

    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-chart-section{padding-top:14px}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-chart-wrap{padding:9px 8px 8px}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-chart-scroll{width:100%;overflow:visible!important;padding-bottom:0!important}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-chart-scroll::-webkit-scrollbar{display:none}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-chart-scroll .rain-home-chart{display:block;width:100%!important;max-width:100%!important;height:auto!important;touch-action:pan-y!important}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-chart-scroll-hint{display:none!important}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-chart-y-gutter{display:none!important}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-chart[data-rain-home-fixed-y-axis="2"] .rain-home-axis-label{opacity:1!important}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-unavailable-zone,
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-first-lead,
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-unavailable-label{display:none!important}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-intensity-legend{margin-bottom:5px}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-chart-help{margin-top:4px}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-chart-readout{min-height:56px;margin-top:7px;padding:8px 10px}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-meta{margin-top:9px}
    .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-primary-action{margin-top:17px}

    @media(max-width:700px){
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-summary{padding:12px 0 10px}
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-verdict{font-size:clamp(1.7rem,7.2vw,2.15rem)}
      .rain-home-root[data-rain-home-ui-polish="3"].is-dry-now-next .rain-home-verdict{font-size:clamp(1.72rem,7vw,2.08rem)}
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-detail{font-size:.84rem;line-height:1.48}
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-timing[data-rain-home-timing-polished="1"]{grid-template-columns:1fr;margin-top:9px;gap:5px}
      .rain-home-now-next-item{padding:6px 8px}
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-chart-section{padding-top:12px}
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-chart-wrap{padding:8px 7px 7px}
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-axis-label{font-size:11px}
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-axis-clock{font-size:12px}
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-axis-lead{font-size:10px}
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-chart-readout{grid-template-columns:minmax(0,1fr) auto!important;gap:8px 12px}
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-readout-value{text-align:right!important}
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-readout-unit{display:block!important;margin-left:0!important}
    }

    @media(max-width:390px){
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-chart-readout{grid-template-columns:minmax(0,1fr) auto!important}
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-readout-time{font-size:.8rem}
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-readout-window{font-size:.6rem}
      .rain-home-root[data-rain-home-ui-polish="3"] .rain-home-readout-value{font-size:1.05rem}
    }
  `;
  document.head.append(style);
}

function polishHero(root) {
  const dryNowNext = root.dataset.rainHomeNowNext === 'dry';
  root.classList.toggle('is-dry-now-next', dryNowNext);
  const verdict = root.querySelector('.rain-home-verdict');
  if (!verdict) return;

  if (dryNowNext) {
    const current = String(verdict.textContent || '').trim();
    if (current && current !== '暫無明顯降雨') {
      root.dataset.rainHomeUiDryCombinedTitle = current;
      verdict.textContent = '暫無明顯降雨';
    }
    return;
  }

  if (verdict.textContent === '暫無明顯降雨' && root.dataset.rainHomeUiDryCombinedTitle) {
    verdict.textContent = root.dataset.rainHomeUiDryCombinedTitle;
  }
}

function polishTiming(root) {
  const timing = root.querySelector('.rain-home-timing');
  if (!timing || timing.querySelector('.rain-home-now-next-item')) return;
  const rows = splitNowNextTimingText(timing.textContent);
  if (rows.length !== 2) return;
  const aria = rows.map(row => row.text).join(' · ');
  timing.replaceChildren(...rows.map(row => {
    const item = document.createElement('span');
    item.className = 'rain-home-now-next-item';
    const label = document.createElement('span');
    label.className = 'rain-home-now-next-label';
    label.textContent = row.label;
    const copy = document.createElement('span');
    copy.className = 'rain-home-now-next-copy';
    copy.textContent = row.text;
    item.append(label, copy);
    return item;
  }));
  timing.dataset.rainHomeTimingPolished = '1';
  timing.setAttribute('aria-label', aria);
}

function polishRadar(root) {
  const observed = root.querySelector('[data-rain-home-observed-radar]');
  if (!observed) return;
  const classes = [...observed.querySelectorAll('.rain-home-observed-segment')].map(node => node.className);
  const dry = observedRadarLooksDry(classes);
  observed.classList.toggle('is-dry', dry);

  const summary = observed.querySelector('.rain-home-observed-summary');
  if (!summary) return;
  if (!summary.dataset.rainHomeUiOriginalSummary) summary.dataset.rainHomeUiOriginalSummary = summary.textContent || '';
  summary.textContent = dry ? '未見明顯回波' : summary.dataset.rainHomeUiOriginalSummary;
}

function xForLead(leadMinutes, plotLeft, plotWidth, firstLead, horizon) {
  const ratio = forecastDisplayRatio(leadMinutes, { firstLeadMinutes:firstLead, horizonMinutes:horizon });
  return ratio === null ? null : plotLeft + plotWidth * ratio;
}

function contiguousDisplayRows(rows) {
  const segments = [];
  let current = [];
  for (const row of rows) {
    if (current.length && Math.abs(Number(row.leadMinutes) - Number(current.at(-1).leadMinutes) - 6) > 0.01) {
      segments.push(current);
      current = [];
    }
    current.push(row);
  }
  if (current.length) segments.push(current);
  return segments;
}

function bindFitAxisPointer(chart, rows) {
  if (chart.dataset.rainHomeFitPointer === '3') return;
  chart.dataset.rainHomeFitPointer = '3';
  chart.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rect = chart.getBoundingClientRect();
    const viewWidth = chart.viewBox?.baseVal?.width || 700;
    if (!(rect.width > 0 && viewWidth > 0)) return;
    const viewX = (Number(event.clientX) - rect.left) * viewWidth / rect.width;
    const nearest = rows.reduce((best, row) => Math.abs(row.x - viewX) < Math.abs(best.x - viewX) ? row : best, rows[0]);
    if (!nearest?.hit) return;
    event.stopPropagation();
    nearest.hit.click();
  }, { capture:true });
}

function remapForecastChart(chart) {
  if (!chart || chart.dataset.rainHomeForecastAxis === '3') return;
  const hits = [...chart.querySelectorAll('[data-rain-home-point]')];
  const dots = [...chart.querySelectorAll('.rain-home-dot')];
  if (!hits.length || hits.length !== dots.length) return;

  const plotLeft = Number(chart.dataset.plotLeft);
  const plotWidth = Number(chart.dataset.plotWidth);
  const horizon = Number(chart.dataset.horizonMinutes) || 120;
  const leads = dots.map(dot => Number(dot.dataset.leadMinutes));
  const firstLead = Math.min(...leads.filter(Number.isFinite));
  if (![plotLeft, plotWidth, horizon, firstLead].every(Number.isFinite) || plotWidth <= 0 || horizon <= firstLead) return;

  const rows = dots.map((dot, index) => {
    const leadMinutes = Number(dot.dataset.leadMinutes);
    const x = xForLead(leadMinutes, plotLeft, plotWidth, firstLead, horizon);
    return {
      dot,
      hit:hits[index],
      leadMinutes,
      x,
      y:Number(dot.getAttribute('cy'))
    };
  }).filter(row => [row.leadMinutes, row.x, row.y].every(Number.isFinite));
  if (rows.length !== dots.length) return;

  rows.forEach(row => {
    row.dot.setAttribute('cx', row.x.toFixed(1));
    row.hit.setAttribute('cx', row.x.toFixed(1));
  });

  const segments = contiguousDisplayRows(rows);
  const lines = [...chart.querySelectorAll('.rain-home-line')];
  if (lines.length === segments.length) {
    lines.forEach((path, index) => {
      path.setAttribute('d', segments[index].map((row, rowIndex) => `${rowIndex ? 'L' : 'M'} ${row.x.toFixed(1)} ${row.y.toFixed(1)}`).join(' '));
    });
  }

  const plotBottom = Math.max(...[...chart.querySelectorAll('.rain-home-grid')]
    .map(line => Number(line.getAttribute('y1')))
    .filter(Number.isFinite));
  const area = chart.querySelector('.rain-home-area');
  if (area && Number.isFinite(plotBottom) && segments.length === 1 && segments[0].length >= 2) {
    const segment = segments[0];
    const line = segment.map((row, index) => `${index ? 'L' : 'M'} ${row.x.toFixed(1)} ${row.y.toFixed(1)}`).join(' ');
    area.setAttribute('d', `${line} L ${segment.at(-1).x.toFixed(1)} ${plotBottom.toFixed(1)} L ${segment[0].x.toFixed(1)} ${plotBottom.toFixed(1)} Z`);
  }

  const intensityPaths = [...chart.querySelectorAll('[data-rain-home-intensity-layer] .rain-home-intensity-area')];
  const drawableSegments = segments.filter(segment => segment.length >= 2);
  if (Number.isFinite(plotBottom) && intensityPaths.length === drawableSegments.length) {
    drawableSegments.forEach((segment, index) => {
      const line = segment.map((row, rowIndex) => `${rowIndex ? 'L' : 'M'} ${row.x.toFixed(1)} ${row.y.toFixed(1)}`).join(' ');
      intensityPaths[index].setAttribute('d', `${line} L ${segment.at(-1).x.toFixed(1)} ${plotBottom.toFixed(1)} L ${segment[0].x.toFixed(1)} ${plotBottom.toFixed(1)} Z`);
    });
  }

  [...chart.querySelectorAll('.rain-home-axis-lead')].forEach(label => {
    const textNode = label.closest('text');
    const text = String(label.textContent || '').trim();
    if (!textNode) return;
    if (text === '基準') {
      textNode.setAttribute('display', 'none');
      return;
    }
    const match = text.match(/^\+(\d+)$/);
    const leadMinutes = match ? Number(match[1]) : NaN;
    const x = xForLead(leadMinutes, plotLeft, plotWidth, firstLead, horizon);
    if (!Number.isFinite(x)) return;
    textNode.removeAttribute('display');
    textNode.setAttribute('x', x.toFixed(1));
    textNode.setAttribute('text-anchor', leadMinutes === firstLead ? 'start' : leadMinutes === horizon ? 'end' : 'middle');
    textNode.querySelectorAll('tspan').forEach(tspan => tspan.setAttribute('x', x.toFixed(1)));
  });

  chart.querySelector('.rain-home-unavailable-zone')?.setAttribute('display', 'none');
  chart.querySelector('.rain-home-first-lead')?.setAttribute('display', 'none');
  chart.querySelector('.rain-home-unavailable-label')?.setAttribute('display', 'none');

  const selectedIndex = dots.findIndex(dot => dot.classList.contains('selected'));
  const guide = chart.querySelector('[data-rain-home-guide]');
  if (guide && selectedIndex >= 0 && rows[selectedIndex]) {
    guide.setAttribute('x1', rows[selectedIndex].x.toFixed(1));
    guide.setAttribute('x2', rows[selectedIndex].x.toFixed(1));
  }

  bindFitAxisPointer(chart, rows);
  chart.dataset.rainHomeForecastAxis = '3';
}

function polishChart(root) {
  const chart = root.querySelector('.rain-home-chart');
  if (!chart) return;
  chart.closest('.rain-home-chart-wrap')?.setAttribute('data-rain-home-fit-chart', '1');
  remapForecastChart(chart);
}

export function polishRainHomeRoot(root) {
  if (!root || root.dataset?.viewKind !== 'ready') return false;
  root.dataset.rainHomeUiPolish = '3';
  polishHero(root);
  polishTiming(root);
  polishRadar(root);
  polishChart(root);
  return true;
}

let scheduled = false;
function schedulePolish() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const root = document.querySelector('.rain-home-root[data-view-kind="ready"]');
    if (root) polishRainHomeRoot(root);
  });
}

function initRainHomeUiPolish() {
  injectStyles();
  schedulePolish();
  const content = document.getElementById('forecast-content');
  if (content) {
    const observer = new MutationObserver(schedulePolish);
    observer.observe(content, { childList:true, subtree:true, characterData:true });
  }
  window.addEventListener('rain:location-change', schedulePolish);
  window.addEventListener('rain:refresh', schedulePolish);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initRainHomeUiPolish, { once:true });
  else initRainHomeUiPolish();
}
