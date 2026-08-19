import stableWorker from './worker.js';
import { createSwirlsPointRequestHandler, SwirlsPointRequestError } from './swirls-point-request.js';
import { createSwirlsRuntime, SWIRLS_FETCH_POLICY } from './swirls-worker-runtime.js';

const POINT_PATH = '/api/rain/swirls/point';
const ACCEPT = 'text/plain,*/*';
const jsonHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json; charset=utf-8'
};

function createWorkerSwirlsFetchText({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');

  return async function fetchSwirlsText(url, options = {}) {
    const ttlSeconds = Math.max(1, Number(options.ttlSeconds) || SWIRLS_FETCH_POLICY.indexTtlSeconds);
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || SWIRLS_FETCH_POLICY.timeoutMs);
    const bypassCache = options.bypassCache === true;
    const cache = globalThis.caches?.default;
    const cacheKey = new Request(url, { headers: { Accept: ACCEPT } });

    // Reuse the exact URL + Accept cache key used by Stable Recovery worker.js.
    // Current point enhancement and the explicit 2-hour forecast therefore share
    // already-fetched SWIRLS index/MDL responses instead of creating snapshots.
    if (!bypassCache && cache) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const body = await cached.text();
        return {
          body,
          bytes: new TextEncoder().encode(body).byteLength,
          updatedAt: cached.headers.get('last-modified'),
          cacheStatus: 'worker-hit'
        };
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        cache: bypassCache ? 'no-store' : 'no-cache',
        headers: {
          Accept: ACCEPT,
          'Cache-Control': bypassCache ? 'no-cache, no-store, max-age=0' : 'no-cache',
          'User-Agent': 'Rain-Track-SWIRLS-Point/2.0'
        },
        signal: controller.signal,
        cf: bypassCache
          ? { cacheEverything: false, cacheTtl: 0 }
          : { cacheEverything: true, cacheTtl: ttlSeconds }
      });
      if (!response.ok) throw new Error(`SWIRLS upstream HTTP ${response.status}`);

      const body = await response.text();
      const updatedAt = response.headers.get('last-modified');
      const upstreamCacheStatus = response.headers.get('cf-cache-status') || null;

      if (!bypassCache && cache) {
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', `public, max-age=${ttlSeconds}`);
        await cache.put(cacheKey, new Response(body, { status: 200, headers }));
      }

      return {
        body,
        bytes: new TextEncoder().encode(body).byteLength,
        updatedAt,
        cacheStatus: upstreamCacheStatus || (bypassCache ? 'bypass' : 'worker-miss')
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

const pointRuntime = createSwirlsRuntime({
  fetchText: createWorkerSwirlsFetchText(),
  policy: SWIRLS_FETCH_POLICY
});

const pointRequestHandler = createSwirlsPointRequestHandler({
  loadFrame: frameIndex => pointRuntime.loadFrame(frameIndex)
});

export function createPhase3Cv2Worker({
  baseWorker = stableWorker,
  handlePoint = pointRequestHandler
} = {}) {
  if (!baseWorker || typeof baseWorker.fetch !== 'function') {
    throw new Error('Phase 3C v2 entry requires the Stable Recovery Worker');
  }
  if (typeof handlePoint !== 'function') {
    throw new Error('Phase 3C v2 entry requires a point handler');
  }

  return {
    async fetch(request) {
      const url = new URL(request.url);

      // Only the new compact GET route is intercepted. OPTIONS, non-GET
      // requests and every legacy route continue through Stable Recovery.
      if (request.method !== 'GET' || url.pathname !== POINT_PATH) {
        return baseWorker.fetch(request);
      }

      try {
        const payload = await handlePoint(url);
        return json({
          ...payload,
          generatedAt: new Date().toISOString()
        }, 200, { 'Cache-Control': 'no-store' });
      } catch (error) {
        if (error instanceof SwirlsPointRequestError) {
          return json({ ok: false, error: error.message }, error.status, { 'Cache-Control': 'no-store' });
        }
        return json({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }, 502, { 'Cache-Control': 'no-store' });
      }
    }
  };
}

function json(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...jsonHeaders, ...extraHeaders }
  });
}

export default createPhase3Cv2Worker();
