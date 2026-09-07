import { DEFAULT_API_BASE, REQUEST_TIMEOUT_MS } from './config.js';
import { state } from './state.js';

const SWIRLS_SERIES_TRANSPORT_RETRY_DELAY_MS = 450;
const SWIRLS_SERIES_ATTEMPT_TIMEOUT_MS = 8_000;
const SWIRLS_SERIES_TRANSPORT_TAG = 'swirls-series';
let activeSeriesTransportController = null;

function linkedAbortController(externalSignal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener('abort', abort, { once:true });
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  return { controller, cleanup:() => { clearTimeout(timer); externalSignal?.removeEventListener('abort', abort); } };
}

function normalizeApiBase(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

async function apiFromBase(base, path, { signal, timeoutMs = REQUEST_TIMEOUT_MS, cache, transportTag } = {}) {
  const { controller, cleanup } = linkedAbortController(signal, timeoutMs);
  if (transportTag === SWIRLS_SERIES_TRANSPORT_TAG) activeSeriesTransportController = controller;
  try {
    const fetchOptions = {
      signal:controller.signal,
      headers:{ Accept:'application/json' }
    };
    if (cache) fetchOptions.cache = cache;

    const response = await fetch(normalizeApiBase(base) + path, fetchOptions);
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
    if (activeSeriesTransportController === controller) activeSeriesTransportController = null;
    cleanup();
  }
}

export async function api(path, options = {}) {
  const configuredBase = normalizeApiBase(state.apiBase);
  const canonicalBase = normalizeApiBase(DEFAULT_API_BASE);
  try {
    return await apiFromBase(configuredBase || canonicalBase, path, options);
  } catch (error) {
    if (!options.canonicalFallback || options.signal?.aborted || configuredBase === canonicalBase) throw error;
    return apiFromBase(canonicalBase, path, options);
  }
}

function isTransientTransportError(error) {
  if (!error || Number.isFinite(Number(error.status))) return false;
  if (error.name === 'AbortError') return false;
  if (error.name === 'TimeoutError' || error.name === 'TypeError' || error.name === 'NetworkError') return true;
  return /failed to fetch|network|連線逾時/i.test(String(error.message || error));
}

function waitForTransportRetry(signal, delayMs = SWIRLS_SERIES_TRANSPORT_RETRY_DELAY_MS) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once:true });
  });
}

function abortActiveSeriesTransport() {
  if (!activeSeriesTransportController || activeSeriesTransportController.signal.aborted) return;
  activeSeriesTransportController.abort(new DOMException('Rain Home refresh requested', 'TimeoutError'));
}

if (typeof window?.addEventListener === 'function') {
  window.addEventListener('rain:refresh', abortActiveSeriesTransport);
}

export function fetchPointForecast(point, radiusKm, options = {}) {
  return api(`/api/rain/point?lat=${encodeURIComponent(point.lat)}&lon=${encodeURIComponent(point.lon)}&radiusKm=${encodeURIComponent(radiusKm)}`, options);
}

export async function fetchSwirlsPointSeries(point, options = {}) {
  const path = `/api/rain/swirls/point-series?lat=${encodeURIComponent(point.lat)}&lon=${encodeURIComponent(point.lon)}`;
  const requestOptions = {
    timeoutMs:SWIRLS_SERIES_ATTEMPT_TIMEOUT_MS,
    transportTag:SWIRLS_SERIES_TRANSPORT_TAG,
    canonicalFallback:true,
    ...options
  };
  try {
    return await api(path, requestOptions);
  } catch (error) {
    if (!isTransientTransportError(error) || options.signal?.aborted) throw error;
    await waitForTransportRetry(options.signal);
    return await api(path, requestOptions);
  }
}

export function fetchCapabilities(options = {}) { return api('/api/capabilities', options); }
export function fetchHealth(options = {}) { return api('/health', options); }
export function fetchRadarFrames(range, mode = 'live', height = 3, options = {}) {
  const normalizedMode = mode === 'test' ? 'test' : 'live';
  const normalizedHeight = Number(height) === 2 ? 2 : 3;
  return api(`/api/radar/frames?range=${encodeURIComponent(range)}&height=${normalizedHeight}&mode=${normalizedMode}`, options);
}