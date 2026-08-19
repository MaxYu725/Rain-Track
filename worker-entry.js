import legacyWorker from './worker.js';
import {
  SWIRLS_RAW_CONTRACT,
  bindSwirlsMdlFrame,
  parseSwirlsIndex,
} from './swirls-data.js';
import { SWIRLS_FETCH_POLICY } from './swirls-worker-runtime.js';
import { loadSwirlsPointSeries } from './swirls-point-series.js';

const VERSION = '2.6.1';
const POINT_SERIES_CACHE_SECONDS = 120;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const jsonHeaders = {
  ...corsHeaders,
  'Content-Type': 'application/json; charset=utf-8',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && url.pathname === '/api/rain/swirls/point-series') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (url.pathname !== '/api/rain/swirls/point-series') {
      return legacyWorker.fetch(request, env, ctx);
    }
    if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
    return handleSwirlsPointSeries(request, url, ctx);
  },
};

async function handleSwirlsPointSeries(request, url, ctx) {
  const latitude = finiteNumber(url.searchParams.get('lat'));
  const longitude = finiteNumber(url.searchParams.get('lon'));
  if (latitude === null || longitude === null) {
    return json({ ok: false, version: VERSION, error: 'Missing or invalid lat/lon' }, 400, {
      'Cache-Control': 'no-store',
    });
  }
  const coverage = SWIRLS_RAW_CONTRACT.coverage;
  if (
    latitude < coverage.minLat || latitude > coverage.maxLat ||
    longitude < coverage.minLon || longitude > coverage.maxLon
  ) {
    return json({
      ok: false,
      version: VERSION,
      error: 'Coordinates are outside the SWIRLS coverage',
      coverage,
    }, 422, { 'Cache-Control': 'no-store' });
  }

  const cache = caches.default;
  const cacheKey = new Request(normalizedPointSeriesCacheUrl(request.url, latitude, longitude), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    // A compact request gets its own runtime so all 16 frame loads share one
    // parsed index. Source responses rely on Cloudflare fetch caching rather
    // than an additional Cache API match/put for every MDL. This keeps a cold
    // request comfortably below the Worker subrequest limit.
    const series = await loadSwirlsPointSeries({
      runtime: createCompactPointSeriesRuntime(),
      latitude,
      longitude,
      maxConcurrent: 4,
    });
    const response = json({
      ok: true,
      version: VERSION,
      source: 'Hong Kong Observatory SWIRLS gridded rainfall forecast',
      generatedAt: new Date().toISOString(),
      ...series,
    }, 200, {
      'Cache-Control': `public, max-age=${POINT_SERIES_CACHE_SECONDS}`,
    });
    const cacheable = response.clone();
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(cache.put(cacheKey, cacheable));
    else await cache.put(cacheKey, cacheable);
    return response;
  } catch (error) {
    return json({
      ok: false,
      version: VERSION,
      error: safeError(error),
    }, 502, { 'Cache-Control': 'no-store' });
  }
}

function createCompactPointSeriesRuntime() {
  let normalIndexPromise = null;
  let bypassIndexPromise = null;

  async function loadIndex(bypassCache) {
    const existing = bypassCache ? bypassIndexPromise : normalIndexPromise;
    if (existing) return existing;

    const pending = loadCompactIndex({ bypassCache });
    if (bypassCache) bypassIndexPromise = pending;
    else normalIndexPromise = pending;
    return pending;
  }

  return Object.freeze({
    async loadFrame(frameIndex, { bypassCache = false } = {}) {
      const indexData = await loadIndex(bypassCache);
      const descriptor = indexData.frames.find(frame => frame.frameIndex === Number(frameIndex));
      if (!descriptor) throw new Error(`SWIRLS frame ${frameIndex} is not present in the current index`);

      const text = await fetchCompactSwirlsText(descriptor.mdlUrl, {
        ttlSeconds: SWIRLS_FETCH_POLICY.mdlTtlSeconds,
        timeoutMs: SWIRLS_FETCH_POLICY.timeoutMs,
        bypassCache,
      });
      const frame = bindSwirlsMdlFrame(indexData, frameIndex, text.body);
      return {
        ...frame,
        sourceBytes: text.bytes,
        sourceUpdatedAt: text.updatedAt,
        cacheStatus: text.cacheStatus,
      };
    },
  });
}

async function loadCompactIndex({ bypassCache = false } = {}) {
  const text = await fetchCompactSwirlsText(SWIRLS_RAW_CONTRACT.indexUrl, {
    ttlSeconds: SWIRLS_FETCH_POLICY.indexTtlSeconds,
    timeoutMs: SWIRLS_FETCH_POLICY.timeoutMs,
    bypassCache,
  });
  const parsed = parseSwirlsIndex(text.body);
  return {
    ...parsed,
    sourceBytes: text.bytes,
    sourceUpdatedAt: text.updatedAt,
    cacheStatus: text.cacheStatus,
  };
}

async function fetchCompactSwirlsText(url, options = {}) {
  const ttlSeconds = Math.max(1, Number(options.ttlSeconds) || SWIRLS_FETCH_POLICY.indexTtlSeconds);
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || SWIRLS_FETCH_POLICY.timeoutMs);
  const bypassCache = options.bypassCache === true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    const upstream = await fetch(url, {
      redirect: 'follow',
      cache: bypassCache ? 'no-store' : 'no-cache',
      headers: {
        Accept: 'text/plain,*/*',
        'Cache-Control': bypassCache ? 'no-cache, no-store, max-age=0' : 'no-cache',
        'User-Agent': 'Weather-Metro-SWIRLS-Point-Series/1.1',
      },
      cf: bypassCache
        ? { cacheEverything: false, cacheTtl: 0 }
        : { cacheEverything: true, cacheTtl: ttlSeconds },
      signal: controller.signal,
    });
    if (!upstream.ok) throw new Error(`SWIRLS upstream HTTP ${upstream.status}`);
    const body = await upstream.text();
    return {
      body,
      bytes: new TextEncoder().encode(body).byteLength,
      updatedAt: upstream.headers.get('last-modified'),
      cacheStatus: upstream.headers.get('cf-cache-status') || (bypassCache ? 'bypass' : 'edge-fetch'),
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizedPointSeriesCacheUrl(rawUrl, latitude, longitude) {
  const url = new URL(rawUrl);
  url.search = '';
  url.searchParams.set('lat', Number(latitude).toFixed(5));
  url.searchParams.set('lon', Number(longitude).toFixed(5));
  url.searchParams.set('v', VERSION);
  return url.toString();
}

function finiteNumber(value) {
  if (value === null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...jsonHeaders, ...extraHeaders },
  });
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}
