import stableWorker from './worker.js';
import { createSwirlsPointRequestHandler, SwirlsPointRequestError } from './swirls-point-request.js';
import { createSwirlsPointSeriesRequestHandler } from './swirls-point-series-request.js';
import { createSwirlsPointSeriesBatchLoader } from './swirls-point-series-batch.js';
import { createSwirlsRuntime, SWIRLS_FETCH_POLICY } from './swirls-worker-runtime.js';

const POINT_PATH = '/api/rain/swirls/point';
const POINT_SERIES_PATH = '/api/rain/swirls/point-series';
const ACCEPT = 'text/plain,*/*';
const jsonHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json; charset=utf-8'
};

export function createWorkerSwirlsFetchText({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');

  return async function fetchSwirlsText(url, options = {}) {
    const ttlSeconds = Math.max(1, Number(options.ttlSeconds) || SWIRLS_FETCH_POLICY.indexTtlSeconds);
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || SWIRLS_FETCH_POLICY.timeoutMs);
    const bypassCache = options.bypassCache === true;

    // SWIRLS files come from an origin, so use Workers fetch caching directly.
    // Do not add a second Cache API match/put layer: it adds two more
    // subrequests per asset and makes cache writes part of user-visible latency.
    // For normal reads, avoid `cache: no-cache` / `Cache-Control: no-cache` as
    // those force revalidation with HKO and defeat the short edge TTL below.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        ...(bypassCache ? { cache:'no-store' } : {}),
        headers: bypassCache
          ? {
              Accept: ACCEPT,
              'Cache-Control': 'no-cache, no-store, max-age=0',
              'User-Agent': 'Rain-Track-SWIRLS-Point/2.2'
            }
          : {
              Accept: ACCEPT,
              'User-Agent': 'Rain-Track-SWIRLS-Point/2.2'
            },
        signal: controller.signal,
        cf: bypassCache
          ? { cacheEverything:false, cacheTtl:0 }
          : { cacheEverything:true, cacheTtl:ttlSeconds }
      });
      if (!response.ok) throw new Error(`SWIRLS upstream HTTP ${response.status}`);

      const body = await response.text();
      return {
        body,
        bytes: new TextEncoder().encode(body).byteLength,
        updatedAt: response.headers.get('last-modified'),
        cacheStatus: response.headers.get('cf-cache-status') || (bypassCache ? 'bypass' : 'fetch-cache')
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

const pointFetchText = createWorkerSwirlsFetchText();
const pointRuntime = createSwirlsRuntime({
  fetchText: pointFetchText,
  policy: SWIRLS_FETCH_POLICY
});
const pointSeriesBatchLoader = createSwirlsPointSeriesBatchLoader({
  loadIndex: options => pointRuntime.loadIndex(options),
  fetchText: pointFetchText,
  policy: SWIRLS_FETCH_POLICY
});

const pointRequestHandler = createSwirlsPointRequestHandler({
  loadFrame: frameIndex => pointRuntime.loadFrame(frameIndex)
});

const pointSeriesRequestHandler = createSwirlsPointSeriesRequestHandler({
  loadFrames: pointSeriesBatchLoader,
  concurrency: 6
});

export function createPhase3Cv2Worker({
  baseWorker = stableWorker,
  handlePoint = pointRequestHandler,
  handlePointSeries = pointSeriesRequestHandler
} = {}) {
  if (!baseWorker || typeof baseWorker.fetch !== 'function') {
    throw new Error('Phase 3C v2 entry requires the Stable Recovery Worker');
  }
  if (typeof handlePoint !== 'function' || typeof handlePointSeries !== 'function') {
    throw new Error('Phase 3C v2 entry requires point handlers');
  }

  return {
    async fetch(request) {
      const url = new URL(request.url);

      // Only compact SWIRLS point routes are intercepted. OPTIONS, non-GET
      // requests and every legacy route continue through Stable Recovery.
      if (request.method !== 'GET' || (url.pathname !== POINT_PATH && url.pathname !== POINT_SERIES_PATH)) {
        return baseWorker.fetch(request);
      }

      try {
        const handler = url.pathname === POINT_SERIES_PATH ? handlePointSeries : handlePoint;
        const startedAt = Date.now();
        const payload = await handler(url);
        return json({
          ...payload,
          generatedAt: new Date().toISOString()
        }, 200, {
          'Cache-Control': 'no-store',
          'Server-Timing': `swirls;dur=${Math.max(0, Date.now() - startedAt)}`
        });
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
