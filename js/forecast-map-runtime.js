import { api } from './api.js';
import { state } from './state.js';
import { normalizeNowcastPayload } from './forecast-map-data.js';
import { renderForecastFrameToCanvas } from './forecast-map-browser-canvas.js';
import { forecastWindow } from './forecast-map-renderer.js';
import { removeForecastOverlay, setForecastOverlayOpacity, upsertForecastOverlay } from './forecast-map-leaflet.js';

const DEFAULT_OPACITY = 0.72;

let forecast = null;
let canvas = null;
let layer = null;
let index = 0;
let opacity = DEFAULT_OPACITY;
let visible = false;
let lastRender = null;
let requestSequence = 0;
let activeController = null;

function normalizeOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_OPACITY;
  return Math.max(0, Math.min(1, number));
}

function normalizeIndex(value) {
  if (!forecast?.frames?.length) throw new Error('尚未載入兩小時預報地圖');
  const requested = Math.round(Number(value));
  if (!Number.isFinite(requested)) return index;
  return Math.max(0, Math.min(forecast.frames.length - 1, requested));
}

function ensureCanvas() {
  if (canvas) return canvas;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error('瀏覽器 Canvas API 不可用');
  }
  canvas = document.createElement('canvas');
  return canvas;
}

function selectedFrameSummary() {
  const frame = forecast?.frames?.[index] || null;
  const window = frame ? forecastWindow(frame) : null;
  return frame ? {
    index,
    time:frame.time,
    leadMinutes:frame.leadMinutes,
    window,
    diagnostics:frame.diagnostics || null
  } : null;
}

export function getForecastMapRuntimeSnapshot() {
  return {
    ready:Boolean(forecast?.validation?.readyForOverlay),
    visible,
    issueTime:forecast?.issueTime || null,
    unit:forecast?.unit || null,
    frameCount:forecast?.frames?.length || 0,
    index,
    opacity,
    selectedFrame:selectedFrameSummary(),
    grid:forecast?.grid ? {
      rows:forecast.grid.rows,
      cols:forecast.grid.cols,
      bounds:forecast.grid.bounds,
      orientation:forecast.grid.orientation
    } : null,
    lastRender
  };
}

export function showForecastMap(frameIndex = index) {
  if (!state.map) throw new Error('Leaflet 地圖尚未初始化');
  index = normalizeIndex(frameIndex);
  const frame = forecast.frames[index];
  const targetCanvas = ensureCanvas();
  const rendered = renderForecastFrameToCanvas(targetCanvas, frame, forecast.grid);
  layer = upsertForecastOverlay({
    map:state.map,
    layer,
    canvas:targetCanvas,
    grid:forecast.grid,
    opacity
  });
  visible = true;
  lastRender = {
    width:rendered.width,
    height:rendered.height,
    wetCellCount:rendered.wetCellCount,
    dryCellCount:rendered.dryCellCount,
    maxMm:rendered.maxMm
  };
  return getForecastMapRuntimeSnapshot();
}

export async function loadForecastMap({ frameIndex = 0, opacity:requestedOpacity = opacity } = {}) {
  const requestId = ++requestSequence;
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;

  try {
    const payload = await api('/api/rain/nowcast', { signal:controller.signal });
    const normalized = normalizeNowcastPayload(payload);
    if (requestId !== requestSequence) throw new DOMException('Forecast request superseded', 'AbortError');

    forecast = normalized;
    opacity = normalizeOpacity(requestedOpacity);
    index = 0;
    return showForecastMap(frameIndex);
  } finally {
    if (requestId === requestSequence) activeController = null;
  }
}

export function setForecastMapIndex(frameIndex) {
  return showForecastMap(frameIndex);
}

export function setForecastMapOpacity(value) {
  opacity = normalizeOpacity(value);
  if (layer) setForecastOverlayOpacity(layer, opacity);
  return getForecastMapRuntimeSnapshot();
}

export function hideForecastMap() {
  if (state.map && layer) removeForecastOverlay(state.map, layer);
  layer = null;
  visible = false;
  return getForecastMapRuntimeSnapshot();
}

export function clearForecastMap() {
  requestSequence += 1;
  activeController?.abort();
  activeController = null;
  hideForecastMap();
  forecast = null;
  canvas = null;
  index = 0;
  lastRender = null;
  return getForecastMapRuntimeSnapshot();
}
