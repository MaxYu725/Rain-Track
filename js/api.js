import { REQUEST_TIMEOUT_MS } from './config.js';
import { state } from './state.js';

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

export function fetchSwirlsPointSeries(point, options = {}) {
  return api(`/api/rain/swirls/point-series?lat=${encodeURIComponent(point.lat)}&lon=${encodeURIComponent(point.lon)}`, { timeoutMs:30_000, ...options });
}

export function fetchCapabilities(options = {}) { return api('/api/capabilities', options); }
export function fetchHealth(options = {}) { return api('/health', options); }
export function fetchRadarFrames(range, mode = 'live', height = 3, options = {}) {
  const normalizedMode = mode === 'test' ? 'test' : 'live';
  const normalizedHeight = Number(height) === 2 ? 2 : 3;
  return api(`/api/radar/frames?range=${encodeURIComponent(range)}&height=${normalizedHeight}&mode=${normalizedMode}`, options);
}
