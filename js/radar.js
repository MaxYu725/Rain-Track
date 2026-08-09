import { fetchRadarFrames } from './api.js';
import { APP_VERSION, RADAR_CONTRACT_VERSION } from './config.js';
import { state } from './state.js';
import { clamp, formatDateTime, isMobileLayout } from './utils.js';
import { setBadge, setSheetMode, toast } from './ui.js';

const DEFAULT_PLAYBACK_DELAY = 750;
const RADAR_REFRESH_MS = 5.5 * 60 * 1000;
const RECENT_PRELOAD_COUNT = 12;

let displayToken = 0;
let preloadToken = 0;
let playTimer = null;
let refreshTimer = null;
let previousSheetMode = null;
let controlsReady = false;
let radarMode = localStorage.getItem('hkRainRadarMode') === 'test' ? 'test' : 'live';
let playbackDelay = normalizePlaybackDelay(localStorage.getItem('hkRainRadarSpeed'));

export function updateRadarCapability(capabilities = {}, contract = null) {
  state.worker.capabilities.radarFrames = Boolean(capabilities.radarFrames);
  state.worker.radarContract = contract || capabilities.radar || null;
  ensureRadarUi();

  const toggle = document.getElementById('toggle-radar');
  if (toggle) toggle.disabled = !state.worker.capabilities.radarFrames;
  const note = document.getElementById('radar-status-note');
  if (note) {
    note.textContent = state.worker.capabilities.radarFrames
      ? `Worker 已提供雷達幀；契約版本 ${state.worker.radarContract?.version || '不詳'}。預設使用 HKO 現行即時雷達影像索引，亦可切換測試動畫。`
      : `Foundation 已定義雷達 API 契約 v${RADAR_CONTRACT_VERSION}；目前 Worker 尚未啟用雷達資料。`;
  }
  setBadge('radar', state.worker.capabilities.radarFrames ? 'empty' : 'disabled', 'RADAR');
}

export async function toggleRadar(enabled) {
  ensureRadarUi();
  if (!enabled) {
    clearRadar({ restoreSheet:true });
    return;
  }
  if (!state.worker.capabilities.radarFrames) {
    state.layers.radar = false;
    const toggle = document.getElementById('toggle-radar');
    if (toggle) toggle.checked = false;
    toast('雷達介面已準備，但目前 Worker 尚未啟用雷達資料');
    return;
  }

  state.layers.radar = true;
  collapseSheetForRadar();
  await loadRadarFrames({ preserveTime:false });
}

export async function loadRadarFrames({ preserveTime = false, quiet = false } = {}) {
  ensureRadarUi();
  stopPlayback();
  clearTimeout(refreshTimer);

  const previousFrames = state.radar.frames;
  const previousIndex = state.radar.index;
  const previousFrame = previousFrames[previousIndex] || null;
  const previousTime = previousFrame?.time || null;
  const wasLatest = previousFrames.length > 0 && previousIndex === previousFrames.length - 1;
  if (!quiet) setBadge('radar','loading','RADAR');
  setRadarBusy(true);

  try {
    const data = await fetchRadarFrames(state.radar.range, radarMode);
    validateRadarResponse(data);
    state.radar.frames = data.frames;

    if (preserveTime && previousTime && !wasLatest) {
      const matched = data.frames.findIndex(frame => frame.time === previousTime);
      state.radar.index = matched >= 0 ? matched : Math.max(0, data.frames.length - 1);
    } else {
      state.radar.index = Math.max(0, data.frames.length - 1);
    }

    await showRadarFrame();
    collapseSheetForRadar();
    configureTimeline(data);
    preloadRecentFrames(data.frames);
    setBadge('radar','ok','RADAR');
    scheduleRadarRefresh();
  } catch (error) {
    if (quiet && state.radar.layer && previousFrames.length) {
      state.radar.frames = previousFrames;
      state.radar.index = clamp(previousIndex, 0, previousFrames.length - 1);
      configureTimeline(null);
      updateTimelineLabels();
      setBadge('radar','ok','RADAR');
      scheduleRadarRefresh();
    } else {
      removeRadarLayer();
      state.radar.frames = [];
      state.radar.index = 0;
      state.layers.radar = false;
      const toggle = document.getElementById('toggle-radar');
      if (toggle) toggle.checked = false;
      configureTimeline(null);
      restoreSheetAfterRadarFailure();
      setBadge('radar','error','RADAR');
      if (!quiet) toast(`雷達載入失敗：${error.message}`);
    }
  } finally {
    setRadarBusy(false);
    setTimelineLoading(false);
  }
}

function validateRadarResponse(data) {
  if (!data || !Array.isArray(data.frames)) throw new Error('雷達回應缺少 frames 陣列');
  if (data.contractVersion && data.contractVersion !== RADAR_CONTRACT_VERSION) {
    throw new Error(`不支援雷達契約版本 ${data.contractVersion}`);
  }
  if (!data.frames.length) throw new Error('沒有可用雷達幀');

  for (const frame of data.frames) {
    if (!frame?.time || !frame?.imageUrl || !frame?.bounds) throw new Error('雷達幀資料不完整');
    const { north, south, east, west } = frame.bounds;
    if (![north,south,east,west].every(Number.isFinite) || north <= south || east <= west) {
      throw new Error('雷達幀邊界無效');
    }
  }
}

async function showRadarFrame() {
  const frame = state.radar.frames[state.radar.index];
  if (!frame || !window.L || !state.map) return;
  const token = ++displayToken;
  const url = resolveImageUrl(frame.imageUrl);
  setTimelineLoading(true);
  const loaded = await preloadImage(url);
  if (token !== displayToken) return;
  if (!loaded) throw new Error('雷達影像載入失敗');

  const bounds = [[frame.bounds.south,frame.bounds.west],[frame.bounds.north,frame.bounds.east]];
  const next = window.L.imageOverlay(url, bounds, {
    opacity:state.radar.opacity,
    interactive:false,
    className:'rain-radar-overlay'
  }).addTo(state.map);

  if (state.radar.layer) state.map.removeLayer(state.radar.layer);
  state.radar.layer = next;
  updateTimelineLabels(frame);
  setTimelineLoading(false);
  preloadAdjacentFrames();
}

function configureTimeline(data) {
  ensureRadarUi();
  const panel = document.getElementById('radar-timeline');
  const slider = document.getElementById('radar-slider');
  const hasFrames = state.radar.frames.length > 0;
  panel?.classList.toggle('hidden', !hasFrames || !state.layers.radar);
  if (slider) {
    slider.max = Math.max(0, state.radar.frames.length - 1);
    slider.value = state.radar.index;
    slider.disabled = !hasFrames;
  }

  const modeChip = document.getElementById('radar-mode-chip');
  if (modeChip) {
    modeChip.textContent = radarMode === 'test' ? 'TEST' : `${state.radar.range} km`;
    modeChip.classList.toggle('test', radarMode === 'test');
  }
  const source = document.getElementById('radar-source-label');
  if (source) source.textContent = radarMode === 'test' ? '模擬測試幀' : 'HKO 即時雷達';
  const counter = document.getElementById('radar-frame-counter');
  if (counter) counter.textContent = hasFrames ? `${state.radar.index + 1}/${state.radar.frames.length}` : '0/0';
  const latest = document.getElementById('radar-latest-button');
  if (latest) latest.disabled = !hasFrames || state.radar.index === state.radar.frames.length - 1;
  if (data?.cadenceMinutes) panel?.setAttribute('data-cadence', String(data.cadenceMinutes));
  updatePlayButton();
}

function updateTimelineLabels(frame = state.radar.frames[state.radar.index]) {
  const time = document.getElementById('radar-timeline-time');
  if (time) time.textContent = frame ? formatDateTime(frame.time) : '—';
  const slider = document.getElementById('radar-slider');
  if (slider) slider.value = state.radar.index;
  const counter = document.getElementById('radar-frame-counter');
  if (counter) counter.textContent = state.radar.frames.length ? `${state.radar.index + 1}/${state.radar.frames.length}` : '0/0';
  const latest = document.getElementById('radar-latest-button');
  if (latest) latest.disabled = !state.radar.frames.length || state.radar.index === state.radar.frames.length - 1;
}

export function setRadarIndex(value) {
  stopPlayback();
  state.radar.index = clamp(Number(value) || 0, 0, Math.max(0, state.radar.frames.length - 1));
  showRadarFrame().catch(error => {
    setTimelineLoading(false);
    toast(error.message);
  });
}

export function changeRadarRange(value) {
  state.radar.range = String(value) === '256' ? 256 : 64;
  localStorage.setItem('hkRainRadarRange', String(state.radar.range));
  const modeChip = document.getElementById('radar-mode-chip');
  if (modeChip && radarMode !== 'test') modeChip.textContent = `${state.radar.range} km`;
  if (state.layers.radar) loadRadarFrames({ preserveTime:false });
}

export function setRadarOpacity(value) {
  state.radar.opacity = clamp(Number(value) / 100, 0, 1);
  localStorage.setItem('hkRainRadarOpacity', String(state.radar.opacity));
  const label = document.getElementById('radar-opacity-value');
  if (label) label.textContent = `${Math.round(state.radar.opacity * 100)}%`;
  state.radar.layer?.setOpacity(state.radar.opacity);
}

export function clearRadar({ restoreSheet = false } = {}) {
  stopPlayback();
  clearTimeout(refreshTimer);
  refreshTimer = null;
  state.layers.radar = false;
  state.radar.frames = [];
  state.radar.index = 0;
  removeRadarLayer();
  document.getElementById('radar-timeline')?.classList.add('hidden');
  setBadge('radar', state.worker.capabilities.radarFrames ? 'empty' : 'disabled', 'RADAR');

  if (restoreSheet && isMobileLayout() && previousSheetMode) {
    const restore = previousSheetMode;
    previousSheetMode = null;
    setSheetMode(restore, { persist:false, offset:false });
  }
}

function collapseSheetForRadar() {
  if (!isMobileLayout()) return;
  previousSheetMode ||= state.sheet.mode;
  if (state.sheet.mode !== 'peek') setSheetMode('peek', { persist:false, offset:false });
}

function restoreSheetAfterRadarFailure() {
  if (!previousSheetMode) return;
  const restore = previousSheetMode;
  previousSheetMode = null;
  if (isMobileLayout() && state.sheet.mode === 'peek') setSheetMode(restore, { persist:false, offset:false });
}

function removeRadarLayer() {
  if (state.radar.layer && state.map) state.map.removeLayer(state.radar.layer);
  state.radar.layer = null;
}

function togglePlayback() {
  if (playTimer) {
    stopPlayback();
    return;
  }
  if (state.radar.frames.length < 2) return;
  if (state.radar.index >= state.radar.frames.length - 1) state.radar.index = 0;
  updateTimelineLabels();
  playNext();
}

function playNext() {
  if (!state.layers.radar || state.radar.frames.length < 2) {
    stopPlayback();
    return;
  }
  updatePlayButton(true);
  showRadarFrame().catch(error => {
    stopPlayback();
    toast(error.message);
  });

  const atLatest = state.radar.index >= state.radar.frames.length - 1;
  const delay = atLatest ? Math.round(playbackDelay * 1.8) : playbackDelay;
  playTimer = setTimeout(() => {
    state.radar.index = atLatest ? 0 : state.radar.index + 1;
    updateTimelineLabels();
    playNext();
  }, delay);
}

function stopPlayback() {
  if (playTimer) clearTimeout(playTimer);
  playTimer = null;
  updatePlayButton(false);
}

function jumpToLatest() {
  stopPlayback();
  if (!state.radar.frames.length) return;
  state.radar.index = state.radar.frames.length - 1;
  showRadarFrame().catch(error => toast(error.message));
}

function updatePlayButton(forcePlaying = Boolean(playTimer)) {
  const button = document.getElementById('radar-play-button');
  if (!button) return;
  button.textContent = forcePlaying ? '❚❚' : '▶';
  button.setAttribute('aria-label', forcePlaying ? '暫停雷達動畫' : '播放雷達動畫');
  button.title = forcePlaying ? '暫停' : '播放';
}

function setRadarMode(value) {
  radarMode = value === 'test' ? 'test' : 'live';
  localStorage.setItem('hkRainRadarMode', radarMode);
  stopPlayback();
  const select = document.getElementById('radar-data-mode');
  if (select) select.value = radarMode;
  if (state.layers.radar) loadRadarFrames({ preserveTime:false });
  else configureTimeline(null);
}

function setPlaybackSpeed(value) {
  playbackDelay = normalizePlaybackDelay(value);
  localStorage.setItem('hkRainRadarSpeed', String(playbackDelay));
  const select = document.getElementById('radar-speed');
  if (select) select.value = String(playbackDelay);
  if (playTimer) {
    stopPlayback();
    togglePlayback();
  }
}

function normalizePlaybackDelay(value) {
  const number = Number(value);
  return [1100,750,500].includes(number) ? number : DEFAULT_PLAYBACK_DELAY;
}

function scheduleRadarRefresh() {
  clearTimeout(refreshTimer);
  if (!state.layers.radar || radarMode !== 'live') return;
  refreshTimer = setTimeout(() => {
    if (document.visibilityState === 'hidden' || !state.layers.radar) {
      scheduleRadarRefresh();
      return;
    }
    loadRadarFrames({ preserveTime:true, quiet:true });
  }, RADAR_REFRESH_MS);
}

function preloadRecentFrames(frames) {
  const token = ++preloadToken;
  const recent = frames.slice(-RECENT_PRELOAD_COUNT);
  Promise.allSettled(recent.map(async frame => {
    if (token !== preloadToken) return;
    await preloadImage(resolveImageUrl(frame.imageUrl));
  })).catch(() => {});
}

function preloadAdjacentFrames() {
  const indexes = [state.radar.index - 2, state.radar.index - 1, state.radar.index + 1, state.radar.index + 2]
    .filter(index => index >= 0 && index < state.radar.frames.length);
  indexes.forEach(index => preloadImage(resolveImageUrl(state.radar.frames[index].imageUrl)).catch(() => false));
}

function resolveImageUrl(imageUrl) {
  return /^https?:/i.test(imageUrl)
    ? imageUrl
    : state.apiBase + (imageUrl.startsWith('/') ? '' : '/') + imageUrl;
}

function preloadImage(url) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

function setRadarBusy(busy) {
  document.getElementById('radar-timeline')?.classList.toggle('is-loading', Boolean(busy));
  const toggle = document.getElementById('toggle-radar');
  if (toggle) toggle.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function setTimelineLoading(loading) {
  document.getElementById('radar-timeline')?.classList.toggle('frame-loading', Boolean(loading));
}

function ensureRadarUi() {
  if (controlsReady) return;
  controlsReady = true;
  ensureRadarStyles();
  document.title = `香港定點雨量預報 v${APP_VERSION}`;

  const timeline = document.getElementById('radar-timeline');
  if (timeline) {
    const head = timeline.querySelector('.timeline-head');
    if (head && !document.getElementById('radar-mode-chip')) {
      const left = document.createElement('span');
      left.className = 'radar-head-left';
      left.innerHTML = '<span id="radar-source-label">HKO 即時雷達</span><span id="radar-mode-chip" class="radar-mode-chip">64 km</span>';
      head.firstElementChild?.replaceWith(left);
      const counter = document.createElement('span');
      counter.id = 'radar-frame-counter';
      counter.className = 'radar-frame-counter';
      counter.textContent = '0/0';
      head.append(counter);
    }

    const control = timeline.querySelector('.timeline-control');
    const slider = document.getElementById('radar-slider');
    if (control && slider && !document.getElementById('radar-play-button')) {
      const play = document.createElement('button');
      play.id = 'radar-play-button';
      play.className = 'radar-timeline-btn radar-play-button';
      play.type = 'button';
      play.textContent = '▶';
      play.setAttribute('aria-label','播放雷達動畫');
      play.addEventListener('click', togglePlayback);
      control.insertBefore(play, slider);

      const latest = document.createElement('button');
      latest.id = 'radar-latest-button';
      latest.className = 'radar-timeline-btn radar-latest-button';
      latest.type = 'button';
      latest.textContent = '最新';
      latest.addEventListener('click', jumpToLatest);
      control.append(latest);
    }
  }

  const note = document.getElementById('radar-status-note');
  const section = note?.closest('section');
  if (section) {
    const heading = section.querySelector('.panel-title');
    if (heading) heading.textContent = '雨量雷達';
  }
  if (section && !document.getElementById('radar-data-mode')) {
    const modeRow = document.createElement('div');
    modeRow.className = 'setting-row';
    modeRow.innerHTML = '<label for="radar-data-mode">資料模式</label><select id="radar-data-mode"><option value="live">即時 HKO</option><option value="test">測試動畫</option></select>';
    note.before(modeRow);
    const modeSelect = document.getElementById('radar-data-mode');
    modeSelect.value = radarMode;
    modeSelect.addEventListener('change', event => setRadarMode(event.target.value));

    const speedRow = document.createElement('div');
    speedRow.className = 'setting-row';
    speedRow.innerHTML = '<label for="radar-speed">動畫速度</label><select id="radar-speed"><option value="1100">慢</option><option value="750">標準</option><option value="500">快</option></select>';
    note.before(speedRow);
    const speedSelect = document.getElementById('radar-speed');
    speedSelect.value = String(playbackDelay);
    speedSelect.addEventListener('change', event => setPlaybackSpeed(event.target.value));
  }
}

function ensureRadarStyles() {
  if (document.getElementById('radar-runtime-style')) return;
  const style = document.createElement('style');
  style.id = 'radar-runtime-style';
  style.textContent = `
    .radar-head-left{display:inline-flex;align-items:center;gap:7px;min-width:0}.radar-mode-chip{padding:2px 5px;border:1px solid #3d5664;color:#9bdcff;font-size:.66rem;line-height:1.2}.radar-mode-chip.test{border-color:#8b6b20;color:#ffd06a}.radar-frame-counter{margin-left:auto;color:#818181;font-size:.68rem}.radar-timeline-btn{flex:none;height:32px;min-width:36px;padding:0 8px;border:1px solid #4a4a4a;background:#0b0b0b;color:#ddd}.radar-latest-button{min-width:48px}.radar-timeline-btn:disabled{opacity:.4}.radar-timeline.frame-loading::after{content:'載入中';position:absolute;right:10px;top:-24px;padding:3px 6px;border:1px solid #3d3d3d;background:rgba(0,0,0,.88);color:#9ccce8;font-size:.68rem}.radar-timeline.is-loading{opacity:.82}.rain-radar-overlay{image-rendering:auto}
    @media(max-width:700px){.radar-timeline{bottom:calc(96px + var(--safe-bottom))}.radar-timeline-btn{height:34px}.radar-head-left{gap:5px}.radar-mode-chip{font-size:.62rem}.timeline-head{align-items:center}.timeline-control{gap:6px}}
  `;
  document.head.append(style);
}
