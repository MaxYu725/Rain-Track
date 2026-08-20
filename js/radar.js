import { fetchRadarFrames } from './api.js';
import { APP_VERSION, RADAR_CONTRACT_VERSION } from './config.js';
import { state } from './state.js';
import { updateForecastMobileStatus } from './forecast.js';
import { clamp, formatDateTime } from './utils.js';
import { setBadge, setMobileStatus, toast } from './ui.js';

const DEFAULT_PLAYBACK_DELAY = 750;
const RADAR_REFRESH_MS = 5.5 * 60 * 1000;
const RECENT_PRELOAD_COUNT = 8;
const RADAR_FRESH_NORMAL_MINUTES = 15;
const RADAR_FRESH_MAX_MINUTES = 30;

let displayToken = 0;
let preloadToken = 0;
let playToken = 0;
let playTimer = null;
let playResolve = null;
let refreshTimer = null;
let controlsReady = false;
let radarBusy = false;
let playing = false;
let sliderScrubbing = false;
let sliderPreviewIndex = null;
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
      ? `Worker 已提供雷達幀；契約版本 ${state.worker.radarContract?.version || '不詳'}。Live 模式使用 HKO GIS 透明雷達回波${supportsRadarHeightSelection() ? '，64 km 可選 2 / 3 km 高度' : ''}。`
      : `Foundation 已定義雷達 API 契約 v${RADAR_CONTRACT_VERSION}；目前 Worker 尚未啟用雷達資料。`;
  }
  setBadge('radar', state.worker.capabilities.radarFrames ? 'empty' : 'disabled', 'RADAR');
  syncRadarHeightUi();
  syncRadarQuickControls();
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
    syncRadarQuickControls(false);
    toast('雷達介面已準備，但目前 Worker 尚未啟用雷達資料');
    return;
  }

  state.layers.radar = true;
  syncRadarQuickControls(true);
  await loadRadarFrames({ preserveTime:false, fitBounds:true });
}

export async function loadRadarFrames({ preserveTime = false, quiet = false, fitBounds = false } = {}) {
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
    const data = await fetchRadarFrames(state.radar.range, radarMode, state.radar.height);
    validateRadarResponse(data);
    if (Number(data.heightKm) === 2 || Number(data.heightKm) === 3) state.radar.height = Number(data.heightKm);
    state.radar.frames = data.frames;
    syncRadarHeightUi();

    let targetIndex = Math.max(0, data.frames.length - 1);
    if (preserveTime && previousTime && !wasLatest) {
      const matched = data.frames.findIndex(frame => frame.time === previousTime);
      if (matched >= 0) targetIndex = matched;
    }

    await showRadarFrame(targetIndex, { fitBounds });
    configureTimeline(data);
    preloadRecentFrames(data.frames);
    setBadge('radar','ok','RADAR');
    updateRadarMobileStatus();
    scheduleRadarRefresh();
  } catch (error) {
    if (quiet && state.radar.layer && previousFrames.length) {
      state.radar.frames = previousFrames;
      state.radar.index = clamp(previousIndex, 0, previousFrames.length - 1);
      configureTimeline(null);
      updateTimelineLabels();
      setBadge('radar','ok','RADAR');
      updateRadarMobileStatus({ refreshFailed:true });
      scheduleRadarRefresh();
    } else {
      removeRadarLayer();
      state.radar.frames = [];
      state.radar.index = 0;
      state.layers.radar = false;
      const toggle = document.getElementById('toggle-radar');
      if (toggle) toggle.checked = false;
      configureTimeline(null);
      syncRadarQuickControls(false);
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

async function showRadarFrame(targetIndex = state.radar.index, { fitBounds = false } = {}) {
  const index = clamp(Number(targetIndex) || 0, 0, Math.max(0, state.radar.frames.length - 1));
  const frame = state.radar.frames[index];
  if (!frame || !window.L || !state.map) return false;

  const token = ++displayToken;
  const url = resolveImageUrl(frame.imageUrl);
  setTimelineLoading(true);
  try {
    const loaded = await preloadImage(url);
    if (token !== displayToken) return false;
    if (!loaded) throw new Error('雷達影像載入失敗');

    ensureRadarPane();
    const bounds = [[frame.bounds.south,frame.bounds.west],[frame.bounds.north,frame.bounds.east]];
    const next = window.L.imageOverlay(url, bounds, {
      opacity:state.radar.opacity,
      interactive:false,
      pane:'radarPane',
      className:`rain-radar-overlay ${radarMode === 'live' ? 'live-radar-overlay' : 'test-radar-overlay'}`
    }).addTo(state.map);

    if (token !== displayToken) {
      state.map.removeLayer(next);
      return false;
    }
    if (state.radar.layer) state.map.removeLayer(state.radar.layer);
    state.radar.layer = next;
    state.radar.index = index;
    clearRadarPreview();
    updateTimelineLabels(frame);
    if (fitBounds) fitRadarFrameBounds(frame);
    preloadAdjacentFrames(index);
    window.dispatchEvent(new CustomEvent('rain:radar-frame-change', { detail:{ index, frame } }));
    return true;
  } finally {
    if (token === displayToken) setTimelineLoading(false);
  }
}

function ensureRadarPane() {
  if (!state.map) return;
  let pane = state.map.getPane('radarPane');
  if (!pane) pane = state.map.createPane('radarPane');
  pane.style.zIndex = '350';
  pane.style.pointerEvents = 'none';
}

function fitRadarFrameBounds(frame) {
  if (!state.map || !frame?.bounds) return;
  state.map.invalidateSize?.({ pan:false, animate:false });
  state.map.fitBounds(
    [[frame.bounds.south, frame.bounds.west], [frame.bounds.north, frame.bounds.east]],
    { animate:false, paddingTopLeft:[20,64], paddingBottomRight:[20,150] }
  );
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
    modeChip.textContent = radarModeChipText();
    modeChip.classList.toggle('test', radarMode === 'test');
  }
  const source = document.getElementById('radar-source-label');
  if (source) source.textContent = radarMode === 'test' ? '模擬測試幀' : 'HKO 即時雷達';
  const counter = document.getElementById('radar-frame-counter');
  if (counter) counter.textContent = hasFrames ? `${state.radar.index + 1}/${state.radar.frames.length}` : '0/0';
  const latest = document.getElementById('radar-latest-button');
  if (latest) latest.disabled = !hasFrames || state.radar.index === state.radar.frames.length - 1;
  const legend = document.getElementById('radar-legend');
  if (legend) legend.classList.toggle('hidden', !hasFrames || !state.layers.radar || radarMode === 'test');
  if (data?.cadenceMinutes) panel?.setAttribute('data-cadence', String(data.cadenceMinutes));
  updateRadarAgeLabel();
  updatePlayButton();
  syncRadarQuickControls();
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
  updateRadarAgeLabel();
}

function previewRadarIndex(value) {
  const index = clamp(Number(value) || 0, 0, Math.max(0, state.radar.frames.length - 1));
  const frame = state.radar.frames[index];
  if (!frame) return;
  sliderPreviewIndex = index;
  document.getElementById('radar-timeline')?.classList.add('is-preview');
  const time = document.getElementById('radar-timeline-time');
  if (time) time.textContent = `預覽 ${formatDateTime(frame.time)}`;
  const counter = document.getElementById('radar-frame-counter');
  if (counter) counter.textContent = `${index + 1}/${state.radar.frames.length}`;
  const latest = document.getElementById('radar-latest-button');
  if (latest) latest.disabled = index === state.radar.frames.length - 1;
}

function clearRadarPreview({ restore = false } = {}) {
  sliderPreviewIndex = null;
  document.getElementById('radar-timeline')?.classList.remove('is-preview');
  if (restore) updateTimelineLabels();
}

export async function setRadarIndex(value) {
  stopPlayback();
  const index = clamp(Number(value) || 0, 0, Math.max(0, state.radar.frames.length - 1));
  try {
    return await showRadarFrame(index);
  } catch (error) {
    setTimelineLoading(false);
    clearRadarPreview({ restore:true });
    toast(error.message);
    return false;
  }
}

export function changeRadarRange(value) {
  const nextRange = String(value) === '256' ? 256 : 64;
  if (state.radar.range === nextRange) {
    syncRadarHeightUi();
    return;
  }
  stopPlayback();
  state.radar.range = nextRange;
  localStorage.setItem('hkRainRadarRange', String(state.radar.range));
  if (state.radar.range === 64) {
    state.radar.height = localStorage.getItem('hkRainRadarHeight') === '2' ? 2 : 3;
  } else {
    state.radar.height = 3;
  }
  syncRadarHeightUi();
  if (state.layers.radar) void loadRadarFrames({ preserveTime:true, fitBounds:true });
}

export function changeRadarHeight(value) {
  const requested = String(value) === '2' ? 2 : 3;
  const available = availableRadarHeights(state.radar.range);
  if (!available.includes(requested) || radarMode === 'test') {
    state.radar.height = available.includes(3) ? 3 : (available[0] || 3);
    syncRadarHeightUi();
    return;
  }
  if (state.radar.height === requested) {
    syncRadarHeightUi();
    return;
  }
  stopPlayback();
  state.radar.height = requested;
  if (state.radar.range === 64) localStorage.setItem('hkRainRadarHeight', String(requested));
  syncRadarHeightUi();
  if (state.layers.radar) void loadRadarFrames({ preserveTime:true, fitBounds:false });
}

export function setRadarOpacity(value) {
  state.radar.opacity = clamp(Number(value) / 100, 0, 1);
  localStorage.setItem('hkRainRadarOpacity', String(state.radar.opacity));
  const label = document.getElementById('radar-opacity-value');
  if (label) label.textContent = `${Math.round(state.radar.opacity * 100)}%`;
  state.radar.layer?.setOpacity(state.radar.opacity);
}

export function clearRadar({ restoreSheet = false } = {}) {
  void restoreSheet;
  stopPlayback();
  clearTimeout(refreshTimer);
  refreshTimer = null;
  ++displayToken;
  ++preloadToken;
  state.layers.radar = false;
  state.radar.frames = [];
  state.radar.index = 0;
  clearRadarPreview();
  removeRadarLayer();
  document.getElementById('radar-timeline')?.classList.add('hidden');
  syncRadarQuickControls(false);
  setBadge('radar', state.worker.capabilities.radarFrames ? 'empty' : 'disabled', 'RADAR');
  updateForecastMobileStatus();
}

function removeRadarLayer() {
  if (state.radar.layer && state.map) state.map.removeLayer(state.radar.layer);
  state.radar.layer = null;
}

function togglePlayback() {
  if (playing) {
    stopPlayback();
    return;
  }
  if (state.radar.frames.length < 2) return;
  playing = true;
  const token = ++playToken;
  const last = state.radar.frames.length - 1;
  const startIndex = state.radar.index >= last ? 0 : state.radar.index;
  updatePlayButton(true);
  void playbackLoop(token, startIndex);
}

async function playbackLoop(token, startIndex) {
  let targetIndex = startIndex;
  while (playing && token === playToken && state.layers.radar && state.radar.frames.length > 1) {
    try {
      const shown = await showRadarFrame(targetIndex);
      if (!shown || !playing || token !== playToken) return;
    } catch (error) {
      stopPlayback();
      toast(error.message);
      return;
    }

    const atLatest = targetIndex >= state.radar.frames.length - 1;
    const delay = atLatest ? Math.round(playbackDelay * 1.8) : playbackDelay;
    const keepPlaying = await waitForPlaybackDelay(delay, token);
    if (!keepPlaying) return;
    targetIndex = atLatest ? 0 : targetIndex + 1;
  }
}

function waitForPlaybackDelay(delay, token) {
  return new Promise(resolve => {
    playResolve = resolve;
    playTimer = setTimeout(() => {
      playTimer = null;
      playResolve = null;
      resolve(playing && token === playToken);
    }, delay);
  });
}

function stopPlayback() {
  playing = false;
  ++playToken;
  if (playTimer) clearTimeout(playTimer);
  playTimer = null;
  if (playResolve) playResolve(false);
  playResolve = null;
  updatePlayButton(false);
}

async function jumpToLatest() {
  stopPlayback();
  if (!state.radar.frames.length) return;
  try {
    await showRadarFrame(state.radar.frames.length - 1);
  } catch (error) {
    toast(error.message);
  }
}

function updatePlayButton(forcePlaying = playing) {
  const button = document.getElementById('radar-play-button');
  if (!button) return;
  button.textContent = forcePlaying ? '❚❚' : '▶';
  button.setAttribute('aria-label', forcePlaying ? '暫停雷達動畫' : '播放雷達動畫');
  button.title = forcePlaying ? '暫停' : '播放';
}

function latestRadarAgeMinutes() {
  const latest = state.radar.frames.at(-1);
  const time = latest?.time ? Date.parse(latest.time) : NaN;
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.round((Date.now() - time) / 60000));
}

function updateRadarAgeLabel() {
  const label = document.getElementById('radar-age-label');
  if (!label) return;
  if (radarMode === 'test') { label.textContent = 'TEST'; return; }
  const age = latestRadarAgeMinutes();
  label.textContent = Number.isFinite(age) ? `最新 ${age === 0 ? '剛剛' : `${age} 分鐘前`}` : '最新時間不詳';
}

function updateRadarMobileStatus({ refreshFailed = false } = {}) {
  if (!state.layers.radar) return;
  if (radarMode === 'test') {
    setMobileStatus('ok', '雷達 TEST 模式');
    setBadge('radar','ok','RADAR');
    return;
  }
  const age = latestRadarAgeMinutes();
  if (!Number.isFinite(age)) {
    setMobileStatus('loading', '雷達時間不詳');
    setBadge('radar','loading','RADAR');
    return;
  }
  if (refreshFailed) {
    setMobileStatus('loading', `雷達暫未更新 · ${age}分鐘前`);
    setBadge('radar','loading','RADAR');
    return;
  }
  if (age <= RADAR_FRESH_NORMAL_MINUTES) {
    setMobileStatus('ok', age === 0 ? '雷達剛更新' : `雷達 ${age}分鐘前`);
    setBadge('radar','ok','RADAR');
  } else if (age <= RADAR_FRESH_MAX_MINUTES) {
    setMobileStatus('loading', `雷達更新稍有延遲 · ${age}分鐘`);
    setBadge('radar','loading','RADAR');
  } else {
    setMobileStatus('error', `雷達資料過舊 · ${age}分鐘`);
    setBadge('radar','error','RADAR');
  }
}

function availableRadarHeights(range = state.radar.range) {
  const map = state.worker.radarContract?.heightsKmByRange;
  const raw = map?.[String(range)] ?? map?.[range];
  if (!Array.isArray(raw)) return [3];
  const values = [...new Set(raw.map(Number).filter(value => value === 2 || value === 3))];
  return values.length ? values : [3];
}

function supportsRadarHeightSelection() {
  return availableRadarHeights(64).includes(2);
}

function radarModeChipText() {
  if (radarMode === 'test') return 'TEST';
  return `${state.radar.range} km · ${state.radar.height} km高`;
}

function syncRadarHeightUi() {
  const row = document.getElementById('radar-height-row');
  const select = document.getElementById('radar-height');
  const supported = supportsRadarHeightSelection();
  row?.classList.toggle('hidden', !supported);

  if (!supported) {
    state.radar.height = 3;
    if (select) {
      select.value = '3';
      select.disabled = true;
    }
  } else {
    const available = availableRadarHeights(state.radar.range);
    if (!available.includes(state.radar.height)) {
      const preferred = state.radar.range === 64 && localStorage.getItem('hkRainRadarHeight') === '2' ? 2 : 3;
      state.radar.height = available.includes(preferred) ? preferred : (available.includes(3) ? 3 : available[0]);
    }
    if (select) {
      select.value = String(state.radar.height);
      select.disabled = radarMode === 'test' || available.length < 2;
      const option2 = select.querySelector('option[value="2"]');
      if (option2) option2.disabled = !available.includes(2);
    }
  }

  const modeChip = document.getElementById('radar-mode-chip');
  if (modeChip) modeChip.textContent = radarModeChipText();
  syncRadarQuickControls();
}

function setRadarMode(value) {
  radarMode = value === 'test' ? 'test' : 'live';
  localStorage.setItem('hkRainRadarMode', radarMode);
  stopPlayback();
  const select = document.getElementById('radar-data-mode');
  if (select) select.value = radarMode;
  syncRadarHeightUi();
  if (state.layers.radar) void loadRadarFrames({ preserveTime:false, fitBounds:false });
  else configureTimeline(null);
}

function setPlaybackSpeed(value) {
  playbackDelay = normalizePlaybackDelay(value);
  localStorage.setItem('hkRainRadarSpeed', String(playbackDelay));
  const select = document.getElementById('radar-speed');
  if (select) select.value = String(playbackDelay);
}

function normalizePlaybackDelay(value) {
  const number = Number(value);
  return [1100,750,500].includes(number) ? number : DEFAULT_PLAYBACK_DELAY;
}

function scheduleRadarRefresh() {
  clearTimeout(refreshTimer);
  if (!state.layers.radar || radarMode !== 'live') return;
  refreshTimer = setTimeout(() => {
    if (document.visibilityState === 'hidden' || !state.layers.radar || playing || radarBusy) {
      scheduleRadarRefresh();
      return;
    }
    void loadRadarFrames({ preserveTime:true, quiet:true, fitBounds:false });
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

function preloadAdjacentFrames(centerIndex = state.radar.index) {
  const indexes = [centerIndex - 2, centerIndex - 1, centerIndex + 1, centerIndex + 2]
    .filter(index => index >= 0 && index < state.radar.frames.length);
  indexes.forEach(index => preloadImage(resolveImageUrl(state.radar.frames[index].imageUrl)).catch(() => false));
}

function resolveImageUrl(imageUrl) {
  return /^https?:/i.test(imageUrl)
    ? imageUrl
    : state.apiBase + (imageUrl.startsWith('/') ? '' : '/') + imageUrl;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('雷達影像載入失敗'));
    image.src = url;
  });
}

function preloadImage(url) {
  return loadImage(url).then(() => true).catch(() => false);
}

function setRadarBusy(busy) {
  radarBusy = Boolean(busy);
  document.getElementById('radar-timeline')?.classList.toggle('is-loading', radarBusy);
  const toggle = document.getElementById('toggle-radar');
  if (toggle) toggle.setAttribute('aria-busy', radarBusy ? 'true' : 'false');
  syncRadarQuickControls();
}

function setTimelineLoading(loading) {
  document.getElementById('radar-timeline')?.classList.toggle('frame-loading', Boolean(loading));
}

function ensureRadarQuickControls() {
  let root = document.getElementById('radar-quick-controls');
  if (root) return root;
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer) return null;

  root = document.createElement('div');
  root.id = 'radar-quick-controls';
  root.className = 'radar-quick-controls';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', '雷達顯示設定');
  root.innerHTML = `
    <span class="radar-quick-label">範圍</span>
    <button type="button" data-radar-range="64">64 km</button>
    <button type="button" data-radar-range="256">256 km</button>
    <span class="radar-quick-divider" aria-hidden="true"></span>
    <span class="radar-quick-label">高度</span>
    <button type="button" data-radar-height="2">2 km高</button>
    <button type="button" data-radar-height="3">3 km高</button>`;

  root.addEventListener('click', event => {
    const rangeButton = event.target.closest('[data-radar-range]');
    const heightButton = event.target.closest('[data-radar-height]');
    if (!rangeButton && !heightButton) return;
    event.preventDefault();
    event.stopPropagation();
    if (rangeButton && !rangeButton.disabled) changeRadarRange(rangeButton.dataset.radarRange);
    if (heightButton && !heightButton.disabled) changeRadarHeight(heightButton.dataset.radarHeight);
  });
  mapContainer.append(root);
  return root;
}

function syncRadarQuickControls(forceVisible = state.layers.radar) {
  const root = ensureRadarQuickControls();
  if (!root) return;
  const visible = Boolean(forceVisible) && state.worker.capabilities.radarFrames;
  root.classList.toggle('visible', visible);
  root.setAttribute('aria-hidden', visible ? 'false' : 'true');

  root.querySelectorAll('[data-radar-range]').forEach(button => {
    const active = Number(button.dataset.radarRange) === state.radar.range;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.disabled = radarBusy;
  });

  const available = availableRadarHeights(state.radar.range);
  root.querySelectorAll('[data-radar-height]').forEach(button => {
    const height = Number(button.dataset.radarHeight);
    const active = height === state.radar.height;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.disabled = radarBusy || radarMode === 'test' || !available.includes(height);
  });
}

function bindRadarSliderCommit() {
  const slider = document.getElementById('radar-slider');
  if (!slider || slider.dataset.radarV2Bound === '1') return;
  slider.dataset.radarV2Bound = '1';

  slider.addEventListener('pointerdown', () => {
    sliderScrubbing = true;
    stopPlayback();
  });
  slider.addEventListener('pointerup', () => { sliderScrubbing = false; });
  slider.addEventListener('pointercancel', () => {
    sliderScrubbing = false;
    clearRadarPreview({ restore:true });
  });
  slider.addEventListener('input', event => {
    if (!sliderScrubbing) return;
    event.stopImmediatePropagation();
    previewRadarIndex(event.currentTarget.value);
  }, { capture:true });
  slider.addEventListener('change', event => {
    if (sliderPreviewIndex === null) return;
    event.stopImmediatePropagation();
    sliderScrubbing = false;
    void setRadarIndex(event.currentTarget.value);
  }, { capture:true });
}

function ensureRadarUi() {
  if (controlsReady) return;
  controlsReady = true;
  ensureRadarStyles();
  ensureRadarQuickControls();
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
      const age = document.createElement('span');
      age.id = 'radar-age-label';
      age.className = 'radar-age-label';
      age.textContent = '最新 —';
      head.append(age);
      head.append(counter);
    }

    const control = timeline.querySelector('.timeline-control');
    if (control && !document.getElementById('radar-legend')) {
      const legend = document.createElement('div');
      legend.id = 'radar-legend';
      legend.className = 'radar-legend hidden';
      legend.innerHTML = '<span class="radar-legend-title">雷達回波</span><span>較弱</span><span class="radar-legend-scale" aria-hidden="true"></span><span>較強</span>';
      control.before(legend);
    }
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
      latest.addEventListener('click', () => void jumpToLatest());
      control.append(latest);
    }
    bindRadarSliderCommit();
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

  window.addEventListener('rain:map-mode-change', event => {
    const visible = event.detail?.mode === 'radar';
    syncRadarQuickControls(visible);
    if (!visible) clearRadarPreview();
  });
}

function ensureRadarStyles() {
  if (document.getElementById('radar-runtime-style')) return;
  const style = document.createElement('style');
  style.id = 'radar-runtime-style';
  style.textContent = `
    .radar-head-left{display:inline-flex;align-items:center;gap:7px;min-width:0}.radar-mode-chip{padding:2px 5px;border:1px solid #3d5664;color:#9bdcff;font-size:.66rem;line-height:1.2}.radar-mode-chip.test{border-color:#8b6b20;color:#ffd06a}.radar-age-label{margin-left:auto;color:#9a9a9a;font-size:.66rem;white-space:nowrap}.radar-frame-counter{color:#818181;font-size:.68rem}.radar-legend{display:flex;align-items:center;gap:6px;margin:7px 0 4px;color:#909090;font-size:.62rem}.radar-legend.hidden{display:none}.radar-legend-title{color:#bdbdbd;margin-right:2px}.radar-legend-scale{width:86px;height:5px;border-radius:2px;background:linear-gradient(90deg,#00b9df 0%,#00c96b 35%,#d6d600 60%,#f28b20 78%,#d73545 100%)}.radar-timeline-btn{flex:none;height:32px;min-width:36px;padding:0 8px;border:1px solid #4a4a4a;background:#0b0b0b;color:#ddd}.radar-latest-button{min-width:48px}.radar-timeline-btn:disabled{opacity:.4}.radar-timeline.frame-loading::after{content:'載入中';position:absolute;right:10px;top:-24px;padding:3px 6px;border:1px solid #3d3d3d;background:rgba(0,0,0,.88);color:#9ccce8;font-size:.68rem}.radar-timeline.is-loading{opacity:.82}.radar-timeline.is-preview #radar-timeline-time{color:#8fd9ff}.rain-radar-overlay{image-rendering:auto}
    .radar-quick-controls{position:absolute;z-index:1200;top:12px;right:12px;display:none;align-items:center;gap:4px;padding:5px;border:1px solid #3f464a;background:rgba(0,0,0,.9);box-shadow:0 3px 12px rgba(0,0,0,.4);backdrop-filter:blur(8px)}.radar-quick-controls.visible{display:flex}.radar-quick-controls button{min-height:34px;padding:0 9px;border:1px solid #3f464a;background:#090b0c;color:#c8d0d4;font-size:.68rem;white-space:nowrap}.radar-quick-controls button.active{border-color:#277ca6;background:#08202c;color:#f4fbff;box-shadow:inset 0 -2px 0 #22a7e0}.radar-quick-controls button:disabled{opacity:.38}.radar-quick-label{padding:0 3px;color:#7f8a90;font-size:.6rem}.radar-quick-divider{width:1px;height:22px;margin:0 2px;background:#30383c}
    @media(max-width:700px){.radar-timeline{left:8px!important;right:8px!important;bottom:calc(8px + var(--safe-bottom))!important;width:auto!important}.radar-timeline-btn{height:34px}.radar-head-left{gap:5px}.radar-mode-chip{font-size:.62rem}.radar-age-label{font-size:.6rem}.radar-legend{gap:5px;margin-top:6px}.radar-legend-scale{width:68px}.timeline-head{align-items:center}.timeline-control{gap:6px}.radar-quick-controls{top:8px;right:8px;max-width:calc(100% - 96px);overflow-x:auto;scrollbar-width:none;padding:3px;gap:3px}.radar-quick-controls::-webkit-scrollbar{display:none}.radar-quick-label{display:none}.radar-quick-controls button{min-height:31px;padding:0 7px;font-size:.64rem}.radar-quick-divider{height:19px}}
  `;
  document.head.append(style);
}
