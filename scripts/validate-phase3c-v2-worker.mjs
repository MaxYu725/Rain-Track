import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPhase3Cv2Worker, createWorkerSwirlsFetchText } from '../worker-phase3c-v2.js';
import { SwirlsPointRequestError } from '../swirls-point-request.js';

const workerSource = readFileSync(new URL('../worker-phase3c-v2.js', import.meta.url), 'utf8');
assert.ok(!workerSource.includes('caches.default'), 'compact SWIRLS critical path should use fetch edge caching rather than manual Cache API bookkeeping');
assert.ok(!workerSource.includes('cache.match('), 'compact SWIRLS critical path must not synchronously wait on cache.match');
assert.ok(!workerSource.includes('cache.put('), 'compact SWIRLS critical path must not synchronously wait on cache.put');
assert.ok(!workerSource.includes("cache: 'no-cache'"), 'normal SWIRLS fetch must not force revalidation');
assert.ok(!workerSource.includes("'Cache-Control': 'no-cache'"), 'normal SWIRLS fetch must not send Cache-Control:no-cache');
assert.ok(workerSource.includes('COMPACT_MDL_CACHE_TTL_SECONDS = 300'), 'MDL source bytes should be reusable across location requests within one forecast cadence');
assert.ok(workerSource.includes('COMPACT_INDEX_CACHE_TTL_SECONDS = 30'), 'the mutable index needs only a short edge cache');

const fetchCalls = [];
const fetchText = createWorkerSwirlsFetchText({
  fetchImpl: async (url, options) => {
    fetchCalls.push({ url, options });
    return new Response('sample', { status:200, headers:{ 'Last-Modified':'Wed, 19 Aug 2026 12:00:00 GMT' } });
  }
});
const fetched = await fetchText('https://example.test/frame.af.mdl', { kind:'mdl', timeoutMs:1000 });
assert.equal(fetched.body, 'sample');
assert.equal(fetchCalls.length, 1);
assert.equal(fetchCalls[0].options.cache, undefined, 'normal SWIRLS fetch should not use browser cache modes');
assert.deepEqual(fetchCalls[0].options.cf, { cacheEverything:true, cacheTtl:300 }, 'MDL fetches must reuse immutable source bytes at the Cloudflare edge');
assert.equal(fetchCalls[0].options.headers['Cache-Control'], undefined);

const indexCalls = [];
const indexFetchText = createWorkerSwirlsFetchText({
  fetchImpl: async (url, options) => {
    indexCalls.push({ url, options });
    return new Response('index', { status:200 });
  }
});
await indexFetchText('https://example.test/index.txt', { kind:'index', timeoutMs:1000 });
assert.deepEqual(indexCalls[0].options.cf, { cacheEverything:true, cacheTtl:30 }, 'index fetches must retain a short freshness window');

const bypassCalls = [];
const bypassFetchText = createWorkerSwirlsFetchText({
  fetchImpl: async (url, options) => {
    bypassCalls.push({ url, options });
    return new Response('fresh', { status:200 });
  }
});
await bypassFetchText('https://example.test/frame.af.mdl', { kind:'mdl', bypassCache:true, timeoutMs:1000 });
assert.equal(bypassCalls[0].options.cache, 'no-store');
assert.equal(bypassCalls[0].options.cf, undefined, 'explicit bypass must also bypass the Worker edge cache');

const forwarded = [];
const baseWorker = {
  async fetch(request) {
    forwarded.push(`${request.method} ${new URL(request.url).pathname}`);
    return new Response('stable-recovery', { status:207, headers:{ 'X-Stable-Recovery':'true' } });
  }
};

const pointCalls = [];
const seriesCalls = [];
const worker = createPhase3Cv2Worker({
  baseWorker,
  handlePoint: async url => {
    pointCalls.push(url.search);
    return {
      ok:true,
      frameIndex:3,
      validTime:'2026-08-14T02:48:00.000Z',
      leadMinutes:48,
      windowStart:'2026-08-14T02:18:00.000Z',
      windowEnd:'2026-08-14T02:48:00.000Z',
      cadenceMinutes:6,
      accumulationMinutes:30,
      unit:'mm / 30 min',
      location:{ lat:22.3, lon:114.17 },
      amountMm:1.25
    };
  },
  handlePointSeries: async url => {
    seriesCalls.push(url.search);
    return {
      ok:true,
      complete:true,
      runTime:'2026-08-14T02:00:00.000Z',
      cadenceMinutes:6,
      accumulationMinutes:30,
      unit:'mm / 30 min',
      location:{ lat:22.3, lon:114.17 },
      missingFrames:[],
      points:Array.from({ length:16 }, (_, frameIndex) => ({
        frameIndex,
        validTime:new Date(Date.parse('2026-08-14T02:00:00.000Z') + (30 + frameIndex * 6) * 60_000).toISOString(),
        leadMinutes:30 + frameIndex * 6,
        amountMm:frameIndex / 10
      }))
    };
  }
});

const legacy = await worker.fetch(new Request('https://example.test/api/rain/swirls/frame?frame=0'));
assert.equal(legacy.status, 207);
assert.equal(await legacy.text(), 'stable-recovery');
assert.deepEqual(forwarded, ['GET /api/rain/swirls/frame']);

const point = await worker.fetch(new Request('https://example.test/api/rain/swirls/point?frame=3&lat=22.3&lon=114.17'));
assert.equal(point.status, 200);
const pointPayload = await point.json();
assert.equal(pointPayload.ok, true);
assert.equal(pointPayload.amountMm, 1.25);
assert.equal(point.headers.get('Cache-Control'), 'no-store');
assert.equal(pointCalls.length, 1);

const series = await worker.fetch(new Request('https://example.test/api/rain/swirls/point-series?lat=22.3&lon=114.17'));
assert.equal(series.status, 200);
const seriesPayload = await series.json();
assert.equal(seriesPayload.ok, true);
assert.equal(seriesPayload.complete, true);
assert.equal(seriesPayload.points.length, 16);
assert.deepEqual(seriesPayload.missingFrames, []);
assert.equal(seriesPayload.points.at(-1).leadMinutes, 120);
assert.equal(seriesCalls.length, 1);
assert.equal(forwarded.length, 1, 'point-series GET must not pass through the legacy Worker');

const post = await worker.fetch(new Request('https://example.test/api/rain/swirls/point?frame=3&lat=22.3&lon=114.17', { method:'POST' }));
assert.equal(post.status, 207);
const postSeries = await worker.fetch(new Request('https://example.test/api/rain/swirls/point-series?lat=22.3&lon=114.17', { method:'POST' }));
assert.equal(postSeries.status, 207);

const badWorker = createPhase3Cv2Worker({
  baseWorker,
  handlePoint: async () => { throw new SwirlsPointRequestError('bad request', 400); },
  handlePointSeries: async () => { throw new SwirlsPointRequestError('bad series request', 422); }
});
const bad = await badWorker.fetch(new Request('https://example.test/api/rain/swirls/point?frame=x&lat=22.3&lon=114.17'));
assert.equal(bad.status, 400);
assert.deepEqual(await bad.json(), { ok:false, error:'bad request' });
const badSeries = await badWorker.fetch(new Request('https://example.test/api/rain/swirls/point-series?lat=30&lon=114.17'));
assert.equal(badSeries.status, 422);
assert.deepEqual(await badSeries.json(), { ok:false, error:'bad series request' });

const upstreamWorker = createPhase3Cv2Worker({
  baseWorker,
  handlePoint: async () => { throw new Error('upstream unavailable'); },
  handlePointSeries: async () => { throw new Error('series upstream unavailable'); }
});
const unavailable = await upstreamWorker.fetch(new Request('https://example.test/api/rain/swirls/point?frame=0&lat=22.3&lon=114.17'));
assert.equal(unavailable.status, 502);
const seriesUnavailable = await upstreamWorker.fetch(new Request('https://example.test/api/rain/swirls/point-series?lat=22.3&lon=114.17'));
assert.equal(seriesUnavailable.status, 502);

console.log('Phase 3C compact SWIRLS edge-reuse gate PASS');
