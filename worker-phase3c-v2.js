import stableWorker from './worker.js';
import { createSwirlsPointRequestHandler, SwirlsPointRequestError } from './swirls-point-request.js';
import { createSwirlsPointSeriesRequestHandler } from './swirls-point-series-request.js';
import { createSwirlsPointSeriesBatchLoader } from './swirls-point-series-batch.js';
import { createSwirlsRuntime, SWIRLS_FETCH_POLICY } from './swirls-worker-runtime.js';

export const STABLE_WORKER_VERSION = '2.5.0';
const SWIRLS_PROBE_PATH = '/probe/swirls';
const SWIRLS_FRAME_PATH = '/api/rain/swirls/frame';
const POINT_PATH = '/api/rain/swirls/point';
const POINT_SERIES_PATH = '/api/rain/swirls/point-series';
const ACCEPT = 'text/plain,*/*';
const SWIRLS_PATHS = new Set([SWIRLS_PROBE_PATH, SWIRLS_FRAME_PATH, POINT_PATH, POINT_SERIES_PATH]);
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

const swirlsProbeHandler = async () => ({
  ...(await pointRuntime.probe({ frameIndex:0, includeLastFrame:true })),
  version:STABLE_WORKER_VERSION,
  workerVersion:STABLE_WORKER_VERSION
});

const swirlsFrameHandler = async url => {
  const rawFrame = url.searchParams.get('frame');
  if (!/^\d+$/.test(String(rawFrame || ''))) {
    throw new SwirlsPointRequestError('SWIRLS frame must be an integer from 0 to 15', 400);
  }
  const frameIndex = Number(rawFrame);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex > 15) {
    throw new SwirlsPointRequestError('SWIRLS frame must be an integer from 0 to 15', 400);
  }
  const frame = await pointRuntime.loadFrame(frameIndex);
  return {
    ok:true,
    version:STABLE_WORKER_VERSION,
    contractVersion:frame.contractVersion,
    frameIndex:frame.frameIndex,
    runTime:frame.runTime,
    validTime:frame.validTime,
    leadMinutes:frame.leadMinutes,
    windowStart:frame.windowStart,
    windowEnd:frame.windowEnd,
    unit:frame.unit,
    source:frame.source,
    sourceBytes:frame.sourceBytes,
    sourceUpdatedAt:frame.sourceUpdatedAt,
    cacheStatus:frame.cacheStatus,
    index:frame.index,
    grid:frame.grid,
    values:frame.values,
    validation:frame.validation
  };
};

const pointRequestHandler = createSwirlsPointRequestHandler({
  loadFrame: frameIndex => pointRuntime.loadFrame(frameIndex)
});

const pointSeriesRequestHandler = createSwirlsPointSeriesRequestHandler({
  loadFrames: pointSeriesBatchLoader,
  concurrency: 6
});

export function createPhase3Cv2Worker({
  baseWorker = stableWorker,
  handleProbe = swirlsProbeHandler,
  handleFrame = swirlsFrameHandler,
  handlePoint = pointRequestHandler,
  handlePointSeries = pointSeriesRequestHandler
} = {}) {
  if (!baseWorker || typeof baseWorker.fetch !== 'function') {
    throw new Error('Phase 3C v2 entry requires the Stable Recovery Worker');
  }
  if ([handleProbe, handleFrame, handlePoint, handlePointSeries].some(handler => typeof handler !== 'function')) {
    throw new Error('Phase 3C v2 entry requires SWIRLS handlers');
  }

  return {
    async fetch(request) {
      const url = new URL(request.url);

      // All SWIRLS forecast routes use the compact fast fetch runtime. Every
      // non-SWIRLS route remains delegated to Stable Recovery unchanged.
      if (request.method !== 'GET' || !SWIRLS_PATHS.has(url.pathname)) {
        return baseWorker.fetch(request);
      }

      try {
        const handler = url.pathname === SWIRLS_PROBE_PATH
          ? handleProbe
          : url.pathname === SWIRLS_FRAME_PATH
            ? handleFrame
            : url.pathname === POINT_SERIES_PATH
              ? handlePointSeries
              : handlePoint;
        const startedAt = Date.now();
        const payload = await handler(url);
        const cacheControl = url.pathname === SWIRLS_FRAME_PATH
          ? `public, max-age=${SWIRLS_FETCH_POLICY.mdlTtlSeconds}`
          : 'no-store';
        return json({
          ...payload,
          generatedAt: new Date().toISOString()
        }, 200, {
          'Cache-Control': cacheControl,
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
