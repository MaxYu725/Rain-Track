import { fetchSwirlsPointFrame, fetchSwirlsPointSeries } from './api.js';
import { setRainMapMode } from './rain-map-mode.js';
import { state } from './state.js';

const SERIES_CACHE_MS = 4 * 60 * 1000;
const FRAME_COUNT = 16;
const RAIN_THRESHOLD_MM = 0.2;
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
    .rain-home-root{max-width:720px;margin:0 auto;padding:4px 0 24px}
    .rain-home-location{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:4px 0 22px;border-bottom:1px solid #252525}
    .rain-home-location-kicker{margin:0 0 5px;color:#8f8f8f;font-size:.76rem;letter-spacing:.04em;text-transform:uppercase}
    .rain-home-location-name{margin:0;color:#fff;font-size:clamp(1.55rem,5vw,2.35rem);font-weight:450;letter-spacing:-.03em;line-height:1.12}
    .rain-home-location-coord{margin-top:7px;color:#737373;font-size:.76rem;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
    .rain-home-locate{min-height:40px;padding:0 12px;border:1px solid #454545;background:#0d0d0d;color:#ddd}
    .rain-home-summary{padding:28px 0 22px}
    .rain-home-verdict{margin:0;max-width:680px;color:#fff;font-size:clamp(1.7rem,6vw,3rem);font-weight:330;letter-spacing:-.045em;line-height:1.12}
    .rain-home-detail{max-width:640px;margin:11px 0 0;color:#b9b9b9;font-size:1rem;line-height:1.65}
    .rain-home-chart-section{margin-top:6px;padding:18px 0 0;border-top:1px solid #252525}
    .rain-home-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:10px}
    .rain-home-section-title{margin:0;color:#fff;font-size:1rem;font-weight:650}
    .rain-home-section-note{color:#818181;font-size:.73rem;text-align:right;line-height:1.4}
    .rain-home-chart-wrap{position:relative;padding:12px 0 2px}
    .rain-home-chart{display:block;width:100%;height:auto;overflow:visible;color:var(--accent);touch-action:pan-y}
    .rain-home-grid{stroke:#262626;stroke-width:1;vector-effect:non-scaling-stroke}
    .rain-home-axis-label{fill:#757575;font-size:11px;font-family:"Segoe UI","Microsoft JhengHei",sans-serif}
    .rain-home-line{fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
    .rain-home-area{fill:currentColor;opacity:.10}
    .rain-home-dot{fill:#000;stroke:currentColor;stroke-width:2;vector-effect:non-scaling-stroke;transition:r .12s,fill .12s,stroke-width .12s}
    .rain-home-dot.selected{fill:currentColor;stroke-width:3;r:5}
    .rain-home-hit{fill:transparent;stroke:transparent;stroke-width:1;cursor:pointer;outline:none}
    .rain-home-hit:focus-visible{stroke:var(--cyan);stroke-width:2;fill:rgba(0,216,255,.08)}
    .rain-home-chart-readout{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px 18px;margin:10px 0 0;padding:12px 13px;border:1px solid #323b40;background:#090d0f;min-height:68px}
    .rain-home-readout-time{color:#fff;font-size:.88rem;font-weight:650;line-height:1.35}
    .rain-home-readout-window{margin-top:4px;color:#7f8a8f;font-size:.7rem;line-height:1.4}
    .rain-home-readout-value{color:#dff5ff;font-size:1.16rem;font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
    .rain-home-readout-unit{display:block;margin-top:2px;color:#71828a;font-size:.62rem;font-weight:400}
    .rain-home-chart-caption{display:flex;justify-content:space-between;gap:12px;margin-top:7px;color:#777;font-size:.72rem}
    .rain-home-meta{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:18px;padding-top:13px;border-top:1px solid #252525;color:#777;font-size:.74rem;line-height:1.5}
    .rain-home-primary-action{display:flex;width:100%;min-height:52px;align-items:center;justify-content:space-between;gap:14px;margin-top:24px;padding:0 16px;border:1px solid #3f7893;background:#07131a;color:#fff;font-weight:650;text-align:left}
    .rain-home-primary-action span:last-child{color:var(--accent);font-size:1.25rem}
    .rain-home-loading{display:flex;min-height:310px;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:#999;text-align:center}
    .rain-home-loading-spinner{width:28px;height:28px;border:2px solid #3c3c3c;border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
    .rain-home-error{margin-top:24px;padding:16px;border:1px solid #5d3a23;background:#160e08;color:#e9c29b;line-height:1.6}
    .rain-home-back-map{position:absolute;z-index:1200;top:12px;left:12px;display:none;min-height:42px;padding:0 13px;border:1px solid #5b5b5b;background:rgba(0,0,0,.9);color:#fff;box-shadow:0 3px 12px rgba(0,0,0,.4)}
    body.rain-home-v2.rain-map-view .rain-home-back-map{display:block}
    @media(max-width:700px){
      body.rain-home-v2:not(.rain-map-view) #forecast-panel .panel-inner{padding:12px 16px calc(26px + var(--safe-bottom))!important}
      .rain-home-location{padding-top:2px;padding-bottom:18px}.rain-home-summary{padding:22px 0 18px}
      .rain-home-section-head{align-items:flex-start;flex-direction:column;gap:5px}.rain-home-section-note{text-align:left}
      .rain-home-chart-readout{grid-template-columns:minmax(0,1fr) auto;padding:10px 11px}.rain-home-readout-value{font-size:1.05rem}
      .rain-home-chart-caption{font-size:.68rem}.rain-home-back-map{top:10px;left:10px}
    }
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
  if (Number(data.cadenceMinutes) !== 6 || Number(data.accumulationMinutes) !== 30) throw new Error('兩小時預報時間規格不符');
  points.forEach((point, index) => {
    if (Number(point.frameIndex) !== index || !Number.isFinite(Number(point.amountMm)) || Number(point.amountMm) < 0 || !Date.parse(point.validTime || '')) {
      throw new Error('兩小時預報含無效資料點');
    }
  });
  return { ...data, points };
}

function renderLoading(content, point) {
  content.innerHTML = `
    <section class="rain-home-root" data-point-key="${escapeHtml(pointKey(point))}">
      ${locationMarkup(point)}
      <div class="rain-home-loading"><span class="rain-home-loading-spinner" aria-hidden="true"></span><strong>正在整理未來兩小時雨勢</strong><span>讀取每 6 分鐘的定位點預報…</span></div>
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
      <div class="rain-home-error">${escapeHtml(error?.message || String(error))}</div>
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
          <div class="rain-home-section-note">SWIRLS +30 至 +120 分鐘 · 每 6 分鐘一點<br>每點代表該時刻前 30 分鐘累積雨量</div>
        </div>
        ${chartMarkup(data.points)}
        <div class="rain-home-meta">
          <span>預報基準 ${escapeHtml(formatClock(data.runTime))}</span>
          <span>有效至 ${escapeHtml(formatClock(data.points.at(-1)?.validTime))}</span>
          <span>${sourceMode === 'frame-fallback' ? '相容模式：16 個單幀定點資料' : '定位序列 endpoint'}</span>
          ${cached ? '<span>本機短期快取</span>' : ''}
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
  return '<button class="rain-home-primary-action" type="button" data-rain-home-map><span>查看 2 小時雨區</span><span aria-hidden="true">→</span></button>';
}

function bindHomeActions(content) {
  content.querySelector('[data-rain-home-locate]')?.addEventListener('click', () => document.getElementById('locate-button')?.click());
  content.querySelector('[data-rain-home-map]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    const label = button.querySelector('span');
    if (label) label.textContent = '正在開啟 2 小時雨區…';
    setMapView(true);
    const mode = await setRainMapMode('forecast');
    if (mode !== 'forecast') {
      setMapView(false);
      button.disabled = false;
      if (label) label.textContent = '查看 2 小時雨區';
    }
  });
}

function bindChartExplorer(content, points) {
  const chart = content.querySelector('.rain-home-chart');
  const readout = content.querySelector('[data-rain-home-readout]');
  const hits = [...content.querySelectorAll('[data-rain-home-point]')];
  const dots = [...content.querySelectorAll('.rain-home-dot')];
  if (!chart || !readout || hits.length !== points.length || dots.length !== points.length) return;

  const selectPoint = (index, { focus = false } = {}) => {
    const normalizedIndex = Math.max(0, Math.min(points.length - 1, Number(index) || 0));
    const sample = points[normalizedIndex];
    dots.forEach((dot, dotIndex) => dot.classList.toggle('selected', dotIndex === normalizedIndex));
    hits.forEach((hit, hitIndex) => hit.setAttribute('aria-pressed', hitIndex === normalizedIndex ? 'true' : 'false'));
    readout.innerHTML = chartReadoutMarkup(sample);
    readout.dataset.selectedIndex = String(normalizedIndex);
    if (focus) hits[normalizedIndex]?.focus();
  };

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

  const firstWetIndex = points.findIndex(point => Number(point.amountMm) >= RAIN_THRESHOLD_MM);
  selectPoint(firstWetIndex >= 0 ? firstWetIndex : 0);
}

function chartReadoutMarkup(point) {
  const validTime = formatClock(point?.validTime);
  const windowStart = formatClock(point?.windowStart);
  const windowEnd = formatClock(point?.windowEnd || point?.validTime);
  const lead = Number.isFinite(Number(point?.leadMinutes)) ? `+${Number(point.leadMinutes)} 分` : '預報時段';
  return `
    <div>
      <div class="rain-home-readout-time">有效時間 ${escapeHtml(validTime)} · ${escapeHtml(lead)}</div>
      <div class="rain-home-readout-window">30 分鐘累積時窗 ${escapeHtml(windowStart)}–${escapeHtml(windowEnd)}</div>
    </div>
    <div class="rain-home-readout-value">${escapeHtml(formatRain(point?.amountMm))}<span class="rain-home-readout-unit">mm / 30 min</span></div>`;
}

function analyzeTrend(data) {
  const points = data.points;
  const wet = points.filter(point => Number(point.amountMm) >= RAIN_THRESHOLD_MM);
  if (!wet.length) {
    return {
      title:'未來 2 小時暫無明顯降雨',
      detail:'目前定位點的 6 分鐘預報曲線維持接近 0 mm。可打開雨區地圖查看香港、深圳及南海附近是否有雨帶。',
      shortLabel:'暫無明顯降雨'
    };
  }

  const first = wet[0];
  const peak = points.reduce((best, point) => Number(point.amountMm) > Number(best.amountMm) ? point : best, points[0]);
  const last = points.at(-1);
  const firstWindowStart = formatClock(first.windowStart);
  const firstWindowEnd = formatClock(first.validTime);
  const peakTime = formatClock(peak.validTime);
  const startTitle = first.frameIndex === 0
    ? '未來 30 分鐘內可能有雨'
    : `約 ${firstWindowStart}–${firstWindowEnd} 開始見到降雨訊號`;

  const peakValue = formatRain(peak.amountMm);
  let direction = '之後雨勢變化不大。';
  if (Number(last.amountMm) <= Number(peak.amountMm) * 0.45) direction = '峰值後有明顯減弱趨勢。';
  else if (Number(last.amountMm) >= Number(peak.amountMm) * 0.85 && peak.frameIndex >= 11) direction = '較後段的降雨訊號仍然維持。';
  else if (peak.frameIndex <= 5) direction = '較強訊號出現在前段，之後逐步回落。';

  return {
    title:startTitle,
    detail:`較強的 30 分鐘累積雨量時窗約在 ${peakTime} 前後，最高約 ${peakValue} mm / 30 min。${direction}`,
    shortLabel:first.frameIndex === 0 ? '30 分鐘內可能有雨' : '稍後可能有雨'
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
  const x = index => pad.left + plotW * (index / Math.max(1, points.length - 1));
  const y = value => pad.top + plotH * (1 - Math.min(yMax, Math.max(0, value)) / yMax);
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(point.amountMm).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${(pad.top + plotH).toFixed(1)} L ${x(0).toFixed(1)} ${(pad.top + plotH).toFixed(1)} Z`;
  const ticks = [0, .25, .5, .75, 1].map(ratio => {
    const yy = pad.top + plotH * (1 - ratio);
    const value = yMax * ratio;
    return `<line class="rain-home-grid" x1="${pad.left}" y1="${yy.toFixed(1)}" x2="${width - pad.right}" y2="${yy.toFixed(1)}"></line><text class="rain-home-axis-label" x="${pad.left - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end">${formatAxis(value)}</text>`;
  }).join('');
  const xIndexes = [0,5,10,15];
  const xLabels = xIndexes.map(index => `<text class="rain-home-axis-label" x="${x(index).toFixed(1)}" y="${height - 8}" text-anchor="${index === 0 ? 'start' : index === 15 ? 'end' : 'middle'}">${escapeHtml(formatClock(points[index]?.validTime))}</text>`).join('');
  const dots = points.map((point, index) => `<circle class="rain-home-dot" cx="${x(index).toFixed(1)}" cy="${y(point.amountMm).toFixed(1)}" r="3"></circle>`).join('');
  const hits = points.map((point, index) => {
    const label = `有效時間 ${formatClock(point.validTime)}，${formatRain(point.amountMm)} mm / 30 min，預報 +${Number(point.leadMinutes)} 分鐘`;
    return `<circle class="rain-home-hit" cx="${x(index).toFixed(1)}" cy="${y(point.amountMm).toFixed(1)}" r="14" tabindex="0" role="button" aria-pressed="false" aria-label="${escapeHtml(label)}" data-rain-home-point="${index}"></circle>`;
  }).join('');
  const peak = Math.max(...values);
  return `
    <div class="rain-home-chart-wrap">
      <svg class="rain-home-chart" viewBox="0 0 ${width} ${height}" role="group" aria-label="未來兩小時定位點雨量折線圖，最高 ${formatRain(peak)} 毫米每 30 分鐘；可點選 16 個有效時間查看數值">
        ${ticks}<path class="rain-home-area" d="${area}"></path><path class="rain-home-line" d="${line}"></path>${dots}${hits}${xLabels}
      </svg>
      <div class="rain-home-chart-readout" data-rain-home-readout aria-live="polite"></div>
      <div class="rain-home-chart-caption"><span>縱軸：mm / 30 min</span><span>點選圓點查看 16 個有效時間</span></div>
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
