import { fetchSwirlsPointFrame, fetchSwirlsPointSeries } from './api.js';
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
let renderTimer = 0;
let requestToken = 0;
let activeLoadKey = '';
let activeController = null;

function pointKey(point = state.selected) {
  return `${Number(point?.lat).toFixed(4)}|${Number(point?.lon).toFixed(4)}`;
}

function injectStyles() {
  if (document.getElementById('rain-home-v2-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-home-v2-style';
  style.textContent = `
    body.rain-home-v2 #sheet-handle,
    body.rain-home-v2 #forecast-toggle{display:none!important}
    body.rain-home-v2:not(.rain-map-view) .pivot-content-wrapper{overflow:auto!important;background:#000}
    body.rain-home-v2:not(.rain-map-view) #map-container{height:auto!important;min-height:100%;overflow:visible!important;background:#000}
    body.rain-home-v2:not(.rain-map-view) #rain-map{visibility:hidden!important;pointer-events:none!important}
    body.rain-home-v2:not(.rain-map-view) .source-badges,
    body.rain-home-v2:not(.rain-map-view) .map-hint,
    body.rain-home-v2:not(.rain-map-view) #coordinate-readout,
    body.rain-home-v2:not(.rain-map-view) #mobile-status,
    body.rain-home-v2:not(.rain-map-view) #radar-timeline,
    body.rain-home-v2:not(.rain-map-view) #desktop-drawer-button{display:none!important}
    body.rain-home-v2:not(.rain-map-view) #forecast-panel{
      position:relative!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;
      width:min(760px,100%)!important;max-width:none!important;max-height:none!important;height:auto!important;
      margin:0 auto!important;border:0!important;background:#000!important;box-shadow:none!important;overflow:visible!important;
      transform:none!important;transition:none!important
    }
    body.rain-home-v2:not(.rain-map-view) #forecast-panel .panel-inner{padding:18px 20px calc(30px + var(--safe-bottom))!important}
    body.rain-home-v2.rain-map-view .pivot-content-wrapper,
    body.rain-home-v2.rain-map-view #map-container,
    body.rain-home-v2.rain-map-view #rain-map{height:100%!important;overflow:hidden!important;visibility:visible!important;pointer-events:auto!important}
    body.rain-home-v2.rain-map-view #forecast-panel{display:none!important}
    body.rain-home-v2.rain-map-view .map-hint{display:none!important}
    .rain-home-root{max-width:720px;margin:0 auto;padding:6px 0 28px}
    .rain-home-location{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:6px 0 20px;border-bottom:1px solid #252525}
    .rain-home-location>div{min-width:0}
    .rain-home-location-kicker{margin:0 0 6px;color:#929ca1;font-size:.72rem;font-weight:650;letter-spacing:.08em;text-transform:uppercase}
    .rain-home-location-name{margin:0;color:#fff;font-size:clamp(1.55rem,5vw,2.35rem);font-weight:480;letter-spacing:-.03em;line-height:1.12;overflow-wrap:anywhere}
    .rain-home-location-coord{margin-top:7px;color:#6f787c;font-size:.72rem;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
    .rain-home-locate{flex:0 0 auto;min-height:42px;padding:0 13px;border:1px solid #424b50;background:#0b0e10;color:#e5e9eb;font-weight:600}
    .rain-home-locate:hover{border-color:#68757b;background:#111619}
    .rain-home-summary{padding:30px 0 24px}
    .rain-home-verdict{margin:0;max-width:680px;color:#fff;font-size:clamp(1.8rem,6vw,3rem);font-weight:340;letter-spacing:-.045em;line-height:1.11;text-wrap:balance}
    .rain-home-detail{max-width:640px;margin:12px 0 0;color:#b8c0c4;font-size:.98rem;line-height:1.68}
    .rain-home-chart-section{margin-top:4px;padding:20px 0 0;border-top:1px solid #252525}
    .rain-home-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:12px}
    .rain-home-section-title{margin:0;color:#fff;font-size:1.02rem;font-weight:680;letter-spacing:-.01em}
    .rain-home-section-note{color:#7d888d;font-size:.72rem;text-align:right;line-height:1.48}
    .rain-home-chart-wrap{position:relative;padding:15px 14px 13px;border:1px solid #232d32;background:#070a0c}
    .rain-home-chart{display:block;width:100%;height:auto;overflow:visible;color:var(--accent);touch-action:pan-y;cursor:crosshair}
    .rain-home-grid{stroke:#242c30;stroke-width:1;vector-effect:non-scaling-stroke}
    .rain-home-axis-label{fill:#717c81;font-size:11px;font-family:"Segoe UI","Microsoft JhengHei",sans-serif}
    .rain-home-line{fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
    .rain-home-area{fill:currentColor;opacity:.09}
    .rain-home-selection-guide{stroke:currentColor;stroke-width:1;stroke-dasharray:4 4;opacity:.38;vector-effect:non-scaling-stroke;pointer-events:none}
    .rain-home-dot{fill:#070a0c;stroke:currentColor;stroke-width:2;vector-effect:non-scaling-stroke;transition:r .12s,fill .12s,stroke-width .12s}
    .rain-home-dot.selected{fill:currentColor;stroke-width:3;r:5.5}
    .rain-home-hit{fill:transparent;stroke:transparent;stroke-width:1;cursor:pointer;outline:none}
    .rain-home-hit:focus-visible{stroke:var(--cyan);stroke-width:2;fill:rgba(0,216,255,.08)}
    .rain-home-chart-readout{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px 20px;margin:12px 0 0;padding:13px 14px;border-top:1px solid #27343a;background:#0a1013;min-height:72px}
    .rain-home-readout-time{color:#fff;font-size:.92rem;font-weight:680;line-height:1.35}
    .rain-home-readout-window{margin-top:4px;color:#7c898f;font-size:.7rem;line-height:1.42}
    .rain-home-readout-value{color:#e2f6ff;font-size:1.35rem;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right;letter-spacing:-.025em}
    .rain-home-readout-unit{display:block;margin-top:1px;color:#71828a;font-size:.61rem;font-weight:500;letter-spacing:0}
    .rain-home-chart-caption{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-top:9px;color:#717b80;font-size:.69rem;line-height:1.45}
    .rain-home-chart-caption span:last-child{text-align:right}
    .rain-home-chart-help{margin-top:5px;color:#586267;font-size:.66rem;line-height:1.4}
    .rain-home-meta{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px;color:#778187;font-size:.69rem;line-height:1.4}
    .rain-home-meta span{display:inline-flex;align-items:center;min-height:26px;padding:3px 8px;border:1px solid #242c30;background:#080b0d}
    .rain-home-primary-action{display:flex;width:100%;min-height:64px;align-items:center;justify-content:space-between;gap:16px;margin-top:22px;padding:10px 16px;border:1px solid #3f7893;background:#07131a;color:#fff;text-align:left}
    .rain-home-action-copy{display:flex;min-width:0;flex-direction:column;gap:3px}
    .rain-home-action-copy strong{font-size:.94rem;font-weight:700;line-height:1.3}
    .rain-home-action-copy small{color:#7e9aa8;font-size:.7rem;font-weight:500;line-height:1.35}
    .rain-home-action-arrow{flex:0 0 auto;color:var(--accent);font-size:1.35rem}
    .rain-home-primary-action:hover{border-color:#5b99b5;background:#0a1a22}
    .rain-home-primary-action:disabled{opacity:.62;cursor:progress}
    .rain-home-loading{display:flex;min-height:330px;flex-direction:column;justify-content:center;gap:16px;color:#929ca1}
    .rain-home-loading-head{display:flex;align-items:center;gap:11px}
    .rain-home-loading-head strong{color:#d6dde0;font-size:.9rem}
    .rain-home-loading-head span:last-child{display:block;margin-top:2px;color:#707a7f;font-size:.7rem}
    .rain-home-loading-spinner{flex:0 0 auto;width:26px;height:26px;border:2px solid #313a3e;border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
    .rain-home-skeleton{display:grid;gap:10px;padding:16px;border:1px solid #20282c;background:#06090a;overflow:hidden}
    .rain-home-skeleton-line,.rain-home-skeleton-chart{position:relative;overflow:hidden;background:#11171a}
    .rain-home-skeleton-line::after,.rain-home-skeleton-chart::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.055),transparent);animation:rain-home-shimmer 1.35s infinite}
    .rain-home-skeleton-line{height:13px}.rain-home-skeleton-line.short{width:56%}.rain-home-skeleton-line.medium{width:78%}
    .rain-home-skeleton-chart{height:126px;margin-top:5px}
    @keyframes rain-home-shimmer{100%{transform:translateX(100%)}}
    .rain-home-error{display:grid;gap:9px;margin-top:22px;padding:15px;border:1px solid #5d3a23;background:#160e08;color:#e9c29b;line-height:1.55}
    .rain-home-error strong{color:#f2d2b5;font-size:.9rem}
    .rain-home-error-detail{color:#b89070;font-size:.74rem;overflow-wrap:anywhere}
    .rain-home-retry{justify-self:start;min-height:40px;margin-top:3px;padding:0 12px;border:1px solid #815538;background:#21130b;color:#f0ceb1;font-weight:650}
    .rain-home-back-map{position:absolute;z-index:1200;top:12px;left:12px;display:none;min-height:42px;padding:0 13px;border:1px solid #5b5b5b;background:rgba(0,0,0,.9);color:#fff;box-shadow:0 3px 12px rgba(0,0,0,.4)}
    .rain-home-locate:focus-visible,.rain-home-primary-action:focus-visible,.rain-home-retry:focus-visible,.rain-home-back-map:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
    body.rain-home-v2.rain-map-view .rain-home-back-map{display:block}
    @media(max-width:700px){
      body.rain-home-v2:not(.rain-map-view) #forecast-panel .panel-inner{padding:12px 16px calc(26px + var(--safe-bottom))!important}
      .rain-home-root{padding-top:2px}.rain-home-location{padding-top:2px;padding-bottom:17px;gap:12px}.rain-home-locate{min-height:40px;padding:0 10px;font-size:.76rem}
      .rain-home-summary{padding:23px 0 19px}.rain-home-detail{font-size:.92rem;line-height:1.62}
      .rain-home-section-head{align-items:flex-start;flex-direction:column;gap:5px}.rain-home-section-note{text-align:left}
      .rain-home-chart-wrap{padding:12px 9px 10px}.rain-home-chart-readout{grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;padding:11px 10px}.rain-home-readout-value{font-size:1.18rem}
      .rain-home-chart-caption{font-size:.65rem}.rain-home-meta{margin-top:12px}.rain-home-primary-action{margin-top:18px}
      .rain-home-loading{min-height:300px}.rain-home-back-map{top:10px;left:10px}
    }
    @media(max-width:390px){
      .rain-home-location-coord{font-size:.66rem}.rain-home-chart-caption{flex-direction:column;gap:2px}.rain-home-chart-caption span:last-child{text-align:left}
      .rain-home-chart-readout{grid-template-columns:1fr}.rain-home-readout-value{text-align:left}.rain-home-readout-unit{display:inline;margin-left:5px}
    }
    @media(prefers-reduced-motion:reduce){.rain-home-loading-spinner,.rain-home-skeleton-line::after,.rain-home-skeleton-chart::after{animation:none!important}}
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

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(syncHome, 40);
}

async function syncHome() {
  const content = document.getElementById('forecast-content');
  const point = state.selected;
  if (!content || !point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lon))) return;

  const key = pointKey(point);
  const alreadyRendered = content.querySelector('.rain-home-root')?.dataset.pointKey === key;
  if (alreadyRendered && (activeLoadKey === key || seriesCache.has(key))) return;

  const cached = seriesCache.get(key);
  if (cached && Date.now() - cached.savedAt < SERIES_CACHE_MS) {
    renderHome(content, point, cached.data, { sourceMode:cached.sourceMode, cached:true });
    return;
  }

  if (activeLoadKey === key) return;
  activeLoadKey = key;
  const token = ++requestToken;
  activeController?.abort();
  activeController = new AbortController();
  renderLoading(content, point);

  try {
    const loaded = await loadSeries(point, activeController.signal);
    if (token !== requestToken || pointKey(state.selected) !== key) return;
    seriesCache.set(key, { data:loaded.data, sourceMode:loaded.sourceMode, savedAt:Date.now() });
    renderHome(content, state.selected, loaded.data, { sourceMode:loaded.sourceMode, cached:false });
  } catch (error) {
    if (error?.name === 'AbortError' || token !== requestToken) return;
    renderUnavailable(content, state.selected, error);
  } finally {
    if (token === requestToken) activeLoadKey = '';
  }
}

async function loadSeries(point, signal) {
  try {
    const data = await fetchSwirlsPointSeries(point, { signal });
    return { data:normalizeSeries(data), sourceMode:'series' };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    const data = await loadSeriesViaFrames(point, signal);
    return { data, sourceMode:'frame-fallback' };
  }
}

async function loadSeriesViaFrames(point, signal) {
  const samples = new Array(FRAME_COUNT);
  for (let start = 0; start < FRAME_COUNT; start += 4) {
    const batch = Array.from({ length:Math.min(4, FRAME_COUNT - start) }, (_, offset) => start + offset);
    const rows = await Promise.all(batch.map(frameIndex => fetchSwirlsPointFrame(point, frameIndex, { signal })));
    rows.forEach(sample => { samples[sample.frameIndex] = sample; });
  }
  const first = samples[0];
  return normalizeSeries({
    ok:true,
    runTime:first?.runTime,
    cadenceMinutes:first?.cadenceMinutes,
    accumulationMinutes:first?.accumulationMinutes,
    unit:first?.unit,
    location:first?.location,
    interpolation:first?.interpolation,
    generatedAt:first?.generatedAt,
    points:samples.map(sample => ({
      frameIndex:sample.frameIndex,
      validTime:sample.validTime,
      leadMinutes:sample.leadMinutes,
      windowStart:sample.windowStart,
      windowEnd:sample.windowEnd,
      amountMm:sample.amountMm
    }))
  });
}

function normalizeSeries(data) {
  const points = Array.isArray(data?.points) ? [...data.points].sort((a,b) => Number(a.frameIndex) - Number(b.frameIndex)) : [];
  if (data?.ok !== true || points.length !== FRAME_COUNT) throw new Error('兩小時 6 分鐘預報資料不完整');
  if (Number(data.cadenceMinutes) !== RAIN_HOME_CADENCE_MINUTES || Number(data.accumulationMinutes) !== 30) throw new Error('兩小時預報時間規格不符');
  points.forEach((point, index) => {
    const expectedLead = expectedRainHomeLeadMinutes(index);
    if (
      Number(point.frameIndex) !== index ||
      Number(point.leadMinutes) !== expectedLead ||
      !Number.isFinite(Number(point.amountMm)) ||
      Number(point.amountMm) < 0 ||
      !Date.parse(point.validTime || '')
    ) {
      throw new Error('兩小時預報含無效資料點');
    }
  });
  return { ...data, points };
}

function renderLoading(content, point) {
  content.innerHTML = `
    <section class="rain-home-root" data-point-key="${escapeHtml(pointKey(point))}">
      ${locationMarkup(point)}
      <div class="rain-home-loading" role="status" aria-live="polite">
        <div class="rain-home-loading-head"><span class="rain-home-loading-spinner" aria-hidden="true"></span><div><strong>正在整理未來兩小時雨勢</strong><span>讀取 16 個 SWIRLS 定位有效時間…</span></div></div>
        <div class="rain-home-skeleton" aria-hidden="true"><div class="rain-home-skeleton-line short"></div><div class="rain-home-skeleton-line medium"></div><div class="rain-home-skeleton-chart"></div><div class="rain-home-skeleton-line medium"></div></div>
      </div>
    </section>`;
  bindHomeActions(content);
}

function renderUnavailable(content, point, error) {
  const fallback = state.forecast;
  const summary = fallback?.summary?.text || '目前未能取得 6 分鐘 SWIRLS 定點序列。';
  content.innerHTML = `
    <section class="rain-home-root" data-point-key="${escapeHtml(pointKey(point))}">
      ${locationMarkup(point)}
      <div class="rain-home-summary"><h1 class="rain-home-verdict">${escapeHtml(summary)}</h1><p class="rain-home-detail">6 分鐘曲線暫時不可用；舊有定點預報仍保留作後備。</p></div>
      <div class="rain-home-error" role="alert"><strong>定位序列暫時未能載入</strong><span class="rain-home-error-detail">${escapeHtml(error?.message || String(error))}</span><button class="rain-home-retry" type="button" data-rain-home-retry>重新載入</button></div>
      ${mapActionMarkup()}
    </section>`;
  bindHomeActions(content);
}

function renderHome(content, point, data, { sourceMode, cached }) {
  const analysis = analyzeTrend(data);
  content.innerHTML = `
    <section class="rain-home-root" data-point-key="${escapeHtml(pointKey(point))}">
      ${locationMarkup(point)}
      <div class="rain-home-summary">
        <h1 class="rain-home-verdict">${escapeHtml(analysis.title)}</h1>
        <p class="rain-home-detail">${escapeHtml(analysis.detail)}</p>
      </div>
      <section class="rain-home-chart-section" aria-labelledby="rain-home-chart-title">
        <div class="rain-home-section-head">
          <h2 id="rain-home-chart-title" class="rain-home-section-title">未來 2 小時雨勢</h2>
          <div class="rain-home-section-note">SWIRLS +30 至 +120 分鐘<br>每 6 分鐘預測 · 數值代表 30 分鐘預測雨量</div>
        </div>
        ${chartMarkup(data.points)}
        <div class="rain-home-meta">
          <span>預報基準 ${escapeHtml(formatClock(data.runTime))}</span>
          <span>有效至 ${escapeHtml(formatClock(data.points.at(-1)?.validTime))}</span>
          <span>${sourceMode === 'frame-fallback' ? '相容模式 · 逐幀資料' : '16 點定位序列'}</span>
          ${cached ? '<span>短期快取</span>' : ''}
        </div>
      </section>
      ${mapActionMarkup()}
    </section>`;
  bindHomeActions(content);
  bindChartExplorer(content, data.points);
  const subtitle = document.getElementById('mobile-title-sub');
  if (subtitle) subtitle.textContent = `${point.name} · ${analysis.shortLabel}`;
}

function locationMarkup(point) {
  return `
    <div class="rain-home-location">
      <div>
        <div class="rain-home-location-kicker">目前位置預報</div>
        <h2 class="rain-home-location-name">${escapeHtml(point.name || '目前位置')}</h2>
        <div class="rain-home-location-coord">${Number(point.lat).toFixed(4)}°N, ${Number(point.lon).toFixed(4)}°E</div>
      </div>
      <button class="rain-home-locate" type="button" data-rain-home-locate>重新定位</button>
    </div>`;
}

function mapActionMarkup() {
  return '<button class="rain-home-primary-action" type="button" data-rain-home-map><span class="rain-home-action-copy"><strong data-rain-home-map-label>查看 2 小時雨區</strong><small>播放未來雨帶 · 自由拖移及縮放</small></span><span class="rain-home-action-arrow" aria-hidden="true">→</span></button>';
}

function bindHomeActions(content) {
  content.querySelector('[data-rain-home-locate]')?.addEventListener('click', () => document.getElementById('locate-button')?.click());
  content.querySelector('[data-rain-home-retry]')?.addEventListener('click', () => {
    seriesCache.delete(pointKey(state.selected));
    scheduleRender();
  });
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
    }
    readout.innerHTML = chartReadoutMarkup(sample);
    readout.dataset.selectedIndex = String(normalizedIndex);
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
    const nearestIndex = points.reduce((bestIndex, point, index) => (
      Math.abs(Number(point.leadMinutes) - lead) < Math.abs(Number(points[bestIndex].leadMinutes) - lead) ? index : bestIndex
    ), 0);
    selectPoint(nearestIndex);
  };

  chart.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    selectNearestAtClientX(event.clientX);
  });

  chart.addEventListener('click', event => {
    const hit = event.target.closest('[data-rain-home-point]');
    if (!hit) return;
    selectPoint(Number(hit.dataset.rainHomePoint));
  });

  chart.addEventListener('keydown', event => {
    const hit = event.target.closest('[data-rain-home-point]');
    if (!hit) return;
    const index = Number(hit.dataset.rainHomePoint);
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectPoint(index);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      selectPoint(index + (event.key === 'ArrowLeft' ? -1 : 1), { focus:true });
    }
  });

  const firstWet = findFirstWetSignalTransition(points);
  selectPoint(firstWet?.index ?? 0);
}

function chartReadoutMarkup(point) {
  const validTime = formatClock(point?.validTime);
  const windowStart = formatClock(point?.windowStart);
  const windowEnd = formatClock(point?.windowEnd || point?.validTime);
  const lead = Number.isFinite(Number(point?.leadMinutes)) ? `+${Number(point.leadMinutes)} 分` : '預報時段';
  return `
    <div>
      <div class="rain-home-readout-time">${escapeHtml(validTime)} · ${escapeHtml(lead)}</div>
      <div class="rain-home-readout-window">30 分鐘累積時窗 ${escapeHtml(windowStart)}–${escapeHtml(windowEnd)}</div>
    </div>
    <div class="rain-home-readout-value">${escapeHtml(formatRain(point?.amountMm))}<span class="rain-home-readout-unit">mm / 30 min</span></div>`;
}

function analyzeTrend(data) {
  const points = data.points;
  const firstWet = findFirstWetSignalTransition(points, RAIN_HOME_RAIN_THRESHOLD_MM);
  if (!firstWet) {
    return {
      title:'未來 2 小時暫無明顯降雨',
      detail:'目前定位點的 6 分鐘預報曲線維持接近 0 mm。可打開雨區地圖查看香港、深圳及南海附近是否有雨帶。',
      shortLabel:'暫無明顯降雨'
    };
  }

  const first = firstWet.first;
  const peak = points.reduce((best, point) => Number(point.amountMm) > Number(best.amountMm) ? point : best, points[0]);
  const last = points.at(-1);
  const peakTime = formatClock(peak.validTime);
  const startTitle = firstWet.index === 0
    ? '未來 30 分鐘內可能有雨'
    : `約 ${formatClock(firstWet.transitionStartValidTime)}–${formatClock(firstWet.transitionEndValidTime)} 開始見到降雨訊號`;

  const peakValue = formatRain(peak.amountMm);
  let direction = '之後雨勢變化不大。';
  if (Number(last.amountMm) <= Number(peak.amountMm) * 0.45) direction = '峰值後有明顯減弱趨勢。';
  else if (Number(last.amountMm) >= Number(peak.amountMm) * 0.85 && peak.frameIndex >= 11) direction = '較後段的降雨訊號仍然維持。';
  else if (peak.frameIndex <= 5) direction = '較強訊號出現在前段，之後逐步回落。';

  return {
    title:startTitle,
    detail:`較強的 30 分鐘累積雨量時窗約在 ${peakTime} 前後，最高約 ${peakValue} mm / 30 min。${direction}`,
    shortLabel:firstWet.index === 0 ? '30 分鐘內可能有雨' : '稍後可能有雨'
  };
}

function chartMarkup(points) {
  const width = 700;
  const height = 250;
  const pad = { left:42, right:12, top:12, bottom:34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const values = points.map(point => Number(point.amountMm) || 0);
  const yMax = niceCeiling(Math.max(...values));
  const xLead = leadMinutes => {
    const ratio = rainHomeLeadRatio(leadMinutes, RAIN_HOME_HORIZON_MINUTES);
    return pad.left + plotW * (ratio ?? 0);
  };
  const y = value => pad.top + plotH * (1 - Math.min(yMax, Math.max(0, value)) / yMax);
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${xLead(point.leadMinutes).toFixed(1)} ${y(point.amountMm).toFixed(1)}`).join(' ');
  const firstX = xLead(points[0]?.leadMinutes ?? RAIN_HOME_FIRST_LEAD_MINUTES);
  const lastX = xLead(points.at(-1)?.leadMinutes ?? RAIN_HOME_HORIZON_MINUTES);
  const area = `${line} L ${lastX.toFixed(1)} ${(pad.top + plotH).toFixed(1)} L ${firstX.toFixed(1)} ${(pad.top + plotH).toFixed(1)} Z`;
  const ticks = [0, .25, .5, .75, 1].map(ratio => {
    const yy = pad.top + plotH * (1 - ratio);
    const value = yMax * ratio;
    return `<line class="rain-home-grid" x1="${pad.left}" y1="${yy.toFixed(1)}" x2="${width - pad.right}" y2="${yy.toFixed(1)}"></line><text class="rain-home-axis-label" x="${pad.left - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end">${formatAxis(value)}</text>`;
  }).join('');
  const xLeads = [0,30,60,90,120];
  const xLabels = xLeads.map(lead => `<text class="rain-home-axis-label" x="${xLead(lead).toFixed(1)}" y="${height - 8}" text-anchor="${lead === 0 ? 'start' : lead === 120 ? 'end' : 'middle'}">${lead === 0 ? '現在' : `+${lead}`}</text>`).join('');
  const dots = points.map(point => `<circle class="rain-home-dot" cx="${xLead(point.leadMinutes).toFixed(1)}" cy="${y(point.amountMm).toFixed(1)}" r="3" data-lead-minutes="${Number(point.leadMinutes)}"></circle>`).join('');
  const hits = points.map((point, index) => {
    const label = `有效時間 ${formatClock(point.validTime)}，${formatRain(point.amountMm)} mm / 30 min，預報 +${Number(point.leadMinutes)} 分鐘`;
    return `<circle class="rain-home-hit" cx="${xLead(point.leadMinutes).toFixed(1)}" cy="${y(point.amountMm).toFixed(1)}" r="14" tabindex="0" role="button" aria-pressed="false" aria-label="${escapeHtml(label)}" data-rain-home-point="${index}" data-lead-minutes="${Number(point.leadMinutes)}"></circle>`;
  }).join('');
  const peak = Math.max(...values);
  return `
    <div class="rain-home-chart-wrap">
      <svg class="rain-home-chart" viewBox="0 0 ${width} ${height}" role="group" aria-label="未來兩小時定位點雨量折線圖；時間軸由預報基準 +0 到 +120 分鐘，首個 SWIRLS 有效時間在 +30 分鐘；最高 ${formatRain(peak)} 毫米每 30 分鐘；可點選 16 個有效時間查看數值" data-plot-left="${pad.left}" data-plot-width="${plotW}" data-horizon-minutes="${RAIN_HOME_HORIZON_MINUTES}">
        ${ticks}<line class="rain-home-selection-guide" x1="${firstX.toFixed(1)}" y1="${pad.top}" x2="${firstX.toFixed(1)}" y2="${(pad.top + plotH).toFixed(1)}" data-rain-home-guide></line><path class="rain-home-area" d="${area}"></path><path class="rain-home-line" d="${line}"></path>${dots}${hits}${xLabels}
      </svg>
      <div class="rain-home-chart-readout" data-rain-home-readout aria-live="polite"></div>
      <div class="rain-home-chart-caption"><span>現在 → +120 分鐘 · 首個資料 +30</span><span>mm / 30 min</span></div>
      <div class="rain-home-chart-help">點按圖表任何位置可查看最近的 6 分鐘有效時間；鍵盤可用左右方向鍵逐點移動。</div>
    </div>`;
}

function niceCeiling(value) {
  if (!Number.isFinite(value) || value <= 1) return 1;
  if (value <= 2) return 2;
  if (value <= 5) return 5;
  if (value <= 10) return 10;
  if (value <= 20) return 20;
  if (value <= 50) return 50;
  return Math.ceil(value / 25) * 25;
}

function formatAxis(value) {
  if (value >= 10) return String(Math.round(value));
  return value.toFixed(value < 1 ? 1 : 0);
}

function formatRain(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (number < 0.05) return '0';
  if (number < 10) return number.toFixed(1).replace(/\.0$/, '');
  return String(Math.round(number));
}

function formatClock(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '—';
  return new Intl.DateTimeFormat('zh-HK', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Asia/Hong_Kong' }).format(new Date(time));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

function initRainHome() {
  injectStyles();
  prepareShell();
  const content = document.getElementById('forecast-content');
  if (!content) return;

  observer = new MutationObserver(scheduleRender);
  observer.observe(content, { childList:true, subtree:false });
  window.addEventListener('rain:map-mode-change', event => setMapView(event.detail?.mode && event.detail.mode !== 'off'));
  window.addEventListener('rain:refresh', scheduleRender);
  window.addEventListener('online', scheduleRender);
  scheduleRender();
}

document.addEventListener('DOMContentLoaded', initRainHome, { once:true });