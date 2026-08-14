import { api } from './api.js';
import { state } from './state.js';
import { normalizeNowcastPayload } from './forecast-map-data.js';
import { assertSwirlsFrameCompatible, buildSwirlsForecast, normalizeSwirlsFramePayload } from './forecast-map-swirls.js';
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
let frameRequestSequence = 0;
let activeFrameController = null;

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

function frameSummary(frame, frameIndex) {
  if (!frame) return null;
  return {
    index:frameIndex,
    time:frame.time,
    leadMinutes:frame.leadMinutes,
    window:forecastWindow(frame),
    loaded:Array.isArray(frame.values),
    diagnostics:frame.diagnostics || null
  };
}

function selectedFrameSummary() {
  return frameSummary(forecast?.frames?.[index] || null, index);
}

function loadedFrameCount() {
  return (forecast?.frames || []).filter(frame => Array.isArray(frame?.values)).length;
}

export function getForecastMapFrameSummaries() {
  return (forecast?.frames || []).map((frame, frameIndex) => frameSummary(frame, frameIndex)).filter(Boolean);
}

export function getForecastMapRuntimeSnapshot() {
  return {
    ready:Boolean(forecast?.validation?.readyForOverlay),
    visible,
    source:forecast?.source || null,
    issueTime:forecast?.issueTime || null,
    unit:forecast?.unit || null,
    cadenceMinutes:forecast?.cadenceMinutes || null,
    accumulationMinutes:forecast?.accumulationMinutes || 30,
    fallbackReason:forecast?.fallbackReason || null,
    frameCount:forecast?.frames?.length || 0,
    loadedFrameCount:loadedFrameCount(),
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

function renderForecastMapFrame(frameIndex) {
  if (!state.map) throw new Error('Leaflet 地圖尚未初始化');
  index = normalizeIndex(frameIndex);
  const frame = forecast.frames[index];
  if (!Array.isArray(frame?.values)) throw new Error('這個 6 分鐘預報時段尚未下載');

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

export function showForecastMap(frameIndex = index) {
  return renderForecastMapFrame(frameIndex);
}

async function loadSwirlsForecast(requestId, controller, requestedOpacity) {
  const payload = await api('/api/rain/swirls/frame?frame=0', { signal:controller.signal });
  const firstFrame = normalizeSwirlsFramePayload(payload);
  if (requestId !== requestSequence) throw new DOMException('Forecast request superseded', 'AbortError');

  forecast = buildSwirlsForecast(firstFrame);
  opacity = normalizeOpacity(requestedOpacity);
  index = 0;
  return renderForecastMapFrame(0);
}

async function loadNowcastFallback(requestId, controller, requestedOpacity, swirlsError) {
  const payload = await api('/api/rain/nowcast', { signal:controller.signal });
  const normalized = normalizeNowcastPayload(payload);
  if (requestId !== requestSequence) throw new DOMException('Forecast request superseded', 'AbortError');

  forecast = {
    ...normalized,
    source:'nowcast-fallback',
    cadenceMinutes:30,
    accumulationMinutes:30,
    fallbackReason:swirlsError?.message || 'SWIRLS 暫不可用'
  };
  opacity = normalizeOpacity(requestedOpacity);
  index = 0;
  return renderForecastMapFrame(0);
}

export async function loadForecastMap({ frameIndex = 0, opacity:requestedOpacity = opacity } = {}) {
  const requestId = ++requestSequence;
  activeController?.abort();
  activeFrameController?.abort();
  activeFrameController = null;
  frameRequestSequence += 1;
  const controller = new AbortController();
  activeController = controller;

  try {
    let snapshot;
    try {
      snapshot = await loadSwirlsForecast(requestId, controller, requestedOpacity);
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted || requestId !== requestSequence) throw error;
      snapshot = await loadNowcastFallback(requestId, controller, requestedOpacity, error);
    }

    if (Number(frameIndex) !== 0) return await setForecastMapIndex(frameIndex);
    return snapshot;
  } finally {
    if (requestId === requestSequence) activeController = null;
  }
}

export async function setForecastMapIndex(frameIndex) {
  const targetIndex = normalizeIndex(frameIndex);
  const target = forecast.frames[targetIndex];
  if (Array.isArray(target?.values)) return renderForecastMapFrame(targetIndex);
  if (forecast?.source !== 'swirls') throw new Error('預報時段資料尚未載入');

  const requestId = ++frameRequestSequence;
  activeFrameController?.abort();
  const controller = new AbortController();
  activeFrameController = controller;

  try {
    const payload = await api(`/api/rain/swirls/frame?frame=${targetIndex}`, { signal:controller.signal });
    const frame = normalizeSwirlsFramePayload(payload);
    assertSwirlsFrameCompatible(forecast, frame);
    if (requestId !== frameRequestSequence) throw new DOMException('Forecast frame request superseded', 'AbortError');

    forecast.frames[targetIndex] = {
      ...target,
      values:frame.values,
      diagnostics:frame.diagnostics,
      loaded:true
    };
    return renderForecastMapFrame(targetIndex);
  } finally {
    if (requestId === frameRequestSequence) activeFrameController = null;
  }
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
  frameRequestSequence += 1;
  activeController?.abort();
  activeFrameController?.abort();
  activeController = null;
  activeFrameController = null;
  hideForecastMap();
  forecast = null;
  canvas = null;
  index = 0;
  lastRender = null;
  return getForecastMapRuntimeSnapshot();
}
