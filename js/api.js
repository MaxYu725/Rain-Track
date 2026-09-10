import { REQUEST_TIMEOUT_MS } from './config.js';
import { state } from './state.js';

const SWIRLS_FRAME_COUNT = 16;
const SWIRLS_FIRST_LEAD_MINUTES = 30;
const SWIRLS_CADENCE_MINUTES = 6;
const SWIRLS_LAST_LEAD_MINUTES = 120;
const SWIRLS_PROGRESS_CACHE_MS = 4 * 60 * 1000;
const swirlsProgressLoads = new Map();

function linkedAbortController(externalSignal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener('abort', abort, { once:true });
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  return { controller, cleanup:() => { clearTimeout(timer); externalSignal?.removeEventListener('abort', abort); } };
}

export async function api(path, { signal, timeoutMs = REQUEST_TIMEOUT_MS, cache } = {}) {
  const { controller, cleanup } = linkedAbortController(signal, timeoutMs);
  try {
    const fetchOptions = {
      signal:controller.signal,
      headers:{ Accept:'application/json' }
    };
    if (cache) fetchOptions.cache = cache;

    const response = await fetch(state.apiBase + path, fetchOptions);
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(data?.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      const timeoutError = new Error('連線逾時，請稍後再試');
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  } finally {
    cleanup();
  }
}

export function fetchPointForecast(point, radiusKm, options = {}) {
  return api(`/api/rain/point?lat=${encodeURIComponent(point.lat)}&lon=${encodeURIComponent(point.lon)}&radiusKm=${encodeURIComponent(radiusKm)}`, options);
}

function swirlsProgressKey(point) {
  return `${state.apiBase}|${Number(point?.lat).toFixed(4)}|${Number(point?.lon).toFixed(4)}`;
}

function swirlsPointPath(point, frameIndex) {
  return `/api/rain/swirls/point?frame=${frameIndex}&lat=${encodeURIComponent(point.lat)}&lon=${encodeURIComponent(point.lon)}`;
}

function pruneSwirlsProgressLoads() {
  const now = Date.now();
  for (const [key, load] of swirlsProgressLoads) {
    if (now - load.startedAt > SWIRLS_PROGRESS_CACHE_MS * 2) swirlsProgressLoads.delete(key);
  }
  while (swirlsProgressLoads.size > 8) swirlsProgressLoads.delete(swirlsProgressLoads.keys().next().value);
}

function startSwirlsProgressLoad(point) {
  pruneSwirlsProgressLoads();
  let resolveFirst;
  let rejectFirst;
  const firstReady = new Promise((resolve, reject) => {
    resolveFirst = resolve;
    rejectFirst = reject;
  });
  const load = {
    key:swirlsProgressKey(point),
    point:{ lat:Number(point.lat), lon:Number(point.lon) },
    startedAt:Date.now(),
    runTime:null,
    points:new Map(),
    failures:new Map(),
    settledCount:0,
    settled:false,
    firstReady,
    firstResolved:false,
    initialReturned:false,
    lastDeliveredCount:0,
    refreshScheduled:false,
    resolveFirst,
    rejectFirst
  };
  swirlsProgressLoads.set(load.key, load);

  for (let frameIndex = 0; frameIndex < SWIRLS_FRAME_COUNT; frameIndex += 1) {
    void api(swirlsPointPath(load.point, frameIndex))
      .then(sample => ingestSwirlsPoint(load, frameIndex, sample))
      .catch(error => {
        load.failures.set(frameIndex, error instanceof Error ? error.message : String(error));
      })
      .finally(() => settleSwirlsPoint(load));
  }
  return load;
}

function ingestSwirlsPoint(load, frameIndex, sample) {
  if (sample?.ok !== true || Number(sample.frameIndex) !== frameIndex || !Number.isFinite(Number(sample.amountMm))) {
    load.failures.set(frameIndex, 'invalid SWIRLS point response');
    return;
  }
  const runTime = sample.runTime && Number.isFinite(Date.parse(sample.runTime)) ? sample.runTime : null;
  if (!runTime) {
    load.failures.set(frameIndex, 'SWIRLS point response has no run time');
    return;
  }
  if (!load.runTime) load.runTime = runTime;
  if (load.runTime !== runTime) {
    load.failures.set(frameIndex, 'SWIRLS point response crossed forecast runs');
    return;
  }

  load.points.set(frameIndex, sample);
  load.failures.delete(frameIndex);
  if (!load.firstResolved) {
    load.firstResolved = true;
    load.resolveFirst();
  }
  if (load.initialReturned && load.points.size > load.lastDeliveredCount) scheduleSwirlsProgressRefresh(load);
}

function settleSwirlsPoint(load) {
  load.settledCount += 1;
  if (load.settledCount < SWIRLS_FRAME_COUNT) return;
  load.settled = true;
  if (!load.firstResolved) {
    load.rejectFirst(new Error('SWIRLS 定位序列沒有返回可用時段'));
    return;
  }
  if (load.initialReturned) scheduleSwirlsProgressRefresh(load);
}

function scheduleSwirlsProgressRefresh(load) {
  if (load.refreshScheduled) return;
  load.refreshScheduled = true;
  setTimeout(() => {
    load.refreshScheduled = false;
    if (swirlsProgressLoads.get(load.key) !== load) return;
    if (swirlsProgressKey(state.selected) !== load.key) return;
    if (load.points.size <= load.lastDeliveredCount && !load.settled) return;
    window.dispatchEvent(new CustomEvent('rain:refresh'));
  }, 0);
}

function waitForFirstSwirlsPoint(load, signal) {
  if (!signal) return load.firstReady;
  if (signal.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once:true });
    load.firstReady.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); }
    );
  });
}

function buildSwirlsProgressSnapshot(load) {
  const samples = [...load.points.values()].sort((a, b) => Number(a.frameIndex) - Number(b.frameIndex));
  if (!samples.length || !load.runTime) throw new Error('SWIRLS 定位序列沒有可用資料');
  const first = samples[0];
  const missingFrames = Array.from({ length:SWIRLS_FRAME_COUNT }, (_, frameIndex) => frameIndex)
    .filter(frameIndex => !load.points.has(frameIndex));
  return {
    ok:true,
    complete:load.settled && missingFrames.length === 0,
    contractVersion:first.contractVersion || '1.0',
    source:'HKO SWIRLS progressive point series',
    runTime:load.runTime,
    cadenceMinutes:Number(first.cadenceMinutes) || SWIRLS_CADENCE_MINUTES,
    accumulationMinutes:Number(first.accumulationMinutes) || 30,
    firstLeadMinutes:SWIRLS_FIRST_LEAD_MINUTES,
    lastLeadMinutes:SWIRLS_LAST_LEAD_MINUTES,
    unit:first.unit || 'mm / 30 min',
    location:{ ...load.point },
    interpolation:first.interpolation || 'bilinear-grid-centres',
    points:samples.map(sample => ({
      frameIndex:Number(sample.frameIndex),
      validTime:sample.validTime,
      leadMinutes:Number(sample.leadMinutes),
      windowStart:sample.windowStart,
      windowEnd:sample.windowEnd,
      amountMm:Number(sample.amountMm),
      clampedToGridCentreBoundary:Boolean(sample.clampedToGridCentreBoundary)
    })),
    missingFrames
  };
}

export async function fetchSwirlsPointSeries(point, options = {}) {
  // Rain Home must never wait behind one all-or-nothing 16-frame barrier.
  // Start the 16 independent compact point reads together, return as soon as
  // the first valid frame arrives, then refresh the same view as later frames
  // settle. A single stuck frame can therefore create a gap, not a stuck Home.
  const key = swirlsProgressKey(point);
  let load = swirlsProgressLoads.get(key);
  if (!load || Date.now() - load.startedAt > SWIRLS_PROGRESS_CACHE_MS) {
    load = startSwirlsProgressLoad(point);
  }

  if (!load.points.size) await waitForFirstSwirlsPoint(load, options.signal);
  const snapshot = buildSwirlsProgressSnapshot(load);
  load.initialReturned = true;
  load.lastDeliveredCount = load.points.size;
  return snapshot;
}

export function fetchCapabilities(options = {}) { return api('/api/capabilities', options); }
export function fetchHealth(options = {}) { return api('/health', options); }
export function fetchRadarFrames(range, mode = 'live', height = 3, options = {}) {
  const normalizedMode = mode === 'test' ? 'test' : 'live';
  const normalizedHeight = Number(height) === 2 ? 2 : 3;
  return api(`/api/radar/frames?range=${encodeURIComponent(range)}&height=${normalizedHeight}&mode=${normalizedMode}`, options);
}
