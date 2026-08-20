import { fetchSwirlsPointSeries } from './api.js';
import { setRainMapMode } from './rain-map-mode.js';
import {
  RAIN_HOME_CADENCE_MINUTES,
  RAIN_HOME_FIRST_LEAD_MINUTES,
  RAIN_HOME_HORIZON_MINUTES,
  RAIN_HOME_RAIN_THRESHOLD_MM,
  expectedRainHomeLeadMinutes,
  findFirstWetSignalTransition,
  rainHomeLeadRatio
} from './rain-home-time.js';
import { state } from './state.js';

const SERIES_CACHE_MS = 4 * 60 * 1000;
const FRAME_COUNT = 16;
const seriesCache = new Map();

let observer = null;
let requestToken = 0;
let activeLoadKey = '';
let activeController = null;
let viewState = { kind:'idle', key:'', point:null, data:null, error:null, cached:false };

function pointKey(point = state.selected) {
  return `${Number(point?.lat).toFixed(4)}|${Number(point?.lon).toFixed(4)}`;
}

function injectStyles() {
  if (document.getElementById('rain-home-v2-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-home-v2-style';
  style.textContent = `
    body.rain-home-v2 #sheet-handle,body.rain-home-v2 #forecast-toggle{display:none!important}
    body.rain-home-v2:not(.rain-map-view) .pivot-content-wrapper{overflow:auto!important;background:#000}
    body.rain-home-v2:not(.rain-map-view) #map-container{height:auto!important;min-height:100%;overflow:visible!important;background:#000}
    body.rain-home-v2:not(.rain-map-view) #rain-map{visibility:hidden!important;pointer-events:none!important}
    body.rain-home-v2:not(.rain-map-view) .source-badges,body.rain-home-v2:not(.rain-map-view) .map-hint,
    body.rain-home-v2:not(.rain-map-view) #coordinate-readout,body.rain-home-v2:not(.rain-map-view) #mobile-status,
    body.rain-home-v2:not(.rain-map-view) #radar-timeline,body.rain-home-v2:not(.rain-map-view) #desktop-drawer-button{display:none!important}
    body.rain-home-v2:not(.rain-map-view) #forecast-panel{position:relative!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;width:min(760px,100%)!important;max-width:none!important;max-height:none!important;height:auto!important;margin:0 auto!important;border:0!important;background:#000!important;box-shadow:none!important;overflow:visible!important;transform:none!important;transition:none!important}
    body.rain-home-v2:not(.rain-map-view) #forecast-panel .panel-inner{padding:18px 20px calc(30px + var(--safe-bottom))!important}
    body.rain-home-v2.rain-map-view .pivot-content-wrapper,body.rain-home-v2.rain-map-view #map-container,body.rain-home-v2.rain-map-view #rain-map{height:100%!important;overflow:hidden!important;visibility:visible!important;pointer-events:auto!important}
    body.rain-home-v2.rain-map-view #forecast-panel,body.rain-home-v2.rain-map-view .map-hint{display:none!important}
    .rain-home-root{max-width:720px;margin:0 auto;padding:6px 0 28px;color:#fff}
    .rain-home-location{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:6px 0 20px;border-bottom:1px solid #252525}.rain-home-location>div{min-width:0}
    .rain-home-location-kicker{margin:0 0 6px;color:#929ca1;font-size:.72rem;font-weight:650;letter-spacing:.08em;text-transform:uppercase}.rain-home-location-name{margin:0;color:#fff;font-size:clamp(1.55rem,5vw,2.35rem);font-weight:480;letter-spacing:-.03em;line-height:1.12;overflow-wrap:anywhere}.rain-home-location-coord{margin-top:7px;color:#6f787c;font-size:.72rem;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
    .rain-home-locate{flex:0 0 auto;min-height:42px;padding:0 13px;border:1px solid #424b50;background:#0b0e10;color:#e5e9eb;font-weight:600}.rain-home-locate:hover{border-color:#68757b;background:#111619}
    .rain-home-summary{padding:29px 0 24px}.rain-home-verdict-kicker{margin:0 0 7px;color:#7d8a90;font-size:.72rem;font-weight:650;letter-spacing:.055em}.rain-home-verdict{margin:0;max-width:680px;color:#fff;font-size:clamp(2rem,6vw,3rem);font-weight:360;letter-spacing:-.042em;line-height:1.08;text-wrap:balance}.rain-home-timing{margin-top:9px;color:var(--accent);font-size:clamp(1rem,3.5vw,1.22rem);font-weight:650;line-height:1.35}.rain-home-detail{max-width:650px;margin:11px 0 0;color:#aeb8bd;font-size:.92rem;line-height:1.62}
    .rain-home-chart-section{margin-top:4px;padding:20px 0 0;border-top:1px solid #252525}.rain-home-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:9px}.rain-home-section-title{margin:0;color:#fff;font-size:1.02rem;font-weight:680}.rain-home-section-note{max-width:360px;color:#768288;font-size:.69rem;text-align:right;line-height:1.45}.rain-home-chart-summary{margin:0 0 10px;color:#c9d7dd;font-size:.78rem;font-weight:650}
    .rain-home-chart-wrap{position:relative;padding:15px 14px 12px;border:1px solid #20292e;background:#06090b}.rain-home-chart{display:block;width:100%;height:auto;overflow:visible;color:var(--accent);touch-action:pan-y;cursor:crosshair}.rain-home-grid{stroke:#20282c;stroke-width:1;vector-effect:non-scaling-stroke}.rain-home-axis-label{fill:#68757b;font-size:10px;font-family:"Segoe UI","Microsoft JhengHei",sans-serif}.rain-home-axis-clock{fill:#c0c8cc;font-size:11px;font-weight:650;font-variant-numeric:tabular-nums}.rain-home-axis-lead{fill:#657177;font-size:9px}.rain-home-line{fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}.rain-home-area{fill:currentColor;opacity:.07}.rain-home-unavailable-zone{fill:#fff;opacity:.018}.rain-home-first-lead{stroke:#53636a;stroke-width:1;stroke-dasharray:3 5;opacity:.5;vector-effect:non-scaling-stroke}.rain-home-unavailable-label{fill:#59666c;font-size:9px}.rain-home-selection-guide{stroke:currentColor;stroke-width:1;stroke-dasharray:4 4;opacity:0;transition:opacity .15s ease;vector-effect:non-scaling-stroke;pointer-events:none}.rain-home-selection-guide.is-active{opacity:.38}.rain-home-dot{fill:#06090b;stroke:currentColor;stroke-width:2;vector-effect:non-scaling-stroke}.rain-home-dot.peak{fill:currentColor;stroke-width:2}.rain-home-dot.selected{fill:currentColor;stroke-width:3;r:5.5}.rain-home-hit{fill:transparent;stroke:transparent;stroke-width:1;cursor:pointer;outline:none}.rain-home-hit:focus-visible{stroke:var(--cyan);stroke-width:2;fill:rgba(0,216,255,.08)}
    .rain-home-chart-readout{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px 20px;margin:12px 0 0;padding:12px 13px;border-top:1px solid #263238;background:#091013;min-height:66px}.rain-home-chart-readout[hidden]{display:none}.rain-home-readout-time{color:#fff;font-size:.9rem;font-weight:680}.rain-home-readout-window{margin-top:4px;color:#748188;font-size:.68rem}.rain-home-readout-value{color:#dff5ff;font-size:1.25rem;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}.rain-home-readout-unit{display:block;margin-top:1px;color:#71828a;font-size:.6rem;font-weight:500}
    .rain-home-chart-help{margin-top:7px;color:#535f64;font-size:.64rem}.rain-home-chart-help.is-partial{color:#9f7e59}.rain-home-meta{margin-top:13px;color:#68757b;font-size:.68rem;line-height:1.5}.rain-home-meta.is-partial{color:#d8a66f}.rain-home-meta strong{color:#94a0a6;font-weight:650}
    .rain-home-primary-action{display:flex;width:100%;min-height:61px;align-items:center;justify-content:space-between;gap:16px;margin-top:22px;padding:10px 16px;border:1px solid #365f73;background:#061117;color:#fff;text-align:left}.rain-home-action-copy{display:flex;min-width:0;flex-direction:column;gap:3px}.rain-home-action-copy strong{font-size:.94rem}.rain-home-action-copy small{color:#7994a0;font-size:.7rem}.rain-home-action-arrow{color:var(--accent);font-size:1.35rem}.rain-home-primary-action:disabled{opacity:.62;cursor:progress}
    .rain-home-loading{display:flex;min-height:330px;flex-direction:column;justify-content:center;gap:16px;color:#929ca1}.rain-home-loading-head{display:flex;align-items:center;gap:11px}.rain-home-loading-head strong{color:#d6dde0;font-size:.9rem}.rain-home-loading-head span:last-child{display:block;margin-top:2px;color:#707a7f;font-size:.7rem}.rain-home-loading-spinner{width:26px;height:26px;border:2px solid #313a3e;border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}.rain-home-skeleton{display:grid;gap:10px;padding:16px;border:1px solid #20282c;background:#06090a}.rain-home-skeleton-line,.rain-home-skeleton-chart{background:#11171a}.rain-home-skeleton-line{height:13px}.rain-home-skeleton-line.short{width:56%}.rain-home-skeleton-line.medium{width:78%}.rain-home-skeleton-chart{height:126px;margin-top:5px}
    .rain-home-error{display:grid;gap:9px;margin-top:22px;padding:15px;border:1px solid #5d3a23;background:#160e08;color:#e9c29b;line-height:1.55}.rain-home-error strong{color:#f2d2b5}.rain-home-error-detail{color:#b89070;font-size:.74rem;overflow-wrap:anywhere}.rain-home-back-map{position:absolute;z-index:1200;top:12px;left:12px;display:none;min-height:42px;padding:0 13px;border:1px solid #5b5b5b;background:rgba(0,0,0,.9);color:#fff}body.rain-home-v2.rain-map-view .rain-home-back-map{display:block}
    @media(max-width:700px){body.rain-home-v2:not(.rain-map-view) #forecast-panel .panel-inner{padding:12px 16px calc(26px + var(--safe-bottom))!important}.rain-home-location{padding-bottom:17px}.rain-home-summary{padding:23px 0 19px}.rain-home-verdict{font-size:clamp(1.9rem,9vw,2.7rem)}.rain-home-section-head{align-items:flex-start;flex-direction:column;gap:5px}.rain-home-section-note{text-align:left}.rain-home-chart-wrap{padding:12px 9px 10px}.rain-home-loading{min-height:300px}}
    @media(max-width:390px){.rain-home-chart-readout{grid-template-columns:1fr}.rain-home-readout-value{text-align:left}.rain-home-readout-unit{display:inline;margin-left:5px}}
    @media(prefers-reduced-motion:reduce){.rain-home-loading-spinner{animation:none!important}.rain-home-selection-guide{transition:none!important}}
  `;
  document.head.append(style);
}

function prepareShell() {
  document.body.classList.add('rain-home-v2');
  document.body.classList.remove('sheet-peek-active', 'sheet-expanded-active');
  document.getElementById('sheet-handle')?.remove();
  document.getElementById('forecast-toggle')?.remove();
  const panel = document.getElementById('forecast-panel');
  panel?.classList.remove('collapsed', 'sheet-peek', 'sheet-half', 'sheet-full', 'dragging');
  panel?.removeAttribute('data-sheet');
  ensureBackButton();
}

function ensureBackButton() {
  if (document.getElementById('rain-home-back-map')) return;
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer) return;
  const button = document.createElement('button');
  button.id = 'rain-home-back-map';
  button.className = 'rain-home-back-map';
  button.type = 'button';
  button.textContent = '← 定位預報';
  button.setAttribute('aria-label', '返回目前位置降雨預報');
  button.addEventListener('click', async () => {
    await setRainMapMode('off');
    setMapView(false);
  });
  mapContainer.append(button);
}

function setMapView(on) {
  document.body.classList.toggle('rain-map-view', Boolean(on));
  requestAnimationFrame(() => state.map?.invalidateSize?.());
}

async function requestSeries({ force = false } = {}) {
  const content = document.getElementById('forecast-content');
  const point = state.selected;
  if (!content || !validPoint(point)) return;

  const key = pointKey(point);
  if (activeLoadKey === key) return;

  const cached = seriesCache.get(key);
  if (!force && cached && Date.now() - cached.savedAt < SERIES_CACHE_MS) {
    viewState = { kind:'ready', key, point:{ ...point }, data:cached.data, error:null, cached:true };
    renderCurrentView(content);
    return;
  }

  activeController?.abort();
  activeController = new AbortController();
  activeLoadKey = key;
  const token = ++requestToken;
  viewState = { kind:'loading', key, point:{ ...point }, data:null, error:null, cached:false };
  renderCurrentView(content);

  try {
    const data = normalizeSeries(await fetchSwirlsPointSeries(point, { signal:activeController.signal }));
    if (token !== requestToken || pointKey(state.selected) !== key) return;
    seriesCache.set(key, { data, savedAt:Date.now() });
    viewState = { kind:'ready', key, point:{ ...state.selected }, data, error:null, cached:false };
    renderCurrentView(content);
  } catch (error) {
    if (error?.name === 'AbortError' || token !== requestToken) return;
    viewState = { kind:'error', key, point:{ ...state.selected }, data:null, error, cached:false };
    renderCurrentView(content);
  } finally {
    if (token === requestToken) activeLoadKey = '';
  }
}

function validPoint(point) {
  return Boolean(point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon)));
}

function normalizeSeries(data) {
  const points = Array.isArray(data?.points) ? [...data.points].sort((a,b) => Number(a.frameIndex) - Number(b.frameIndex)) : [];
  if (data?.ok !== true) throw new Error('兩小時 SWIRLS 定位序列無效');
  if (Number(data.cadenceMinutes) !== RAIN_HOME_CADENCE_MINUTES || Number(data.accumulationMinutes) !== 30) throw new Error('兩小時預報時間規格不符');
  if (!Date.parse(data.runTime || '')) throw new Error('兩小時預報缺少有效基準時間');

  const seen = new Set();
  points.forEach(point => {
    const frameIndex = Number(point.frameIndex);
    const expectedLead = expectedRainHomeLeadMinutes(frameIndex);
    if (
      !Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= FRAME_COUNT || seen.has(frameIndex) ||
      Number(point.leadMinutes) !== expectedLead ||
      !Number.isFinite(Number(point.amountMm)) || Number(point.amountMm) < 0 ||
      !Date.parse(point.validTime || '')
    ) throw new Error('兩小時預報含無效資料點');
    const expectedValid = Date.parse(data.runTime) + expectedLead * 60_000;
    if (Math.abs(Date.parse(point.validTime) - expectedValid) > 1000) throw new Error('兩小時預報有效時間與基準不符');
    seen.add(frameIndex);
  });

  const missingFrames = Array.from({ length:FRAME_COUNT }, (_, frameIndex) => frameIndex).filter(frameIndex => !seen.has(frameIndex));
  if (!points.length) throw new Error('兩小時 SWIRLS 定位序列沒有可用資料點');
  if (data.complete === true && missingFrames.length) throw new Error('兩小時 SWIRLS 完整旗標與資料不符');

  return { ...data, complete:missingFrames.length === 0, points, missingFrames };
}

function renderCurrentView(content = document.getElementById('forecast-content')) {
  if (!content || !viewState.point) return;
  if (viewState.kind === 'ready') renderHome(content, viewState.point, viewState.data, { cached:viewState.cached });
  else if (viewState.kind === 'error') renderUnavailable(content, viewState.point, viewState.error);
  else renderLoading(content, viewState.point);
}

function restoreOwnedView() {
  const content = document.getElementById('forecast-content');
  if (!content || viewState.kind === 'idle' || !viewState.point) return;
  const root = content.querySelector('.rain-home-root[data-rain-home-owned="series"]');
  if (root?.dataset.pointKey === viewState.key && root?.dataset.viewKind === viewState.kind) return;
  renderCurrentView(content);
}

function renderLoading(content, point) {
  content.innerHTML = `
    <section class="rain-home-root" data-rain-home-owned="series" data-view-kind="loading" data-point-key="${escapeHtml(pointKey(point))}">
      ${locationMarkup(point)}
      <div class="rain-home-loading" role="status" aria-live="polite">
        <div class="rain-home-loading-head"><span class="rain-home-loading-spinner" aria-hidden="true"></span><div><strong>正在整理未來兩小時雨勢</strong><span>一次讀取 SWIRLS +30 至 +120 分鐘定位序列…</span></div></div>
        <div class="rain-home-skeleton" aria-hidden="true"><div class="rain-home-skeleton-line short"></div><div class="rain-home-skeleton-line medium"></div><div class="rain-home-skeleton-chart"></div></div>
      </div>
    </section>`;
  bindHomeActions(content);
}

function renderUnavailable(content, point, error) {
  content.innerHTML = `
    <section class="rain-home-root" data-rain-home-owned="series" data-view-kind="error" data-point-key="${escapeHtml(pointKey(point))}">
      ${locationMarkup(point)}
      <div class="rain-home-summary"><div class="rain-home-verdict-kicker">資料暫時不可用</div><h1 class="rain-home-verdict">定位序列未能載入</h1><p class="rain-home-detail">此狀態不會自動重試。可使用頁面更新按鈕或重新定位後再讀取。</p></div>
      <div class="rain-home-error" role="alert"><strong>SWIRLS 資料讀取失敗</strong><span class="rain-home-error-detail">${escapeHtml(error?.message || String(error))}</span></div>
      ${mapActionMarkup()}
    </section>`;
  bindHomeActions(content);
}

function renderHome(content, point, data, { cached }) {
  const analysis = analyzeTrend(data);
  const validUntil = formatClock(new Date(Date.parse(data.runTime) + RAIN_HOME_HORIZON_MINUTES * 60_000).toISOString());
  const availability = data.complete ? '' : ` · ${data.points.length}/16 時間點可用`;
  content.innerHTML = `
    <section class="rain-home-root" data-rain-home-owned="series" data-view-kind="ready" data-point-key="${escapeHtml(pointKey(point))}">
      ${locationMarkup(point)}
      <div class="rain-home-summary"><h1 class="rain-home-verdict">${escapeHtml(analysis.title)}</h1>${analysis.timing ? `<div class="rain-home-timing">${escapeHtml(analysis.timing)}</div>` : ''}<p class="rain-home-detail">${escapeHtml(analysis.detail)}</p></div>
      <section class="rain-home-chart-section" aria-labelledby="rain-home-chart-title">
        <div class="rain-home-section-head"><h2 id="rain-home-chart-title" class="rain-home-section-title">未來 2 小時雨勢</h2><div class="rain-home-section-note">每點為 30 分鐘累積雨量</div></div>
        ${analysis.chartSummary ? `<div class="rain-home-chart-summary">${escapeHtml(analysis.chartSummary)}</div>` : ''}
        ${chartMarkup(data.points, data.runTime, { seriesComplete:data.complete })}
        <div class="rain-home-meta${data.complete ? '' : ' is-partial'}"><strong>SWIRLS</strong> · 基準 ${escapeHtml(formatClock(data.runTime))}${escapeHtml(availability)} · 預報至 ${escapeHtml(validUntil)}${cached ? ' · 快取' : ''}</div>
      </section>
      ${mapActionMarkup()}
    </section>`;
  bindHomeActions(content);
  bindChartExplorer(content, data.points);
  const subtitle = document.getElementById('mobile-title-sub');
  if (subtitle) subtitle.textContent = `${point.name} · ${analysis.shortLabel}`;
}

function locationMarkup(point) {
  return `<div class="rain-home-location"><div><div class="rain-home-location-kicker">目前位置預報</div><h2 class="rain-home-location-name">${escapeHtml(point.name || '目前位置')}</h2><div class="rain-home-location-coord">${Number(point.lat).toFixed(4)}°N, ${Number(point.lon).toFixed(4)}°E</div></div><button class="rain-home-locate" type="button" data-rain-home-locate>重新定位</button></div>`;
}

function mapActionMarkup() {
  return '<button class="rain-home-primary-action" type="button" data-rain-home-map><span class="rain-home-action-copy"><strong data-rain-home-map-label>查看 2 小時雨區</strong><small>播放未來雨帶 · 自由拖移及縮放</small></span><span class="rain-home-action-arrow" aria-hidden="true">→</span></button>';
}

function bindHomeActions(content) {
  content.querySelector('[data-rain-home-locate]')?.addEventListener('click', () => document.getElementById('locate-button')?.click());
  content.querySelector('[data-rain-home-map]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    const label = button.querySelector('[data-rain-home-map-label]');
    if (label) label.textContent = '正在開啟 2 小時雨區…';
    setMapView(true);
    const mode = await setRainMapMode('forecast');
    button.disabled = false;
    if (label) label.textContent = '查看 2 小時雨區';
    if (mode !== 'forecast') setMapView(false);
  });
}

function bindChartExplorer(content, points) {
  const chart = content.querySelector('.rain-home-chart');
  const readout = content.querySelector('[data-rain-home-readout]');
  const guide = content.querySelector('[data-rain-home-guide]');
  const hits = [...content.querySelectorAll('[data-rain-home-point]')];
  const dots = [...content.querySelectorAll('.rain-home-dot')];
  if (!chart || !readout || hits.length !== points.length || dots.length !== points.length) return;

  const selectPoint = (index, { focus = false } = {}) => {
    const normalizedIndex = Math.max(0, Math.min(points.length - 1, Number(index) || 0));
    const sample = points[normalizedIndex];
    const selectedX = hits[normalizedIndex]?.getAttribute('cx');
    dots.forEach((dot, dotIndex) => dot.classList.toggle('selected', dotIndex === normalizedIndex));
    hits.forEach((hit, hitIndex) => hit.setAttribute('aria-pressed', hitIndex === normalizedIndex ? 'true' : 'false'));
    if (guide && selectedX) {
      guide.setAttribute('x1', selectedX);
      guide.setAttribute('x2', selectedX);
      guide.classList.add('is-active');
    }
    readout.hidden = false;
    readout.innerHTML = chartReadoutMarkup(sample);
    if (focus) hits[normalizedIndex]?.focus();
  };

  const selectNearestAtClientX = clientX => {
    const rect = chart.getBoundingClientRect();
    if (!rect.width) return;
    const viewWidth = chart.viewBox?.baseVal?.width || 700;
    const viewX = (Number(clientX) - rect.left) * viewWidth / rect.width;
    const plotLeft = Number(chart.dataset.plotLeft);
    const plotWidth = Number(chart.dataset.plotWidth);
    const horizon = Number(chart.dataset.horizonMinutes);
    if (![viewX, plotLeft, plotWidth, horizon].every(Number.isFinite) || plotWidth <= 0 || horizon <= 0) return;
    const lead = Math.max(0, Math.min(horizon, ((viewX - plotLeft) / plotWidth) * horizon));
    const nearestIndex = points.reduce((bestIndex, point, index) => Math.abs(Number(point.leadMinutes) - lead) < Math.abs(Number(points[bestIndex].leadMinutes) - lead) ? index : bestIndex, 0);
    selectPoint(nearestIndex);
  };

  chart.addEventListener('pointerdown', event => { if (event.pointerType !== 'mouse' || event.button === 0) selectNearestAtClientX(event.clientX); });
  chart.addEventListener('click', event => { const hit = event.target.closest('[data-rain-home-point]'); if (hit) selectPoint(Number(hit.dataset.rainHomePoint)); });
  chart.addEventListener('keydown', event => {
    const hit = event.target.closest('[data-rain-home-point]');
    if (!hit) return;
    const index = Number(hit.dataset.rainHomePoint);
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPoint(index); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); selectPoint(index + (event.key === 'ArrowLeft' ? -1 : 1), { focus:true }); }
  });
}

function chartReadoutMarkup(point) {
  const validTime = formatClock(point?.validTime);
  const windowStart = formatClock(point?.windowStart);
  const windowEnd = formatClock(point?.windowEnd || point?.validTime);
  const lead = Number.isFinite(Number(point?.leadMinutes)) ? `+${Number(point.leadMinutes)} 分` : '預報時段';
  return `<div><div class="rain-home-readout-time">${escapeHtml(validTime)} · ${escapeHtml(lead)}</div><div class="rain-home-readout-window">30 分鐘累積時窗 ${escapeHtml(windowStart)}–${escapeHtml(windowEnd)}</div></div><div class="rain-home-readout-value">${escapeHtml(formatRain(point?.amountMm))}<span class="rain-home-readout-unit">mm / 30 min</span></div>`;
}

function analyzeTrend(data) {
  const points = data.points;
  const firstWet = findFirstWetSignalTransition(points, RAIN_HOME_RAIN_THRESHOLD_MM);
  const partialSuffix = data.complete ? '' : `目前只有 ${points.length}/16 個有效時間可用。`;
  if (!firstWet) return {
    title:'暫無明顯降雨',
    timing:'目前沒有明顯降雨時段',
    detail:`可用時間點的 30 分鐘累積預測雨量維持很低。${partialSuffix}可打開雨區地圖查看香港、深圳及南海附近雨帶。`,
    chartSummary:'',
    shortLabel:'暫無明顯降雨'
  };

  const first = firstWet.first;
  const previous = firstWet.previous;
  const adjacent = previous && Number(previous.frameIndex) === Number(first.frameIndex) - 1;
  const peak = points.reduce((best, point) => Number(point.amountMm) > Number(best.amountMm) ? point : best, points[0]);
  const peakIndex = points.indexOf(peak);
  const peakValue = Number(peak.amountMm) || 0;
  const lastValue = Number(points.at(-1)?.amountMm) || 0;
  const endRatio = peakValue > 0 ? lastValue / peakValue : 1;
  const terminalPeak = data.complete && Number(peak.frameIndex) === FRAME_COUNT - 1;
  const lastAvailablePeak = peakIndex === points.length - 1;

  let direction = '之後雨勢大致維持。';
  if (terminalPeak) {
    direction = '預報結束時仍呈上升。';
  } else if (lastAvailablePeak) {
    direction = '最後可用時間仍呈上升。';
  } else if (endRatio <= 0.45) {
    direction = '峰值後明顯減弱。';
  } else if (endRatio <= 0.7) {
    direction = '峰值後逐步減弱。';
  } else if (endRatio <= 0.85) {
    direction = '峰值後稍為回落。';
  } else if (peakIndex >= points.length - 3) {
    direction = '較後段仍接近峰值。';
  }

  const title = Number(first.frameIndex) === 0 ? '30 分鐘內可能有雨' : '稍後可能有雨';
  const timing = Number(first.frameIndex) === 0
    ? `首個預報時間 ${formatClock(first.validTime)} 已有雨勢`
    : adjacent
      ? `約 ${formatClock(firstWet.transitionStartValidTime)}–${formatClock(firstWet.transitionEndValidTime)} 開始`
      : `最早可用預報 ${formatClock(first.validTime)} 已有雨勢`;

  const peakClock = formatClock(peak.validTime);
  const peakRain = formatRain(peak.amountMm);
  const detail = terminalPeak
    ? `截至 ${peakClock}，30 分鐘累積預測雨量升至約 ${peakRain} mm。${direction}${partialSuffix}`
    : lastAvailablePeak
      ? `截至最後可用時間 ${peakClock}，30 分鐘累積預測雨量升至約 ${peakRain} mm。${direction}${partialSuffix}`
      : `最強約在 ${peakClock} 前後，30 分鐘累積預測雨量最高約 ${peakRain} mm。${direction}${partialSuffix}`;
  const chartSummary = terminalPeak
    ? `至 ${peakClock} 升至 ${peakRain} mm / 30 min`
    : lastAvailablePeak
      ? `最後可用時間 ${peakClock} · ${peakRain} mm / 30 min`
      : `最強約 ${peakClock} · ${peakRain} mm / 30 min`;

  return { title, timing, detail, chartSummary, shortLabel:title };
}

function chartMarkup(points, runTime, { seriesComplete = true } = {}) {
  const width = 700;
  const height = 270;
  const pad = { left:42, right:12, top:18, bottom:52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const peakPoint = points.reduce((best, point) => Number(point.amountMm) > Number(best.amountMm) ? point : best, points[0]);
  const peak = Number(peakPoint?.amountMm) || 0;
  const yMax = rainfallScaleMax(peak);
  const yStep = rainfallTickStep(yMax);
  const tickValues = rainfallTickValues(yMax, yStep);
  const xLead = leadMinutes => pad.left + plotW * (rainHomeLeadRatio(leadMinutes, RAIN_HOME_HORIZON_MINUTES) ?? 0);
  const y = value => pad.top + plotH * (1 - Math.min(yMax, Math.max(0, value)) / yMax);
  const segments = contiguousSegments(points);
  const lineMarkup = segments.map(segment => `<path class="rain-home-line" d="${segment.map((point, index) => `${index ? 'L' : 'M'} ${xLead(point.leadMinutes).toFixed(1)} ${y(point.amountMm).toFixed(1)}`).join(' ')}"></path>`).join('');
  const chartComplete = points.length === FRAME_COUNT && segments.length === 1;
  const fullLine = chartComplete ? segments[0].map((point, index) => `${index ? 'L' : 'M'} ${xLead(point.leadMinutes).toFixed(1)} ${y(point.amountMm).toFixed(1)}`).join(' ') : '';
  const firstLead = points[0]?.leadMinutes ?? RAIN_HOME_FIRST_LEAD_MINUTES;
  const firstX = xLead(firstLead);
  const lastX = xLead(points.at(-1)?.leadMinutes ?? RAIN_HOME_HORIZON_MINUTES);
  const area = chartComplete ? `${fullLine} L ${lastX.toFixed(1)} ${(pad.top + plotH).toFixed(1)} L ${firstX.toFixed(1)} ${(pad.top + plotH).toFixed(1)} Z` : '';
  const ticks = tickValues.map(value => {
    const yy = y(value);
    return `<line class="rain-home-grid" x1="${pad.left}" y1="${yy.toFixed(1)}" x2="${width - pad.right}" y2="${yy.toFixed(1)}"></line><text class="rain-home-axis-label" x="${pad.left - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end">${formatAxis(value, yStep)}</text>`;
  }).join('');
  const xLeads = [0,30,60,90,120];
  const xLabels = xLeads.map(lead => {
    const x = xLead(lead).toFixed(1);
    const anchor = lead === 0 ? 'start' : lead === 120 ? 'end' : 'middle';
    if (lead === 0) return `<text x="${x}" y="${height - 31}" text-anchor="${anchor}"><tspan class="rain-home-axis-clock" x="${x}">${escapeHtml(formatClock(runTime))}</tspan><tspan class="rain-home-axis-lead" x="${x}" dy="13">基準</tspan></text>`;
    const axisPoint = points.find(point => Number(point.leadMinutes) === lead);
    const clock = formatClock(axisPoint?.validTime || validTimeForLead(runTime, lead));
    return `<text x="${x}" y="${height - 31}" text-anchor="${anchor}"><tspan class="rain-home-axis-clock" x="${x}">${escapeHtml(clock)}</tspan><tspan class="rain-home-axis-lead" x="${x}" dy="13">+${lead}</tspan></text>`;
  }).join('');
  const dots = points.map(point => {
    const isPeak = point === peakPoint && peak >= RAIN_HOME_RAIN_THRESHOLD_MM;
    return `<circle class="rain-home-dot${isPeak ? ' peak' : ''}" cx="${xLead(point.leadMinutes).toFixed(1)}" cy="${y(point.amountMm).toFixed(1)}" r="${isPeak ? '4.2' : '3'}" data-lead-minutes="${Number(point.leadMinutes)}"></circle>`;
  }).join('');
  const hits = points.map((point, index) => `<circle class="rain-home-hit" cx="${xLead(point.leadMinutes).toFixed(1)}" cy="${y(point.amountMm).toFixed(1)}" r="14" tabindex="0" role="button" aria-pressed="false" aria-label="${escapeHtml(`有效時間 ${formatClock(point.validTime)}，${formatRain(point.amountMm)} mm / 30 min，預報 +${Number(point.leadMinutes)} 分鐘`)}" data-rain-home-point="${index}"></circle>`).join('');
  const unavailableWidth = Math.max(0, firstX - pad.left);
  const firstAvailableClock = formatClock(points[0]?.validTime || validTimeForLead(runTime, firstLead));
  const unavailableLabel = Number(firstLead) === RAIN_HOME_FIRST_LEAD_MINUTES ? `預報由 ${firstAvailableClock} 開始` : `首個可用時間 ${firstAvailableClock}`;
  const peakAtForecastEnd = seriesComplete && Number(peakPoint?.frameIndex) === FRAME_COUNT - 1;
  const ariaRainSummary = peakAtForecastEnd
    ? `截至預報終點 ${formatClock(peakPoint.validTime)}，雨量升至 ${formatRain(peak)} 毫米每 30 分鐘`
    : `最高 ${formatRain(peak)} 毫米每 30 分鐘`;
  const helpText = seriesComplete
    ? '點按圖表查看各時間雨量'
    : '部分時間資料暫缺，圖表會以空白表示 · 點按可用時間查看雨量';
  return `<div class="rain-home-chart-wrap"><svg class="rain-home-chart" viewBox="0 0 ${width} ${height}" role="group" aria-label="未來兩小時定位點雨量折線圖；橫軸以香港有效時間為主要標示；首個可用預報時間為 ${escapeHtml(firstAvailableClock)}；${escapeHtml(ariaRainSummary)}" data-plot-left="${pad.left}" data-plot-width="${plotW}" data-horizon-minutes="${RAIN_HOME_HORIZON_MINUTES}">${ticks}<rect class="rain-home-unavailable-zone" x="${pad.left}" y="${pad.top}" width="${unavailableWidth.toFixed(1)}" height="${plotH}"></rect><line class="rain-home-first-lead" x1="${firstX.toFixed(1)}" y1="${pad.top}" x2="${firstX.toFixed(1)}" y2="${(pad.top + plotH).toFixed(1)}"></line><text class="rain-home-unavailable-label" x="${Math.max(pad.left + 4, firstX - 6).toFixed(1)}" y="${(pad.top + 11).toFixed(1)}" text-anchor="end">${escapeHtml(unavailableLabel)}</text><line class="rain-home-selection-guide" x1="${firstX.toFixed(1)}" y1="${pad.top}" x2="${firstX.toFixed(1)}" y2="${(pad.top + plotH).toFixed(1)}" data-rain-home-guide></line>${area ? `<path class="rain-home-area" d="${area}"></path>` : ''}${lineMarkup}${dots}${hits}${xLabels}</svg><div class="rain-home-chart-readout" data-rain-home-readout aria-live="polite" hidden></div><div class="rain-home-chart-help${seriesComplete ? '' : ' is-partial'}">${escapeHtml(helpText)}</div></div>`;
}

function contiguousSegments(points) {
  const segments = [];
  let current = [];
  for (const point of points) {
    if (current.length && Number(point.frameIndex) !== Number(current.at(-1).frameIndex) + 1) { segments.push(current); current = []; }
    current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}

function validTimeForLead(runTime, leadMinutes) {
  const time = Date.parse(runTime || '');
  return Number.isFinite(time) ? new Date(time + Number(leadMinutes) * 60_000).toISOString() : null;
}

function rainfallScaleMax(value) {
  const peak = Number(value);
  if (!Number.isFinite(peak) || peak <= 0.2) return 0.3;
  if (peak <= 0.5) return 0.5;
  if (peak <= 1) return 1;
  if (peak <= 2) return 2;
  if (peak <= 5) return 5;
  if (peak <= 10) return 10;
  if (peak <= 20) return 20;
  if (peak <= 50) return 50;
  return Math.ceil(peak / 25) * 25;
}

function rainfallTickStep(yMax) {
  if (yMax <= 0.5) return 0.1;
  if (yMax <= 1) return 0.2;
  if (yMax <= 2) return 0.5;
  if (yMax <= 5) return 1;
  if (yMax <= 10) return 2;
  if (yMax <= 20) return 5;
  if (yMax <= 50) return 10;
  return 25;
}

function rainfallTickValues(yMax, step = rainfallTickStep(yMax)) {
  const count = Math.max(1, Math.round(Number(yMax) / Number(step)));
  return Array.from({ length:count + 1 }, (_, index) => Number((index * step).toFixed(4)));
}

function formatAxis(value, step = 1) {
  if (step < 1) return Number(value).toFixed(step < 0.1 ? 2 : 1).replace(/\.0+$/, '');
  return String(Math.round(value));
}
function formatRain(value) { const number = Number(value); if (!Number.isFinite(number)) return '—'; if (number < 0.05) return '0'; if (number < 10) return number.toFixed(1).replace(/\.0$/, ''); return String(Math.round(number)); }
function formatClock(value) { const time = Date.parse(value || ''); if (!Number.isFinite(time)) return '—'; return new Intl.DateTimeFormat('zh-HK', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Asia/Hong_Kong' }).format(new Date(time)); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char])); }

function initRainHome() {
  injectStyles();
  prepareShell();
  const content = document.getElementById('forecast-content');
  if (!content) return;

  observer = new MutationObserver(restoreOwnedView);
  observer.observe(content, { childList:true, subtree:false });
  window.addEventListener('rain:map-mode-change', event => setMapView(event.detail?.mode && event.detail.mode !== 'off'));
  window.addEventListener('rain:location-change', () => void requestSeries({ force:true }));
  window.addEventListener('rain:refresh', () => void requestSeries({ force:true }));
  document.getElementById('refresh-button')?.addEventListener('click', () => void requestSeries({ force:true }));
  void requestSeries();
}

initRainHome();
