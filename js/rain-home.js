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
    .rain-home-summary{padding:30px 0 24px}.rain-home-verdict{margin:0;max-width:680px;color:#fff;font-size:clamp(1.8rem,6vw,3rem);font-weight:340;letter-spacing:-.045em;line-height:1.11;text-wrap:balance}.rain-home-detail{max-width:640px;margin:12px 0 0;color:#b8c0c4;font-size:.98rem;line-height:1.68}
    .rain-home-chart-section{margin-top:4px;padding:20px 0 0;border-top:1px solid #252525}.rain-home-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:12px}.rain-home-section-title{margin:0;color:#fff;font-size:1.02rem;font-weight:680}.rain-home-section-note{color:#7d888d;font-size:.72rem;text-align:right;line-height:1.48}
    .rain-home-chart-wrap{position:relative;padding:15px 14px 13px;border:1px solid #232d32;background:#070a0c}.rain-home-chart{display:block;width:100%;height:auto;overflow:visible;color:var(--accent);touch-action:pan-y;cursor:crosshair}.rain-home-grid{stroke:#242c30;stroke-width:1;vector-effect:non-scaling-stroke}.rain-home-axis-label{fill:#717c81;font-size:11px;font-family:"Segoe UI","Microsoft JhengHei",sans-serif}.rain-home-axis-clock{fill:#a6b0b5;font-size:10px;font-variant-numeric:tabular-nums}.rain-home-line{fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}.rain-home-area{fill:currentColor;opacity:.09}.rain-home-selection-guide{stroke:currentColor;stroke-width:1;stroke-dasharray:4 4;opacity:.38;vector-effect:non-scaling-stroke;pointer-events:none}.rain-home-dot{fill:#070a0c;stroke:currentColor;stroke-width:2;vector-effect:non-scaling-stroke}.rain-home-dot.selected{fill:currentColor;stroke-width:3;r:5.5}.rain-home-hit{fill:transparent;stroke:transparent;stroke-width:1;cursor:pointer;outline:none}.rain-home-hit:focus-visible{stroke:var(--cyan);stroke-width:2;fill:rgba(0,216,255,.08)}
    .rain-home-chart-readout{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px 20px;margin:12px 0 0;padding:13px 14px;border-top:1px solid #27343a;background:#0a1013;min-height:72px}.rain-home-readout-time{color:#fff;font-size:.92rem;font-weight:680}.rain-home-readout-window{margin-top:4px;color:#7c898f;font-size:.7rem}.rain-home-readout-value{color:#e2f6ff;font-size:1.35rem;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}.rain-home-readout-unit{display:block;margin-top:1px;color:#71828a;font-size:.61rem;font-weight:500}
    .rain-home-chart-caption{display:flex;justify-content:space-between;gap:12px;margin-top:9px;color:#717b80;font-size:.69rem}.rain-home-chart-caption span:last-child{text-align:right}.rain-home-chart-help{margin-top:5px;color:#586267;font-size:.66rem}.rain-home-meta{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px;color:#778187;font-size:.69rem}.rain-home-meta span{display:inline-flex;align-items:center;min-height:26px;padding:3px 8px;border:1px solid #242c30;background:#080b0d}
    .rain-home-primary-action{display:flex;width:100%;min-height:64px;align-items:center;justify-content:space-between;gap:16px;margin-top:22px;padding:10px 16px;border:1px solid #3f7893;background:#07131a;color:#fff;text-align:left}.rain-home-action-copy{display:flex;min-width:0;flex-direction:column;gap:3px}.rain-home-action-copy strong{font-size:.94rem}.rain-home-action-copy small{color:#7e9aa8;font-size:.7rem}.rain-home-action-arrow{color:var(--accent);font-size:1.35rem}.rain-home-primary-action:disabled{opacity:.62;cursor:progress}
    .rain-home-loading{display:flex;min-height:330px;flex-direction:column;justify-content:center;gap:16px;color:#929ca1}.rain-home-loading-head{display:flex;align-items:center;gap:11px}.rain-home-loading-head strong{color:#d6dde0;font-size:.9rem}.rain-home-loading-head span:last-child{display:block;margin-top:2px;color:#707a7f;font-size:.7rem}.rain-home-loading-spinner{width:26px;height:26px;border:2px solid #313a3e;border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}.rain-home-skeleton{display:grid;gap:10px;padding:16px;border:1px solid #20282c;background:#06090a}.rain-home-skeleton-line,.rain-home-skeleton-chart{background:#11171a}.rain-home-skeleton-line{height:13px}.rain-home-skeleton-line.short{width:56%}.rain-home-skeleton-line.medium{width:78%}.rain-home-skeleton-chart{height:126px;margin-top:5px}
    .rain-home-error{display:grid;gap:9px;margin-top:22px;padding:15px;border:1px solid #5d3a23;background:#160e08;color:#e9c29b;line-height:1.55}.rain-home-error strong{color:#f2d2b5}.rain-home-error-detail{color:#b89070;font-size:.74rem;overflow-wrap:anywhere}.rain-home-back-map{position:absolute;z-index:1200;top:12px;left:12px;display:none;min-height:42px;padding:0 13px;border:1px solid #5b5b5b;background:rgba(0,0,0,.9);color:#fff}body.rain-home-v2.rain-map-view .rain-home-back-map{display:block}
    @media(max-width:700px){body.rain-home-v2:not(.rain-map-view) #forecast-panel .panel-inner{padding:12px 16px calc(26px + var(--safe-bottom))!important}.rain-home-location{padding-bottom:17px}.rain-home-summary{padding:23px 0 19px}.rain-home-section-head{align-items:flex-start;flex-direction:column;gap:5px}.rain-home-section-note{text-align:left}.rain-home-chart-wrap{padding:12px 9px 10px}.rain-home-loading{min-height:300px}}
    @media(max-width:390px){.rain-home-chart-caption{flex-direction:column;gap:2px}.rain-home-chart-caption span:last-child{text-align:left}.rain-home-chart-readout{grid-template-columns:1fr}.rain-home-readout-value{text-align:left}.rain-home-readout-unit{display:inline;margin-left:5px}}
    @media(prefers-reduced-motion:reduce){.rain-home-loading-spinner{animation:none!important}}
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

  return {
    ...data,
    complete:missingFrames.length === 0,
    points,
    missingFrames
  };
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
      <div class="rain-home-summary"><h1 class="rain-home-verdict">定位序列暫時未能載入</h1><p class="rain-home-detail">此狀態不會自動重試。可使用頁面更新按鈕或重新定位後再讀取。</p></div>
      <div class="rain-home-error" role="alert"><strong>SWIRLS 資料讀取失敗</strong><span class="rain-home-error-detail">${escapeHtml(error?.message || String(error))}</span></div>
      ${mapActionMarkup()}
    </section>`;
  bindHomeActions(content);
}

function renderHome(content, point, data, { cached }) {
  const analysis = analyzeTrend(data);
  const partialLabel = data.complete ? '16 點定位序列' : `${data.points.length}/16 點 · 缺 ${data.missingFrames.join(', ')}`;
  content.innerHTML = `
    <section class="rain-home-root" data-rain-home-owned="series" data-view-kind="ready" data-point-key="${escapeHtml(pointKey(point))}">
      ${locationMarkup(point)}
      <div class="rain-home-summary"><h1 class="rain-home-verdict">${escapeHtml(analysis.title)}</h1><p class="rain-home-detail">${escapeHtml(analysis.detail)}</p></div>
      <section class="rain-home-chart-section" aria-labelledby="rain-home-chart-title">
        <div class="rain-home-section-head"><h2 id="rain-home-chart-title" class="rain-home-section-title">未來 2 小時雨勢</h2><div class="rain-home-section-note">SWIRLS +30 至 +120 分鐘<br>每 6 分鐘預測 · 數值代表 30 分鐘預測雨量</div></div>
        ${chartMarkup(data.points, data.runTime)}
        <div class="rain-home-meta"><span>預報基準 ${escapeHtml(formatClock(data.runTime))}</span><span>有效至 ${escapeHtml(formatClock(new Date(Date.parse(data.runTime) + RAIN_HOME_HORIZON_MINUTES * 60_000).toISOString()))}</span><span>${escapeHtml(partialLabel)}</span>${cached ? '<span>短期快取</span>' : ''}</div>
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
    if (guide && selectedX) { guide.setAttribute('x1', selectedX); guide.setAttribute('x2', selectedX); }
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

  const firstWet = findFirstWetSignalTransition(points);
  selectPoint(firstWet?.index ?? 0);
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
  if (!firstWet) return { title:'未來 2 小時暫無明顯降雨', detail:`目前可用定位點的預報曲線維持接近 0 mm。${partialSuffix}可打開雨區地圖查看香港、深圳及南海附近雨帶。`, shortLabel:'暫無明顯降雨' };

  const first = firstWet.first;
  const previous = firstWet.previous;
  const adjacent = previous && Number(previous.frameIndex) === Number(first.frameIndex) - 1;
  const peak = points.reduce((best, point) => Number(point.amountMm) > Number(best.amountMm) ? point : best, points[0]);
  const last = points.at(-1);
  const startTitle = Number(first.frameIndex) === 0
    ? '未來 30 分鐘內可能有雨'
    : adjacent
      ? `約 ${formatClock(firstWet.transitionStartValidTime)}–${formatClock(firstWet.transitionEndValidTime)} 開始見到降雨訊號`
      : `最早可用訊號在 ${formatClock(first.validTime)} 顯示可能有雨`;

  let direction = '之後雨勢變化不大。';
  if (Number(last.amountMm) <= Number(peak.amountMm) * 0.45) direction = '峰值後有明顯減弱趨勢。';
  else if (Number(last.amountMm) >= Number(peak.amountMm) * 0.85 && peak.frameIndex >= 11) direction = '較後段的降雨訊號仍然維持。';
  else if (peak.frameIndex <= 5) direction = '較強訊號出現在前段，之後逐步回落。';

  return { title:startTitle, detail:`較強的 30 分鐘累積雨量時窗約在 ${formatClock(peak.validTime)} 前後，最高約 ${formatRain(peak.amountMm)} mm / 30 min。${direction}${partialSuffix}`, shortLabel:Number(first.frameIndex) === 0 ? '30 分鐘內可能有雨' : '稍後可能有雨' };
}

function chartMarkup(points, runTime) {
  const width = 700;
  const height = 266;
  const pad = { left:42, right:12, top:12, bottom:50 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const values = points.map(point => Number(point.amountMm) || 0);
  const yMax = niceCeiling(Math.max(...values));
  const xLead = leadMinutes => pad.left + plotW * (rainHomeLeadRatio(leadMinutes, RAIN_HOME_HORIZON_MINUTES) ?? 0);
  const y = value => pad.top + plotH * (1 - Math.min(yMax, Math.max(0, value)) / yMax);
  const segments = contiguousSegments(points);
  const lineMarkup = segments.map(segment => `<path class="rain-home-line" d="${segment.map((point, index) => `${index ? 'L' : 'M'} ${xLead(point.leadMinutes).toFixed(1)} ${y(point.amountMm).toFixed(1)}`).join(' ')}"></path>`).join('');
  const complete = points.length === FRAME_COUNT && segments.length === 1;
  const fullLine = complete ? segments[0].map((point, index) => `${index ? 'L' : 'M'} ${xLead(point.leadMinutes).toFixed(1)} ${y(point.amountMm).toFixed(1)}`).join(' ') : '';
  const firstX = xLead(points[0]?.leadMinutes ?? RAIN_HOME_FIRST_LEAD_MINUTES);
  const lastX = xLead(points.at(-1)?.leadMinutes ?? RAIN_HOME_HORIZON_MINUTES);
  const area = complete ? `${fullLine} L ${lastX.toFixed(1)} ${(pad.top + plotH).toFixed(1)} L ${firstX.toFixed(1)} ${(pad.top + plotH).toFixed(1)} Z` : '';
  const ticks = [0,.25,.5,.75,1].map(ratio => { const yy = pad.top + plotH * (1 - ratio); return `<line class="rain-home-grid" x1="${pad.left}" y1="${yy.toFixed(1)}" x2="${width - pad.right}" y2="${yy.toFixed(1)}"></line><text class="rain-home-axis-label" x="${pad.left - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end">${formatAxis(yMax * ratio)}</text>`; }).join('');
  const xLeads = [0,30,60,90,120];
  const xLabels = xLeads.map(lead => {
    const x = xLead(lead).toFixed(1);
    const anchor = lead === 0 ? 'start' : lead === 120 ? 'end' : 'middle';
    if (lead === 0) return `<text class="rain-home-axis-label" x="${x}" y="${height - 16}" text-anchor="${anchor}">現在</text>`;
    const axisPoint = points.find(point => Number(point.leadMinutes) === lead);
    const clock = formatClock(axisPoint?.validTime || validTimeForLead(runTime, lead));
    return `<text class="rain-home-axis-label" x="${x}" y="${height - 29}" text-anchor="${anchor}"><tspan x="${x}">+${lead}</tspan><tspan class="rain-home-axis-clock" x="${x}" dy="13">${escapeHtml(clock)}</tspan></text>`;
  }).join('');
  const dots = points.map(point => `<circle class="rain-home-dot" cx="${xLead(point.leadMinutes).toFixed(1)}" cy="${y(point.amountMm).toFixed(1)}" r="3" data-lead-minutes="${Number(point.leadMinutes)}"></circle>`).join('');
  const hits = points.map((point, index) => `<circle class="rain-home-hit" cx="${xLead(point.leadMinutes).toFixed(1)}" cy="${y(point.amountMm).toFixed(1)}" r="14" tabindex="0" role="button" aria-pressed="false" aria-label="${escapeHtml(`有效時間 ${formatClock(point.validTime)}，${formatRain(point.amountMm)} mm / 30 min，預報 +${Number(point.leadMinutes)} 分鐘`)}" data-rain-home-point="${index}"></circle>`).join('');
  const peak = Math.max(...values);
  return `<div class="rain-home-chart-wrap"><svg class="rain-home-chart" viewBox="0 0 ${width} ${height}" role="group" aria-label="未來兩小時定位點雨量折線圖；時間軸由預報基準 +0 到 +120 分鐘，並顯示各主要 lead 的香港有效時間；首個 SWIRLS 有效時間在 +30 分鐘；最高 ${formatRain(peak)} 毫米每 30 分鐘" data-plot-left="${pad.left}" data-plot-width="${plotW}" data-horizon-minutes="${RAIN_HOME_HORIZON_MINUTES}">${ticks}<line class="rain-home-selection-guide" x1="${firstX.toFixed(1)}" y1="${pad.top}" x2="${firstX.toFixed(1)}" y2="${(pad.top + plotH).toFixed(1)}" data-rain-home-guide></line>${area ? `<path class="rain-home-area" d="${area}"></path>` : ''}${lineMarkup}${dots}${hits}${xLabels}</svg><div class="rain-home-chart-readout" data-rain-home-readout aria-live="polite"></div><div class="rain-home-chart-caption"><span>橫軸：預報 lead + 香港有效時間 · 首個資料 +30</span><span>mm / 30 min</span></div><div class="rain-home-chart-help">點按圖表任何位置可查看最近的可用有效時間；缺失 frame 不會以直線跨接。</div></div>`;
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

function niceCeiling(value) { if (!Number.isFinite(value) || value <= 1) return 1; if (value <= 2) return 2; if (value <= 5) return 5; if (value <= 10) return 10; if (value <= 20) return 20; if (value <= 50) return 50; return Math.ceil(value / 25) * 25; }
function formatAxis(value) { if (value >= 10) return String(Math.round(value)); return value.toFixed(value < 1 ? 1 : 0); }
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
