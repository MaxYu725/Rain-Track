import legacyWorker from './worker.js';
import {
  SWIRLS_RAW_CONTRACT,
  bindSwirlsMdlFrame,
  parseSwirlsIndex,
} from './swirls-data.js';
import { SWIRLS_FETCH_POLICY } from './swirls-worker-runtime.js';
import {
  SWIRLS_SNAPSHOT_KEY,
  SWIRLS_SNAPSHOT_STATUS_KEY,
  buildCompleteSwirlsSnapshot,
  buildPointSeriesFromSnapshot,
  snapshotIsFresh,
  snapshotMetadata,
} from './swirls-snapshot.js';

const VERSION = '2.7.0';
const POINT_SERIES_CACHE_SECONDS = 120;
const BACKGROUND_REFRESH_COOLDOWN_MS = 90_000;
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

let snapshotBuildPromise = null;
let lastBackgroundRefreshStartedAt = 0;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && (
      url.pathname === '/api/rain/swirls/point-series' ||
      url.pathname === '/probe/swirls-snapshot'
    )) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === '/api/rain/swirls/point-series') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
      return handleSwirlsPointSeries(url, env, ctx);
    }

    if (url.pathname === '/probe/swirls-snapshot') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
      return handleSnapshotProbe(env, ctx);
    }

    return legacyWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (!env?.SWIRLS_SNAPSHOTS) return;
    ctx.waitUntil(
      refreshCompleteSnapshot(env, `cron:${controller?.cron || 'scheduled'}`)
        .catch(error => console.error('SWIRLS snapshot refresh failed', safeError(error))),
    );
  },
};

async function handleSwirlsPointSeries(url, env, ctx) {
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

  const snapshot = await readSnapshot(env);
  if (!snapshot || !snapshotIsFresh(snapshot)) {
    triggerBackgroundSnapshotRefresh(env, ctx, snapshot ? 'stale-request' : 'cold-request');
    return json({
      ok: false,
      version: VERSION,
      error: snapshot ? 'Fine SWIRLS snapshot is stale' : 'Fine SWIRLS snapshot is not ready',
      fallbackEndpoint: '/api/rain/point',
      snapshot: snapshotMetadata(snapshot),
    }, 503, {
      'Cache-Control': 'no-store',
      'Retry-After': '60',
    });
  }

  try {
    const series = buildPointSeriesFromSnapshot(snapshot, latitude, longitude);
    return json({
      ok: true,
      version: VERSION,
      source: 'Hong Kong Observatory SWIRLS prebuilt gridded rainfall snapshot',
      generatedAt: new Date().toISOString(),
      snapshot: snapshotMetadata(snapshot),
      ...series,
    }, 200, {
      'Cache-Control': `public, max-age=${POINT_SERIES_CACHE_SECONDS}`,
    });
  } catch (error) {
    triggerBackgroundSnapshotRefresh(env, ctx, 'invalid-snapshot');
    return json({
      ok: false,
      version: VERSION,
      error: safeError(error),
      fallbackEndpoint: '/api/rain/point',
    }, 503, { 'Cache-Control': 'no-store', 'Retry-After': '60' });
  }
}

async function handleSnapshotProbe(env, ctx) {
  const snapshot = await readSnapshot(env);
  const status = await readKvJson(env?.SWIRLS_SNAPSHOTS, SWIRLS_SNAPSHOT_STATUS_KEY);
  const fresh = snapshotIsFresh(snapshot);
  if (!fresh) triggerBackgroundSnapshotRefresh(env, ctx, snapshot ? 'probe-stale' : 'probe-cold');
  return json({
    ok: Boolean(snapshot) && fresh,
    version: VERSION,
    bindingReady: Boolean(env?.SWIRLS_SNAPSHOTS),
    snapshot: snapshotMetadata(snapshot),
    refresh: status || null,
  }, fresh ? 200 : 503, { 'Cache-Control': 'no-store' });
}

function triggerBackgroundSnapshotRefresh(env, ctx, reason) {
  if (!env?.SWIRLS_SNAPSHOTS || !ctx || typeof ctx.waitUntil !== 'function') return;
  const now = Date.now();
  if (snapshotBuildPromise || now - lastBackgroundRefreshStartedAt < BACKGROUND_REFRESH_COOLDOWN_MS) return;
  lastBackgroundRefreshStartedAt = now;
  ctx.waitUntil(
    refreshCompleteSnapshot(env, reason)
      .catch(error => console.error('SWIRLS snapshot background refresh failed', safeError(error))),
  );
}

async function refreshCompleteSnapshot(env, reason) {
  if (!env?.SWIRLS_SNAPSHOTS) throw new Error('SWIRLS snapshot KV binding is unavailable');
  if (snapshotBuildPromise) return snapshotBuildPromise;

  snapshotBuildPromise = (async () => {
    const startedAt = new Date().toISOString();
    await writeSnapshotStatus(env, {
      state: 'building',
      reason,
      startedAt,
      version: VERSION,
    });

    try {
      const snapshot = await buildCompleteSwirlsSnapshot({
        runtime: createSnapshotRuntime(),
        maxConcurrent: 3,
      });
      const serialized = JSON.stringify(snapshot);
      const bytes = new TextEncoder().encode(serialized).byteLength;
      await env.SWIRLS_SNAPSHOTS.put(SWIRLS_SNAPSHOT_KEY, serialized);
      await writeSnapshotStatus(env, {
        state: 'ready',
        reason,
        startedAt,
        completedAt: new Date().toISOString(),
        runTime: snapshot.runTime,
        builtAt: snapshot.builtAt,
        frameCount: snapshot.frames.length,
        snapshotBytes: bytes,
        version: VERSION,
      });
      return snapshot;
    } catch (error) {
      await writeSnapshotStatus(env, {
        state: 'error',
        reason,
        startedAt,
        completedAt: new Date().toISOString(),
        error: safeError(error),
        version: VERSION,
      });
      throw error;
    }
  })().finally(() => {
    snapshotBuildPromise = null;
  });

  return snapshotBuildPromise;
}

function createSnapshotRuntime() {
  let indexPromise = null;

  async function loadIndex() {
    if (indexPromise) return indexPromise;
    indexPromise = loadSnapshotIndex();
    return indexPromise;
  }

  return Object.freeze({
    async loadFrame(frameIndex) {
      const indexData = await loadIndex();
      const descriptor = indexData.frames.find(frame => frame.frameIndex === Number(frameIndex));
      if (!descriptor) throw new Error(`SWIRLS frame ${frameIndex} is not present in the current index`);

      const text = await fetchSnapshotSwirlsText(descriptor.mdlUrl, {
        ttlSeconds: SWIRLS_FETCH_POLICY.mdlTtlSeconds,
        timeoutMs: SWIRLS_FETCH_POLICY.timeoutMs,
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

async function loadSnapshotIndex() {
  const text = await fetchSnapshotSwirlsText(SWIRLS_RAW_CONTRACT.indexUrl, {
    ttlSeconds: SWIRLS_FETCH_POLICY.indexTtlSeconds,
    timeoutMs: SWIRLS_FETCH_POLICY.timeoutMs,
  });
  const parsed = parseSwirlsIndex(text.body);
  return {
    ...parsed,
    sourceBytes: text.bytes,
    sourceUpdatedAt: text.updatedAt,
    cacheStatus: text.cacheStatus,
  };
}

async function fetchSnapshotSwirlsText(url, options = {}) {
  const ttlSeconds = Math.max(1, Number(options.ttlSeconds) || SWIRLS_FETCH_POLICY.indexTtlSeconds);
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || SWIRLS_FETCH_POLICY.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    const upstream = await fetch(url, {
      redirect: 'follow',
      headers: {
        Accept: 'text/plain,*/*',
        'User-Agent': 'Rain-Track-SWIRLS-Snapshot/1.0',
      },
      signal: controller.signal,
      cf: { cacheEverything: true, cacheTtl: ttlSeconds },
    });
    if (!upstream.ok) throw new Error(`SWIRLS upstream HTTP ${upstream.status}`);
    const body = await upstream.text();
    return {
      body,
      bytes: new TextEncoder().encode(body).byteLength,
      updatedAt: upstream.headers.get('last-modified'),
      cacheStatus: upstream.headers.get('cf-cache-status') || 'edge-fetch',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readSnapshot(env) {
  return readKvJson(env?.SWIRLS_SNAPSHOTS, SWIRLS_SNAPSHOT_KEY);
}

async function readKvJson(binding, key) {
  if (!binding || typeof binding.get !== 'function') return null;
  const raw = await binding.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeSnapshotStatus(env, status) {
  if (!env?.SWIRLS_SNAPSHOTS || typeof env.SWIRLS_SNAPSHOTS.put !== 'function') return;
  await env.SWIRLS_SNAPSHOTS.put(SWIRLS_SNAPSHOT_STATUS_KEY, JSON.stringify(status));
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
