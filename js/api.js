import { DEFAULT_API_BASE, REQUEST_TIMEOUT_MS } from './config.js';
import { state } from './state.js';

const SWIRLS_SERIES_TRANSPORT_RETRY_DELAY_MS = 450;
const SWIRLS_SERIES_ATTEMPT_TIMEOUT_MS = 8_000;

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

async function apiFromBase(base, path, { signal, timeoutMs = REQUEST_TIMEOUT_MS, cache } = {}) {
  const { controller, cleanup } = linkedAbortController(signal, timeoutMs);
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
    cleanup();
  }
}

export function api(path, options = {}) {
  return apiFromBase(state.apiBase, path, options);
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

async function fetchSeriesFromBase(base, path, requestOptions, signal) {
  try {
    return await apiFromBase(base, path, requestOptions);
  } catch (error) {
    if (!isTransientTransportError(error) || signal?.aborted) throw error;
    await waitForTransportRetry(signal);
    return await apiFromBase(base, path, requestOptions);
  }
}

export function fetchPointForecast(point, radiusKm, options = {}) {
  return api(`/api/rain/point?lat=${encodeURIComponent(point.lat)}&lon=${encodeURIComponent(point.lon)}&radiusKm=${encodeURIComponent(radiusKm)}`, options);
}

export async function fetchSwirlsPointSeries(point, options = {}) {
  const path = `/api/rain/swirls/point-series?lat=${encodeURIComponent(point.lat)}&lon=${encodeURIComponent(point.lon)}`;
  const requestOptions = { timeoutMs:SWIRLS_SERIES_ATTEMPT_TIMEOUT_MS, ...options };
  const configuredBase = normalizeApiBase(state.apiBase);
  const canonicalBase = normalizeApiBase(DEFAULT_API_BASE);
  const bases = configuredBase && configuredBase !== canonicalBase
    ? [configuredBase, canonicalBase]
    : [canonicalBase];

  let lastError = null;
  for (const base of bases) {
    try {
      return await fetchSeriesFromBase(base, path, requestOptions, options.signal);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError || new Error('兩小時 SWIRLS 定位序列讀取失敗');
}

export function fetchCapabilities(options = {}) { return api('/api/capabilities', options); }
export function fetchHealth(options = {}) { return api('/health', options); }
export function fetchRadarFrames(range, mode = 'live', height = 3, options = {}) {
  const normalizedMode = mode === 'test' ? 'test' : 'live';
  const normalizedHeight = Number(height) === 2 ? 2 : 3;
  return api(`/api/radar/frames?range=${encodeURIComponent(range)}&height=${normalizedHeight}&mode=${normalizedMode}`, options);
}