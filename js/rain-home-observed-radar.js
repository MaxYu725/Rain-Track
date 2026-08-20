import { fetchRadarFrames } from './api.js';
import { analyzeRadarFrameImage } from './radar-analysis-image.js';
import { radarCoverageLabel, radarStrengthLabel } from './radar-analysis.js';
import { state } from './state.js';

export const RAIN_HOME_OBSERVED_WINDOW_MINUTES = 30;
export const RAIN_HOME_OBSERVED_MAX_FRAMES = 6;
export const RAIN_HOME_OBSERVED_MAX_LATEST_AGE_MINUTES = 20;
const HOME_RADAR_RANGE_KM = 64;
const HOME_RADAR_SAMPLE_MAX_DIMENSION = 220;
const MIN_NEARBY_SAMPLES = 3;
const ECHO_COVERAGE_THRESHOLD = 0.018;

const analysisCache = new Map();
let loadToken = 0;
let activeController = null;
let observer = null;
let scheduled = false;

function formatClock(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-HK', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Asia/Hong_Kong' }).format(date);
}

function pointKey(point = state.selected) {
  return `${Number(point?.lat).toFixed(4)}|${Number(point?.lon).toFixed(4)}|${Number(state.radiusKm)}`;
}

export function selectObservedRadarFrames(frames, {
  windowMinutes = RAIN_HOME_OBSERVED_WINDOW_MINUTES,
  maxFrames = RAIN_HOME_OBSERVED_MAX_FRAMES
} = {}) {
  const valid = (Array.isArray(frames) ? frames : [])
    .filter(frame => frame?.time && frame?.imageUrl && Number.isFinite(Date.parse(frame.time)))
    .slice()
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  if (!valid.length) return [];
  const latestMs = Date.parse(valid.at(-1).time);
  const cutoffMs = latestMs - Math.max(1, Number(windowMinutes) || RAIN_HOME_OBSERVED_WINDOW_MINUTES) * 60_000;
  return valid
    .filter(frame => Date.parse(frame.time) >= cutoffMs && Date.parse(frame.time) <= latestMs)
    .slice(-Math.max(1, Number(maxFrames) || RAIN_HOME_OBSERVED_MAX_FRAMES));
}

export function observedRadarLevel(nearby) {
  if (!nearby || Number(nearby.sampleCount) < MIN_NEARBY_SAMPLES || Number(nearby.coverage) < ECHO_COVERAGE_THRESHOLD) return 0;
  const mean = Number(nearby.meanStrength) || 0;
  const max = Number(nearby.maxStrength) || 0;
  if (max >= 4.4 && mean >= 2.4) return 5;
  if (mean >= 3.2) return 4;
  if (mean >= 2.1) return 3;
  if (mean >= 1.35) return 2;
  return 1;
}

export function describeObservedRadarHistory(samples, { locationName = '所在地' } = {}) {
  const usable = (Array.isArray(samples) ? samples : []).filter(sample => Number(sample?.nearby?.sampleCount) >= MIN_NEARBY_SAMPLES);
  if (!usable.length) return null;
  const latest = usable.at(-1);
  const latestLevel = observedRadarLevel(latest.nearby);
  const earlierEcho = usable.slice(0, -1).some(sample => observedRadarLevel(sample.nearby) > 0);
  const latestClock = formatClock(latest.time);

  let text;
  if (latestLevel > 0) {
    const coverage = radarCoverageLabel(latest.nearby.coverage);
    text = `${locationName}附近目前有${coverage}回波 · ${radarStrengthLabel(latest.nearby.meanStrength, latest.nearby.maxStrength)}`;
  } else if (earlierEcho) {
    text = `過去 30 分鐘${locationName}附近曾有回波，目前暫未見明顯回波`;
  } else {
    text = `過去 30 分鐘${locationName}附近暫未見明顯雷達回波`;
  }

  return {
    text,
    latestClock,
    latestLevel,
    currentEcho:latestLevel > 0,
    earlierEcho,
    firstClock:formatClock(usable[0].time),
    lastClock:latestClock
  };
}

function latestFrameIsFresh(frames, nowMs = Date.now()) {
  const latestMs = Date.parse(frames?.at(-1)?.time || '');
  if (!Number.isFinite(latestMs)) return false;
  const ageMinutes = (nowMs - latestMs) / 60_000;
  return ageMinutes >= -5 && ageMinutes <= RAIN_HOME_OBSERVED_MAX_LATEST_AGE_MINUTES;
}

function analysisKey(frame, height) {
  return `${pointKey()}|${height}|${frame?.time || ''}|${frame?.id || ''}`;
}

async function analyzeObservedFrame(frame, height) {
  const key = analysisKey(frame, height);
  if (analysisCache.has(key)) return analysisCache.get(key);
  const promise = analyzeRadarFrameImage(frame, {
    apiBase:state.apiBase,
    location:state.selected,
    radiusKm:state.radiusKm,
    rangeKm:HOME_RADAR_RANGE_KM,
    heightKm:height,
    maxDimension:HOME_RADAR_SAMPLE_MAX_DIMENSION
  }).catch(error => {
    analysisCache.delete(key);
    throw error;
  });
  analysisCache.set(key, promise);
  return promise;
}

function observedLevelClass(level) {
  return `level-${Math.max(0, Math.min(5, Number(level) || 0))}`;
}

function ensureStyles() {
  if (document.getElementById('rain-home-observed-radar-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-home-observed-radar-style';
  style.textContent = `
    .rain-home-observed{margin:0 0 16px;padding:11px 12px 10px;border:1px solid #20292e;background:#06090b}
    .rain-home-observed-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.rain-home-observed-title{color:#d8e1e5;font-size:.78rem;font-weight:680}.rain-home-observed-source{color:#65747b;font-size:.62rem}
    .rain-home-observed-summary{margin-top:5px;color:#9fb0b7;font-size:.73rem;line-height:1.4}.rain-home-observed-track{display:grid;grid-template-columns:repeat(var(--rain-observed-count),minmax(0,1fr));gap:3px;height:16px;margin-top:9px}.rain-home-observed-segment{border-radius:2px;background:#11181b;box-shadow:inset 0 0 0 1px rgba(255,255,255,.025)}
    .rain-home-observed-segment.level-1{background:#0b4f74}.rain-home-observed-segment.level-2{background:#087f9a}.rain-home-observed-segment.level-3{background:#0b8e61}.rain-home-observed-segment.level-4{background:#9a9600}.rain-home-observed-segment.level-5{background:#c76326}
    .rain-home-observed-times{display:flex;justify-content:space-between;margin-top:5px;color:#59666c;font-size:.6rem;font-variant-numeric:tabular-nums}.rain-home-observed-context{margin-top:10px;padding-left:10px;border-left:2px solid var(--accent);color:#9fc7d8;font-size:.72rem;line-height:1.45}
    @media(max-width:700px){.rain-home-observed{margin-bottom:13px;padding:10px}.rain-home-observed-title{font-size:.8rem}.rain-home-observed-summary{font-size:.72rem}.rain-home-observed-track{height:18px}}
  `;
  document.head.append(style);
}

function clearObserved(root) {
  root?.querySelector('[data-rain-home-observed-radar]')?.remove();
  root?.querySelector('[data-rain-home-observed-context]')?.remove();
}

function renderObserved(root, samples, summary) {
  if (!root?.isConnected || !summary) return;
  clearObserved(root);
  const section = document.createElement('section');
  section.className = 'rain-home-observed';
  section.setAttribute('data-rain-home-observed-radar', '1');
  section.setAttribute('aria-label', '過去 30 分鐘雷達實況');
  const cells = samples.map(sample => {
    const level = observedRadarLevel(sample.nearby);
    const label = level > 0
      ? `${formatClock(sample.time)} ${radarCoverageLabel(sample.nearby.coverage)}回波`
      : `${formatClock(sample.time)} 暫未見明顯回波`;
    return `<span class="rain-home-observed-segment ${observedLevelClass(level)}" title="${label}" aria-label="${label}"></span>`;
  }).join('');
  section.innerHTML = `
    <div class="rain-home-observed-head"><div class="rain-home-observed-title">過去 30 分鐘實況</div><div class="rain-home-observed-source">HKO 雷達回波</div></div>
    <div class="rain-home-observed-summary">截至 ${summary.latestClock} · ${summary.text}</div>
    <div class="rain-home-observed-track" style="--rain-observed-count:${samples.length}">${cells}</div>
    <div class="rain-home-observed-times"><span>${summary.firstClock}</span><span>${summary.lastClock}</span></div>`;
  root.querySelector('.rain-home-chart-section')?.before(section);

  const verdict = String(root.querySelector('.rain-home-verdict')?.textContent || '');
  if (summary.currentEcho && /暫無明顯降雨|稍後可能有雨|可用預報時段有雨訊號/.test(verdict)) {
    const note = document.createElement('div');
    note.className = 'rain-home-observed-context';
    note.setAttribute('data-rain-home-observed-context', '1');
    note.textContent = `雷達實況：${state.selected?.name || '所在地'}附近目前已有回波；未來雨量仍以 SWIRLS 預報為準。`;
    root.querySelector('.rain-home-summary')?.append(note);
  }
}

async function loadObservedForRoot(root) {
  if (!root?.isConnected || root.dataset.viewKind !== 'ready') return;
  const token = ++loadToken;
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  root.dataset.rainHomeObservedLoading = '1';
  try {
    const height = [2,3].includes(Number(state.radar.height)) ? Number(state.radar.height) : 3;
    const sourceFrames = state.radar.range === HOME_RADAR_RANGE_KM && state.radar.height === height && state.radar.frames.length
      ? state.radar.frames
      : (await fetchRadarFrames(HOME_RADAR_RANGE_KM, 'live', height, { signal:controller.signal, timeoutMs:15_000 })).frames;
    if (token !== loadToken || controller.signal.aborted || !root.isConnected) return;
    const frames = selectObservedRadarFrames(sourceFrames);
    if (frames.length < 3 || !latestFrameIsFresh(frames)) return;

    const results = await Promise.allSettled(frames.map(frame => analyzeObservedFrame(frame, height)));
    if (token !== loadToken || controller.signal.aborted || !root.isConnected) return;
    const samples = results.map((result, index) => result.status === 'fulfilled' && result.value
      ? { time:frames[index].time, nearby:result.value.nearby }
      : null).filter(Boolean);
    const summary = describeObservedRadarHistory(samples, { locationName:state.selected?.name || '所在地' });
    if (!summary || samples.length < 3) return;
    ensureStyles();
    renderObserved(root, samples, summary);
    root.dataset.rainHomeObservedKey = `${pointKey()}|${frames.at(-1)?.time || ''}`;
  } catch (error) {
    if (!controller.signal.aborted) console.warn('Rain Home Radar observation skipped:', error?.message || error);
  } finally {
    if (token === loadToken && root?.isConnected) delete root.dataset.rainHomeObservedLoading;
  }
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    const root = document.querySelector('.rain-home-root[data-view-kind="ready"]');
    if (!root || root.dataset.rainHomeObservedLoading === '1') return;
    void loadObservedForRoot(root);
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout:1200 });
  else setTimeout(run, 250);
}

function resetObserved() {
  loadToken += 1;
  activeController?.abort();
  activeController = null;
  analysisCache.clear();
  const root = document.querySelector('.rain-home-root[data-view-kind="ready"]');
  clearObserved(root);
  scheduleEnhance();
}

function initRainHomeObservedRadar() {
  ensureStyles();
  scheduleEnhance();
  const content = document.getElementById('forecast-content');
  if (content) {
    observer = new MutationObserver(() => scheduleEnhance());
    observer.observe(content, { childList:true, subtree:true });
  }
  window.addEventListener('rain:location-change', resetObserved);
  window.addEventListener('rain:refresh', resetObserved);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initRainHomeObservedRadar, { once:true });
  else initRainHomeObservedRadar();
}
