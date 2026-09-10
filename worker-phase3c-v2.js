import stableWorker from './worker.js';
import { createSwirlsPointRequestHandler, SwirlsPointRequestError } from './swirls-point-request.js';
import { createSwirlsPointSeriesRequestHandler } from './swirls-point-series-request.js';
import { createSwirlsPointSeriesBatchLoader } from './swirls-point-series-batch.js';
import { createSwirlsRuntime, SWIRLS_FETCH_POLICY } from './swirls-worker-runtime.js';

const POINT_PATH = '/api/rain/swirls/point';
const POINT_SERIES_PATH = '/api/rain/swirls/point-series';
const ACCEPT = 'text/plain,*/*';
const COMPACT_INDEX_CACHE_TTL_SECONDS = 30;
const COMPACT_MDL_CACHE_TTL_SECONDS = 300;
const jsonHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json; charset=utf-8'
};

export function createWorkerSwirlsFetchText({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');

  return async function fetchSwirlsText(url, options = {}) {
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || SWIRLS_FETCH_POLICY.timeoutMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
    const bypassCache = options.bypassCache === true;

    try {
      const requestOptions = {
        redirect: 'follow',
        headers: {
          Accept: ACCEPT,
          'User-Agent': 'Rain-Track-SWIRLS-Point/4.1'
        },
        signal: controller.signal
      };

      if (bypassCache) {
        requestOptions.cache = 'no-store';
      } else {
        // HKO MDL asset names change every 6-minute run and only repeat after
        // one hour. A five-minute edge TTL therefore cannot cross forecast
        // runs, while allowing every location request at the same edge to reuse
        // the exact same source bytes instead of downloading the same MDL again.
        requestOptions.cf = {
          cacheEverything:true,
          cacheTtl:options.kind === 'mdl'
            ? COMPACT_MDL_CACHE_TTL_SECONDS
            : COMPACT_INDEX_CACHE_TTL_SECONDS
        };
      }

      const response = await fetchImpl(url, requestOptions);
      if (!response.ok) throw new Error(`SWIRLS upstream HTTP ${response.status}`);

      const body = await response.text();
      return {
        body,
        bytes: new TextEncoder().encode(body).byteLength,
        updatedAt: response.headers.get('last-modified'),
        cacheStatus: response.headers.get('cf-cache-status') || (bypassCache ? 'BYPASS' : null)
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

async function loadCompactPoint(frameIndex, point) {
  const batch = await pointSeriesBatchLoader([frameIndex], { point });
  const sample = batch?.samples?.[0];
  if (sample) return sample;
  const failure = batch?.failures?.[0]?.error;
  throw new Error(failure || `SWIRLS compact point ${frameIndex} is unavailable`);
}

const pointRequestHandler = createSwirlsPointRequestHandler({
  loadPoint:loadCompactPoint
});

const pointSeriesRequestHandler = createSwirlsPointSeriesRequestHandler({
  loadFrames: pointSeriesBatchLoader
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

      if (request.method !== 'GET' || (url.pathname !== POINT_PATH && url.pathname !== POINT_SERIES_PATH)) {
        return baseWorker.fetch(request);
      }

      try {
        const handler = url.pathname === POINT_SERIES_PATH ? handlePointSeries : handlePoint;
        const payload = await handler(url);
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
