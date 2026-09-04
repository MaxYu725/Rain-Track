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

export function forecastAmountsLookDry(values, threshold = 0.05) {
  const rows = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (!rows.length) return false;
  return rows.every(value => value < Number(threshold));
}

function injectStyles() {
  if (document.getElementById('rain-home-ui-polish-v4-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-home-ui-polish-v4-style';
  style.textContent = `
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-location{padding:0 0 10px}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-location-kicker{margin-bottom:3px;font-size:.67rem}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-location-name{font-size:clamp(1.42rem,4.5vw,2rem)}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-location-coord{margin-top:4px;font-size:.68rem}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-locate{min-height:38px;padding:0 11px;font-size:.86rem}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-summary{padding:14px 0 12px}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-verdict{max-width:610px;font-size:clamp(1.8rem,4.8vw,2.4rem);font-weight:390;line-height:1.04}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-detail{max-width:610px;margin-top:9px;color:#9aa6ac;line-height:1.48}
    .rain-home-root[data-rain-home-ui-polish="4"].is-dry-now-next .rain-home-summary{padding:11px 0 9px}
    .rain-home-root[data-rain-home-ui-polish="4"].is-dry-now-next .rain-home-verdict{font-size:clamp(1.76rem,4.6vw,2.25rem)}
    .rain-home-root[data-rain-home-ui-polish="4"].is-dry-now-next .rain-home-detail{display:none}

    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-timing[data-rain-home-timing-polished="1"]{
      display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:10px;color:#aab7bd;font-size:.72rem;font-weight:540;line-height:1.3
    }
    .rain-home-now-next-item{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:6px;padding:6px 8px;border:1px solid #1c292f;background:#050a0d}
    .rain-home-now-next-label{color:#7f949e;font-size:.6rem;font-weight:720;letter-spacing:.055em;white-space:nowrap}
    .rain-home-now-next-copy{min-width:0;color:#aab7bd}

    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-observed{margin-bottom:10px}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-observed.is-dry{padding:7px 9px 6px}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-observed.is-dry .rain-home-observed-summary{margin-top:3px;color:#8f9ca2}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-observed.is-dry .rain-home-observed-track,
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-observed.is-dry .rain-home-observed-legend,
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-observed.is-dry .rain-home-observed-times{display:none}

    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-chart-section{padding-top:12px}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-chart-wrap{padding:8px 7px 7px}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-chart-scroll{width:100%;overflow:visible!important;padding-bottom:0!important}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-chart-scroll::-webkit-scrollbar{display:none}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-chart-scroll .rain-home-chart{display:block;width:100%!important;max-width:100%!important;height:auto!important;touch-action:pan-y!important}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-chart-scroll-hint{display:none!important}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-chart-y-gutter{display:none!important}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-chart[data-rain-home-fixed-y-axis="2"] .rain-home-axis-label{opacity:1!important}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-unavailable-zone,
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-first-lead,
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-unavailable-label{display:none!important}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-intensity-legend{margin-bottom:4px}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-chart-help{margin-top:2px;color:#606c72;font-size:.62rem}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-chart-readout{min-height:54px;margin-top:6px;padding:8px 10px}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-meta{margin-top:8px}
    .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-primary-action{min-height:56px;margin-top:15px}

    @media(max-width:700px){
      body.rain-home-v2:not(.rain-map-view) .header-top-bar{min-height:calc(46px + var(--safe-top));height:calc(46px + var(--safe-top));padding:var(--safe-top) 8px 0 10px}
      body.rain-home-v2:not(.rain-map-view) .pivot-content-wrapper{height:calc(100dvh - 46px - var(--safe-top))!important}
      body.rain-home-v2:not(.rain-map-view) .mobile-title-main{font-size:.9rem}
      body.rain-home-v2:not(.rain-map-view) .mobile-title-sub{font-size:.65rem}
      body.rain-home-v2:not(.rain-map-view) .global-controls{gap:3px}
      body.rain-home-v2:not(.rain-map-view) .global-controls .metro-btn{width:36px!important;min-width:36px!important;height:36px!important;padding:0!important;font-size:.88rem!important}
      body.rain-home-v2:not(.rain-map-view) .global-controls .radar-entry-button{width:auto!important;min-width:42px!important;padding:0 7px!important;font-size:.68rem!important}

      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-summary{padding:10px 0 8px}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-verdict{font-size:clamp(1.66rem,6.8vw,2.05rem)}
      .rain-home-root[data-rain-home-ui-polish="4"].is-dry-now-next .rain-home-verdict{font-size:clamp(1.68rem,6.8vw,2rem)}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-detail{font-size:.82rem;line-height:1.44}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-timing[data-rain-home-timing-polished="1"]{grid-template-columns:1fr;margin-top:8px;gap:4px}
      .rain-home-now-next-item{padding:5px 7px}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-chart-section{padding-top:10px}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-chart-wrap{padding:7px 6px 6px}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-axis-label{font-size:10.5px}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-axis-clock{font-size:11.5px}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-axis-lead{font-size:9.5px}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-chart-readout{grid-template-columns:minmax(0,1fr) auto!important;gap:8px 12px}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-readout-value{text-align:right!important}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-readout-unit{display:block!important;margin-left:0!important}
    }

    @media(max-width:390px){
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-location-name{font-size:1.36rem}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-chart-readout{grid-template-columns:minmax(0,1fr) auto!important}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-readout-time{font-size:.79rem}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-readout-window{font-size:.59rem}
      .rain-home-root[data-rain-home-ui-polish="4"] .rain-home-readout-value{font-size:1.03rem}
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
  const timeSpans = [...observed.querySelectorAll('.rain-home-observed-times span')].map(node => String(node.textContent || '').trim()).filter(Boolean);
  const range = timeSpans.length >= 2 ? `${timeSpans[0]}–${timeSpans.at(-1)}` : '';
  const nextText = dry ? `${range ? `${range} · ` : ''}未見明顯回波` : summary.dataset.rainHomeUiOriginalSummary;
  if (summary.textContent !== nextText) summary.textContent = nextText;
}

function amountFromHit(hit) {
  const label = String(hit?.getAttribute('aria-label') || '');
  const match = label.match(/，([0-9]+(?:\.[0-9]+)?) mm \/ 30 min/);
  return match ? Number(match[1]) : NaN;
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

function plotBounds(chart) {
  const values = [...chart.querySelectorAll('.rain-home-grid')]
    .map(line => Number(line.getAttribute('y1')))
    .filter(Number.isFinite);
  if (!values.length) return null;
  return { top:Math.min(...values), bottom:Math.max(...values) };
}

function chartRows(chart) {
  const dots = [...chart.querySelectorAll('.rain-home-dot')];
  const hits = [...chart.querySelectorAll('[data-rain-home-point]')];
  if (!dots.length || dots.length !== hits.length) return [];
  return dots.map((dot, index) => ({
    dot,
    hit:hits[index],
    leadMinutes:Number(dot.dataset.leadMinutes),
    x:Number(dot.getAttribute('cx')),
    y:Number(dot.getAttribute('cy'))
  })).filter(row => [row.leadMinutes, row.x, row.y].every(Number.isFinite));
}

function rebuildPaths(chart, rows, plotBottom) {
  const segments = contiguousDisplayRows(rows);
  const lines = [...chart.querySelectorAll('.rain-home-line')];
  if (lines.length === segments.length) {
    lines.forEach((path, index) => {
      path.setAttribute('d', segments[index].map((row, rowIndex) => `${rowIndex ? 'L' : 'M'} ${row.x.toFixed(1)} ${row.y.toFixed(1)}`).join(' '));
    });
  }

  const area = chart.querySelector('.rain-home-area');
  if (area && Number.isFinite(plotBottom) && segments.length === 1 && segments[0].length >= 2) {
    const segment = segments[0];
    const line = segment.map((row, index) => `${index ? 'L' : 'M'} ${row.x.toFixed(1)} ${row.y.toFixed(1)}`).join(' ');
    area.setAttribute('d', `${line} L ${segment.at(-1).x.toFixed(1)} ${plotBottom.toFixed(1)} L ${segment[0].x.toFixed(1)} ${plotBottom.toFixed(1)} Z`);
  }

  const intensityPaths = [...chart.querySelectorAll('[data-rain-home-intensity-layer] .rain-home-intensity-area')];
  const drawable = segments.filter(segment => segment.length >= 2);
  if (Number.isFinite(plotBottom) && intensityPaths.length === drawable.length) {
    drawable.forEach((segment, index) => {
      const line = segment.map((row, rowIndex) => `${rowIndex ? 'L' : 'M'} ${row.x.toFixed(1)} ${row.y.toFixed(1)}`).join(' ');
      intensityPaths[index].setAttribute('d', `${line} L ${segment.at(-1).x.toFixed(1)} ${plotBottom.toFixed(1)} L ${segment[0].x.toFixed(1)} ${plotBottom.toFixed(1)} Z`);
    });
  }
}

function bindFitAxisPointer(chart) {
  if (chart.dataset.rainHomeFitPointer === '4') return;
  chart.dataset.rainHomeFitPointer = '4';
  chart.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rows = chartRows(chart);
    if (!rows.length) return;
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
  const hits = [...chart.querySelectorAll('[data-rain-home-point]')];
  const dots = [...chart.querySelectorAll('.rain-home-dot')];
  if (!hits.length || hits.length !== dots.length) return [];

  const plotLeft = Number(chart.dataset.plotLeft);
  const plotWidth = Number(chart.dataset.plotWidth);
  const horizon = Number(chart.dataset.horizonMinutes) || 120;
  const leads = dots.map(dot => Number(dot.dataset.leadMinutes)).filter(Number.isFinite);
  const firstLead = Math.min(...leads);
  if (![plotLeft, plotWidth, horizon, firstLead].every(Number.isFinite) || plotWidth <= 0 || horizon <= firstLead) return [];

  const rows = dots.map((dot, index) => ({
    dot,
    hit:hits[index],
    leadMinutes:Number(dot.dataset.leadMinutes),
    x:xForLead(Number(dot.dataset.leadMinutes), plotLeft, plotWidth, firstLead, horizon),
    y:Number(dot.getAttribute('cy'))
  })).filter(row => [row.leadMinutes, row.x, row.y].every(Number.isFinite));
  if (rows.length !== dots.length) return [];

  rows.forEach(row => {
    row.dot.setAttribute('cx', row.x.toFixed(1));
    row.hit.setAttribute('cx', row.x.toFixed(1));
  });

  const bounds = plotBounds(chart);
  rebuildPaths(chart, rows, bounds?.bottom);

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

  bindFitAxisPointer(chart);
  chart.dataset.rainHomeForecastAxis = '4';
  return rows;
}

function compressDryChart(chart) {
  const bounds = plotBounds(chart);
  if (!bounds || bounds.bottom <= bounds.top) return false;
  const oldTop = bounds.top;
  const oldBottom = bounds.bottom;
  const targetHeight = 210;
  const targetTop = 14;
  const targetBottom = 128;
  const mapY = value => targetTop + (Number(value) - oldTop) * (targetBottom - targetTop) / (oldBottom - oldTop);

  [...chart.querySelectorAll('.rain-home-grid')].forEach(line => {
    const next = mapY(line.getAttribute('y1'));
    line.setAttribute('y1', next.toFixed(1));
    line.setAttribute('y2', next.toFixed(1));
  });
  [...chart.querySelectorAll('.rain-home-axis-label')].forEach(label => {
    const source = Number(label.getAttribute('y')) - 4;
    const next = mapY(source);
    label.setAttribute('y', (next + 4).toFixed(1));
  });

  const rows = chartRows(chart);
  rows.forEach(row => {
    const next = mapY(row.y);
    row.y = next;
    row.dot.setAttribute('cy', next.toFixed(1));
    row.hit.setAttribute('cy', next.toFixed(1));
  });
  rebuildPaths(chart, rows, targetBottom);

  const guide = chart.querySelector('[data-rain-home-guide]');
  if (guide) {
    guide.setAttribute('y1', String(targetTop));
    guide.setAttribute('y2', String(targetBottom));
  }
  [...chart.querySelectorAll('.rain-home-axis-lead')].forEach(label => {
    label.closest('text')?.setAttribute('y', String(targetHeight - 35));
  });

  const width = chart.viewBox?.baseVal?.width || 700;
  chart.setAttribute('viewBox', `0 0 ${width} ${targetHeight}`);
  chart.dataset.rainHomeDryChart = '1';
  return true;
}

function polishChart(root) {
  const chart = root.querySelector('.rain-home-chart');
  if (!chart) return;
  const wrap = chart.closest('.rain-home-chart-wrap');
  wrap?.setAttribute('data-rain-home-fit-chart', '1');
  remapForecastChart(chart);

  const hits = [...chart.querySelectorAll('[data-rain-home-point]')];
  const amounts = hits.map(amountFromHit).filter(Number.isFinite);
  const dry = forecastAmountsLookDry(amounts);
  root.classList.toggle('is-dry-chart', dry);
  wrap?.classList.toggle('is-dry-chart', dry);
  if (dry) compressDryChart(chart);

  const help = root.querySelector('.rain-home-chart-help:not(.is-partial)');
  if (help && help.textContent !== '點按時間查看雨量') help.textContent = '點按時間查看雨量';
}

export function polishRainHomeRoot(root) {
  if (!root || root.dataset?.viewKind !== 'ready') return false;
  root.dataset.rainHomeUiPolish = '4';
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
  requestAnimationFrame(() => {
    schedulePolish();
    requestAnimationFrame(schedulePolish);
  });
  setTimeout(schedulePolish, 250);

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
