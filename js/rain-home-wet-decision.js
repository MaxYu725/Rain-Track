const SERIES_SESSION_PREFIX = 'rain-home-series-v1:';
const SVG_NS = 'http://www.w3.org/2000/svg';

export const RAIN_HOME_TRACE_RAIN_MM = 0.01;
export const RAIN_HOME_MEANINGFUL_RAIN_MM = 0.2;
export const RAIN_HOME_WET_BANDS = Object.freeze([
  { key:'dry', min:0, label:'乾燥' },
  { key:'light', min:RAIN_HOME_TRACE_RAIN_MM, label:'小雨' },
  { key:'weak', min:0.5, label:'雨勢較弱' },
  { key:'moderate', min:2, label:'中等雨勢' },
  { key:'strong', min:5, label:'雨勢較強' },
  { key:'very-strong', min:10, label:'強降雨' }
]);

export function rainHomeWetBand(amountMm) {
  const amount = Number(amountMm);
  if (!Number.isFinite(amount) || amount < RAIN_HOME_TRACE_RAIN_MM) return RAIN_HOME_WET_BANDS[0];
  if (amount < 0.5) return RAIN_HOME_WET_BANDS[1];
  if (amount < 2) return RAIN_HOME_WET_BANDS[2];
  if (amount < 5) return RAIN_HOME_WET_BANDS[3];
  if (amount < 10) return RAIN_HOME_WET_BANDS[4];
  return RAIN_HOME_WET_BANDS[5];
}

export function classifyRainHomeWetForecast(points, { nowMs = Date.now() } = {}) {
  const all = (Array.isArray(points) ? points : [])
    .filter(point => Number.isFinite(Number(point?.amountMm)) && Number.isFinite(Date.parse(point?.validTime || '')))
    .slice()
    .sort((a, b) => Date.parse(a.validTime) - Date.parse(b.validTime));
  const relevant = all.filter(point => Date.parse(point.validTime) >= nowMs - 60_000);
  if (!relevant.length) return { state:'expired', relevant:[], peak:null, peakMm:0, band:rainHomeWetBand(0), onset:null, onsetPrevious:null, risingAtEnd:false };

  const peak = relevant.reduce((best, point) => Number(point.amountMm) > Number(best.amountMm) ? point : best, relevant[0]);
  const peakMm = Math.max(0, Number(peak.amountMm) || 0);
  const band = rainHomeWetBand(peakMm);
  if (band.key === 'dry') return { state:'dry', relevant, peak, peakMm, band, onset:null, onsetPrevious:null, risingAtEnd:false };

  const onsetThreshold = peakMm >= 0.5 ? RAIN_HOME_MEANINGFUL_RAIN_MM : RAIN_HOME_TRACE_RAIN_MM;
  const onsetIndex = Math.max(0, relevant.findIndex(point => Number(point.amountMm) >= onsetThreshold));
  const onset = relevant[onsetIndex] || relevant[0];
  const onsetPrevious = onsetIndex > 0 ? relevant[onsetIndex - 1] : null;
  const peakIndex = relevant.indexOf(peak);
  const risingAtEnd = peakIndex === relevant.length - 1;
  const onsetMs = Date.parse(onset.validTime);
  const state = onsetMs <= nowMs + 30 * 60_000 ? 'near-term-wet' : 'later-wet';

  return { state, relevant, peak, peakMm, band, onset, onsetPrevious, risingAtEnd };
}

export function wetDecisionHeadline(decision, { currentEcho = false } = {}) {
  const band = decision?.band?.key;
  if (!band || band === 'dry' || decision?.state === 'expired') return '';
  if (currentEcho) {
    if (band === 'very-strong') return '目前附近有雨，稍後仍有強降雨';
    if (band === 'strong') return '目前附近有雨，稍後雨勢仍較強';
    if (band === 'moderate') return '目前附近有雨，稍後仍有中等雨勢';
    if (band === 'weak') return '目前附近有雨，稍後仍有雨';
    return '目前附近有回波，接下來有小雨';
  }
  if (band === 'very-strong') return '稍後有強降雨';
  if (band === 'strong') return decision?.risingAtEnd ? '稍後雨勢明顯增強' : '稍後有較強降雨';
  if (band === 'moderate') return '稍後有中等雨勢';
  if (band === 'weak') return '稍後有雨';
  return '接下來有小雨';
}

function formatClock(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-HK', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Asia/Hong_Kong' }).format(date);
}

function formatRain(value) {
  const amount = Math.max(0, Number(value) || 0);
  if (amount >= 10) return amount.toFixed(0);
  if (amount >= 1) return amount.toFixed(1).replace(/\.0$/, '');
  return amount.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function wetDecisionNextCopy(decision) {
  const band = decision?.band?.key;
  if (!band || band === 'dry' || decision?.state === 'expired') return '';
  const onsetClock = formatClock(decision.onset?.validTime);
  const when = onsetClock ? `約 ${onsetClock} 後` : '稍後';
  if (band === 'very-strong') return `SWIRLS ${when}有強降雨`;
  if (band === 'strong') return decision.risingAtEnd ? `SWIRLS ${when}雨勢明顯增強` : `SWIRLS ${when}有較強降雨`;
  if (band === 'moderate') return `SWIRLS ${when}有中等雨勢`;
  if (band === 'weak') return `SWIRLS ${when}有雨`;
  return 'SWIRLS 接下來有小雨';
}

export function wetDecisionDetail(decision) {
  if (!decision?.peak || decision?.band?.key === 'dry' || decision?.state === 'expired') return '';
  const onsetClock = formatClock(decision.onset?.validTime);
  const peakClock = formatClock(decision.peak.validTime);
  const peakRain = formatRain(decision.peakMm);
  const start = onsetClock ? `約 ${onsetClock} 後雨量開始增加` : '稍後雨量開始增加';
  const peak = peakClock ? `至 ${peakClock} 約 ${peakRain} mm / 30 min` : `最高約 ${peakRain} mm / 30 min`;
  if (decision.risingAtEnd) return `${start}，${peak}，預報末段仍在增強。`;
  const lastMm = Number(decision.relevant?.at(-1)?.amountMm) || 0;
  const ratio = decision.peakMm > 0 ? lastMm / decision.peakMm : 1;
  if (ratio <= 0.45) return `${start}，${peak}，之後明顯減弱。`;
  if (ratio <= 0.7) return `${start}，${peak}，之後逐步減弱。`;
  if (ratio <= 0.85) return `${start}，${peak}，之後稍為回落。`;
  return `${start}，${peak}。`;
}

function readSeries(root) {
  const key = root?.dataset?.pointKey;
  if (!key) return null;
  try {
    const stored = JSON.parse(sessionStorage.getItem(`${SERIES_SESSION_PREFIX}${key}`) || 'null');
    return stored?.data && Array.isArray(stored.data.points) ? stored.data : null;
  } catch {
    return null;
  }
}

function radarState(root) {
  const observed = root.querySelector('[data-rain-home-observed-radar]');
  if (!observed) return { known:false, currentEcho:false };
  const segments = [...observed.querySelectorAll('.rain-home-observed-segment')];
  const latest = segments.at(-1);
  const currentEcho = Boolean(latest && /\blevel-[1-5]\b/.test(latest.className));
  return { known:true, currentEcho };
}

function updateTiming(root, nextCopy) {
  const timing = root.querySelector('.rain-home-timing');
  if (!timing || !nextCopy) return;
  const items = [...timing.querySelectorAll('.rain-home-now-next-item')];
  if (items.length) {
    const nextItem = items.find(item => item.querySelector('.rain-home-now-next-label')?.textContent?.trim() === '接下來');
    const copy = nextItem?.querySelector('.rain-home-now-next-copy');
    if (copy && copy.textContent !== nextCopy) copy.textContent = nextCopy;
    return;
  }
  const text = String(timing.textContent || '').trim();
  if (!/雷達|SWIRLS/.test(text)) return;
  const parts = text.split(/\s+·\s+/).filter(Boolean);
  const current = parts.find(part => /雷達/.test(part)) || parts[0] || '';
  const replacement = current ? `${current} · ${nextCopy}` : nextCopy;
  if (text !== replacement) timing.textContent = replacement;
}

function updateHero(root, decision) {
  if (!decision || decision.state === 'dry' || decision.state === 'expired') return;
  const radar = radarState(root);
  const verdict = root.querySelector('.rain-home-verdict');
  const detail = root.querySelector('.rain-home-detail');
  const headline = wetDecisionHeadline(decision, { currentEcho:radar.currentEcho });
  const nextCopy = wetDecisionNextCopy(decision);
  const nextDetail = wetDecisionDetail(decision);
  if (verdict && headline && verdict.textContent !== headline) verdict.textContent = headline;
  if (detail && nextDetail && detail.textContent !== nextDetail) detail.textContent = nextDetail;
  updateTiming(root, nextCopy);
  root.dataset.rainHomeNowNext = decision.band.key === 'light' ? 'light-rain' : 'wet-decision';
  root.classList.remove('is-dry-now-next');

  const subtitle = document.getElementById('mobile-title-sub');
  if (subtitle && headline) {
    const current = String(subtitle.textContent || '').trim();
    const location = current.split(/\s+·\s+/)[0] || root.querySelector('.rain-home-location-name')?.textContent?.trim() || '';
    const short = decision.band.key === 'strong' ? '稍後雨勢較強' : decision.band.key === 'very-strong' ? '稍後有強降雨' : headline;
    const replacement = location ? `${location} · ${short}` : short;
    if (current !== replacement) subtitle.textContent = replacement;
  }
}

function chartRows(root, points) {
  const chart = root.querySelector('.rain-home-chart');
  if (!chart) return { chart:null, rows:[] };
  const dots = [...chart.querySelectorAll('.rain-home-dot')];
  if (!dots.length || dots.length !== points.length) return { chart, rows:[] };
  const rows = points.map((point, index) => ({
    point,
    dot:dots[index],
    x:Number(dots[index].getAttribute('cx')),
    y:Number(dots[index].getAttribute('cy')),
    amountMm:Number(point.amountMm) || 0
  })).filter(row => Number.isFinite(row.x) && Number.isFinite(row.y));
  return { chart, rows };
}

function plotBounds(chart) {
  const ys = [...chart.querySelectorAll('.rain-home-grid')].map(line => Number(line.getAttribute('y1'))).filter(Number.isFinite);
  if (!ys.length) return null;
  return { top:Math.min(...ys), bottom:Math.max(...ys) };
}

function addText(group, { x, y, text, anchor = 'middle', className }) {
  const node = document.createElementNS(SVG_NS, 'text');
  node.setAttribute('x', String(x));
  node.setAttribute('y', String(y));
  node.setAttribute('text-anchor', anchor);
  node.setAttribute('class', className);
  node.textContent = text;
  group.append(node);
}

function updateAnnotations(root, points, decision) {
  const { chart, rows } = chartRows(root, points);
  if (!chart) return;
  const existing = chart.querySelector('[data-rain-home-wet-annotations]');
  if (!decision || decision.peakMm < 0.5 || !rows.length || root.classList.contains('is-dry-chart')) {
    existing?.remove();
    return;
  }
  const bounds = plotBounds(chart);
  if (!bounds) return;
  const onsetIndex = points.indexOf(decision.onset);
  const peakIndex = points.indexOf(decision.peak);
  const onsetRow = rows[onsetIndex];
  const peakRow = rows[peakIndex];
  if (!onsetRow || !peakRow) return;

  const signature = `${onsetRow.x.toFixed(1)}|${peakRow.x.toFixed(1)}|${peakRow.y.toFixed(1)}|${decision.peakMm.toFixed(3)}`;
  if (existing?.dataset?.signature === signature) return;
  existing?.remove();

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('data-rain-home-wet-annotations', '1');
  group.setAttribute('aria-hidden', 'true');
  group.dataset.signature = signature;

  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(onsetRow.x));
  line.setAttribute('x2', String(onsetRow.x));
  line.setAttribute('y1', String(bounds.top));
  line.setAttribute('y2', String(bounds.bottom));
  line.setAttribute('class', 'rain-home-wet-onset-line');
  group.append(line);

  const plotLeft = Number(chart.dataset.plotLeft) || 0;
  const plotWidth = Number(chart.dataset.plotWidth) || 700;
  const onsetAnchor = onsetRow.x < plotLeft + 55 ? 'start' : 'middle';
  addText(group, { x:onsetRow.x + (onsetAnchor === 'start' ? 4 : 0), y:bounds.top + 13, text:'開始有雨', anchor:onsetAnchor, className:'rain-home-wet-onset-label' });

  const peakAnchor = peakRow.x > plotLeft + plotWidth - 55 ? 'end' : 'middle';
  const peakY = peakRow.y <= bounds.top + 20 ? peakRow.y + 22 : peakRow.y - 10;
  addText(group, { x:peakRow.x, y:peakY, text:`約 ${formatRain(decision.peakMm)} mm`, anchor:peakAnchor, className:'rain-home-wet-peak-label' });
  chart.append(group);
}

function injectStyles() {
  if (document.getElementById('rain-home-wet-decision-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-home-wet-decision-style';
  style.textContent = `
    .rain-home-wet-onset-line{stroke:#7b8b92;stroke-width:1;stroke-dasharray:4 5;opacity:.7;vector-effect:non-scaling-stroke;pointer-events:none}
    .rain-home-wet-onset-label,.rain-home-wet-peak-label{fill:#d7e4e9;font-family:"Segoe UI","Microsoft JhengHei",sans-serif;font-size:10px;font-weight:650;paint-order:stroke;stroke:#06090b;stroke-width:4px;stroke-linejoin:round;pointer-events:none}
    .rain-home-wet-peak-label{fill:#f0f6f8;font-size:11px}
    @media(max-width:700px){.rain-home-wet-onset-label,.rain-home-wet-peak-label{font-size:11px}.rain-home-wet-peak-label{font-size:12px}}
  `;
  document.head.append(style);
}

function apply(root) {
  if (!root || root.dataset?.viewKind !== 'ready') return;
  const data = readSeries(root);
  if (!data?.points?.length) return;
  const decision = classifyRainHomeWetForecast(data.points);
  root.dataset.rainHomeWetDecision = decision.band.key;
  updateHero(root, decision);
  updateAnnotations(root, data.points, decision);
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    apply(document.querySelector('.rain-home-root[data-view-kind="ready"]'));
  });
}

function init() {
  injectStyles();
  schedule();
  requestAnimationFrame(schedule);
  setTimeout(schedule, 350);
  const content = document.getElementById('forecast-content');
  if (content) new MutationObserver(schedule).observe(content, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['class','cx','cy'] });
  window.addEventListener('rain:location-change', schedule);
  window.addEventListener('rain:refresh', schedule);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
}
