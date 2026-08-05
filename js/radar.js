import { fetchRadarFrames } from './api.js';
import { RADAR_CONTRACT_VERSION } from './config.js';
import { state } from './state.js';
import { clamp, formatDateTime } from './utils.js';
import { setBadge, toast } from './ui.js';

export function updateRadarCapability(capabilities = {}, contract = null) {
  state.worker.capabilities.radarFrames = Boolean(capabilities.radarFrames);
  state.worker.radarContract = contract || capabilities.radar || null;
  const toggle = document.getElementById('toggle-radar');
  if (toggle) toggle.disabled = !state.worker.capabilities.radarFrames;
  const note = document.getElementById('radar-status-note');
  if (note) {
    note.textContent = state.worker.capabilities.radarFrames
      ? `Worker 已提供雷達幀；契約版本 ${state.worker.radarContract?.version || '不詳'}。`
      : `Foundation 已定義雷達 API 契約 v${RADAR_CONTRACT_VERSION}；目前 Worker 仍保持雷達關閉。`;
  }
  setBadge('radar', state.worker.capabilities.radarFrames ? 'empty' : 'disabled', 'RADAR');
}

export async function toggleRadar(enabled) {
  if (!enabled) { clearRadar(); return; }
  if (!state.worker.capabilities.radarFrames) {
    state.layers.radar = false;
    const toggle = document.getElementById('toggle-radar'); if (toggle) toggle.checked = false;
    toast('雷達基礎介面已準備，但目前 Worker 尚未啟用雷達資料');
    return;
  }
  state.layers.radar = true;
  await loadRadarFrames();
}

export async function loadRadarFrames() {
  setBadge('radar','loading','RADAR');
  try {
    const data = await fetchRadarFrames(state.radar.range);
    validateRadarResponse(data);
    state.radar.frames = data.frames;
    state.radar.index = Math.max(0, data.frames.length - 1);
    await showRadarFrame();
    configureTimeline();
    setBadge('radar','ok','RADAR');
  } catch (error) {
    clearRadar();
    setBadge('radar','error','RADAR');
    toast(`雷達載入失敗：${error.message}`);
  }
}

function validateRadarResponse(data) {
  if (!data || !Array.isArray(data.frames)) throw new Error('雷達回應缺少 frames 陣列');
  if (data.contractVersion && data.contractVersion !== RADAR_CONTRACT_VERSION) throw new Error(`不支援雷達契約版本 ${data.contractVersion}`);
  for (const frame of data.frames) {
    if (!frame?.time || !frame?.imageUrl || !frame?.bounds) throw new Error('雷達幀資料不完整');
    const { north, south, east, west } = frame.bounds;
    if (![north,south,east,west].every(Number.isFinite) || north <= south || east <= west) throw new Error('雷達幀邊界無效');
  }
  if (!data.frames.length) throw new Error('沒有可用雷達幀');
}

async function showRadarFrame() {
  const frame = state.radar.frames[state.radar.index];
  if (!frame || !window.L || !state.map) return;
  const url = /^https?:/i.test(frame.imageUrl) ? frame.imageUrl : state.apiBase + (frame.imageUrl.startsWith('/') ? '' : '/') + frame.imageUrl;
  const image = await preloadImage(url);
  if (!image) throw new Error('雷達影像載入失敗');
  const bounds = [[frame.bounds.south,frame.bounds.west],[frame.bounds.north,frame.bounds.east]];
  const next = window.L.imageOverlay(url, bounds, { opacity:state.radar.opacity, interactive:false }).addTo(state.map);
  if (state.radar.layer) state.map.removeLayer(state.radar.layer);
  state.radar.layer = next;
  document.getElementById('radar-timeline-time').textContent = formatDateTime(frame.time);
}

function configureTimeline() {
  const panel = document.getElementById('radar-timeline');
  const slider = document.getElementById('radar-slider');
  panel?.classList.toggle('hidden', !state.radar.frames.length);
  if (slider) { slider.max = Math.max(0, state.radar.frames.length - 1); slider.value = state.radar.index; }
}

export function setRadarIndex(value) {
  state.radar.index = clamp(Number(value) || 0, 0, Math.max(0, state.radar.frames.length - 1));
  showRadarFrame().catch(error => toast(error.message));
}

export function changeRadarRange(value) {
  state.radar.range = String(value) === '256' ? 256 : 64;
  if (state.layers.radar) loadRadarFrames();
}

export function setRadarOpacity(value) {
  state.radar.opacity = clamp(Number(value) / 100, 0, 1);
  const label = document.getElementById('radar-opacity-value');
  if (label) label.textContent = `${Math.round(state.radar.opacity * 100)}%`;
  state.radar.layer?.setOpacity(state.radar.opacity);
}

export function clearRadar() {
  state.layers.radar = false;
  if (state.radar.layer && state.map) { state.map.removeLayer(state.radar.layer); state.radar.layer = null; }
  document.getElementById('radar-timeline')?.classList.add('hidden');
  setBadge('radar', state.worker.capabilities.radarFrames ? 'empty' : 'disabled', 'RADAR');
}

function preloadImage(url) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}
