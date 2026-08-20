import assert from 'node:assert/strict';
import { createPhase3Cv2Worker, createWorkerSwirlsFetchText } from '../worker-phase3c-v2.js';
import { SwirlsPointRequestError } from '../swirls-point-request.js';

// Production SWIRLS origin reads must rely on fetch caching only. A normal
// request must not force origin revalidation with cache:no-cache or a
// Cache-Control:no-cache request header.
const fetchCalls = [];
const cachedFetchText = createWorkerSwirlsFetchText({
  fetchImpl: async (url, options) => {
    fetchCalls.push({ url, options });
    return new Response('sample', {
      status:200,
      headers:{ 'CF-Cache-Status':'HIT', 'Last-Modified':'Thu, 20 Aug 2026 00:00:00 GMT' }
    });
  }
});
const cachedText = await cachedFetchText('https://example.test/frame.af.mdl', { ttlSeconds:45, timeoutMs:1000 });
assert.equal(cachedText.body, 'sample');
assert.equal(cachedText.cacheStatus, 'HIT');
assert.equal(fetchCalls.length, 1);
assert.equal(fetchCalls[0].options.cache, undefined, 'normal SWIRLS reads must not force cache revalidation');
assert.equal(fetchCalls[0].options.headers['Cache-Control'], undefined, 'normal SWIRLS reads must not send Cache-Control:no-cache');
assert.deepEqual(fetchCalls[0].options.cf, { cacheEverything:true, cacheTtl:45 });

const bypassCalls = [];
const bypassFetchText = createWorkerSwirlsFetchText({
  fetchImpl: async (url, options) => {
    bypassCalls.push({ url, options });
    return new Response('fresh', { status:200 });
  }
});
await bypassFetchText('https://example.test/frame.af.mdl', { bypassCache:true, ttlSeconds:45, timeoutMs:1000 });
assert.equal(bypassCalls[0].options.cache, 'no-store');
assert.match(bypassCalls[0].options.headers['Cache-Control'], /no-store/);
assert.deepEqual(bypassCalls[0].options.cf, { cacheEverything:false, cacheTtl:0 });

const forwarded = [];
const baseWorker = {
  async fetch(request) {
    forwarded.push(`${request.method} ${new URL(request.url).pathname}`);
    return new Response('stable-recovery', { status: 207, headers: { 'X-Stable-Recovery': 'true' } });
  }
};

const pointCalls = [];
const seriesCalls = [];
const worker = createPhase3Cv2Worker({
  baseWorker,
  handlePoint: async url => {
    pointCalls.push(url.search);
    return {
      ok: true,
      frameIndex: 3,
      validTime: '2026-08-14T02:48:00.000Z',
      leadMinutes: 48,
      windowStart: '2026-08-14T02:18:00.000Z',
      windowEnd: '2026-08-14T02:48:00.000Z',
      cadenceMinutes: 6,
      accumulationMinutes: 30,
      unit: 'mm / 30 min',
      location: { lat: 22.3, lon: 114.17 },
      amountMm: 1.25
    };
  },
  handlePointSeries: async url => {
    seriesCalls.push(url.search);
    return {
      ok: true,
      runTime: '2026-08-14T02:00:00.000Z',
      cadenceMinutes: 6,
      accumulationMinutes: 30,
      unit: 'mm / 30 min',
      location: { lat:22.3, lon:114.17 },
      points: Array.from({ length:16 }, (_, frameIndex) => ({
        frameIndex,
        validTime: new Date(Date.parse('2026-08-14T02:00:00.000Z') + (30 + frameIndex * 6) * 60_000).toISOString(),
        leadMinutes: 30 + frameIndex * 6,
        amountMm: frameIndex / 10
      }))
    };
  }
});

const legacy = await worker.fetch(new Request('https://example.test/api/rain/swirls/frame?frame=0'));
assert.equal(legacy.status, 207);
assert.equal(await legacy.text(), 'stable-recovery');
assert.equal(legacy.headers.get('X-Stable-Recovery'), 'true');
assert.deepEqual(forwarded, ['GET /api/rain/swirls/frame']);
assert.equal(pointCalls.length, 0);
assert.equal(seriesCalls.length, 0);

const point = await worker.fetch(new Request('https://example.test/api/rain/swirls/point?frame=3&lat=22.3&lon=114.17'));
assert.equal(point.status, 200);
const payload = await point.json();
assert.equal(payload.ok, true);
assert.equal(payload.frameIndex, 3);
assert.equal(payload.cadenceMinutes, 6);
assert.equal(payload.accumulationMinutes, 30);
assert.equal(payload.unit, 'mm / 30 min');
assert.equal(payload.amountMm, 1.25);
assert.equal(point.headers.get('Cache-Control'), 'no-store');
assert.match(point.headers.get('Server-Timing') || '', /^swirls;dur=\d+$/);
assert.equal(point.headers.get('Access-Control-Allow-Origin'), '*');
assert.equal(forwarded.length, 1, 'single-frame point GET must not pass through the legacy Worker');
assert.equal(pointCalls.length, 1);
assert.equal(seriesCalls.length, 0);

const series = await worker.fetch(new Request('https://example.test/api/rain/swirls/point-series?lat=22.3&lon=114.17'));
assert.equal(series.status, 200);
const seriesPayload = await series.json();
assert.equal(seriesPayload.ok, true);
assert.equal(seriesPayload.points.length, 16);
assert.equal(seriesPayload.cadenceMinutes, 6);
assert.equal(seriesPayload.accumulationMinutes, 30);
assert.equal(seriesPayload.points.at(-1).leadMinutes, 120);
assert.match(series.headers.get('Server-Timing') || '', /^swirls;dur=\d+$/);
assert.equal(seriesCalls.length, 1);
assert.equal(forwarded.length, 1, 'point-series GET must not pass through the legacy Worker');

const post = await worker.fetch(new Request('https://example.test/api/rain/swirls/point?frame=3&lat=22.3&lon=114.17', { method: 'POST' }));
assert.equal(post.status, 207);
assert.deepEqual(forwarded, ['GET /api/rain/swirls/frame', 'POST /api/rain/swirls/point']);
assert.equal(pointCalls.length, 1);

const postSeries = await worker.fetch(new Request('https://example.test/api/rain/swirls/point-series?lat=22.3&lon=114.17', { method:'POST' }));
assert.equal(postSeries.status, 207);
assert.deepEqual(forwarded, ['GET /api/rain/swirls/frame', 'POST /api/rain/swirls/point', 'POST /api/rain/swirls/point-series']);
assert.equal(seriesCalls.length, 1);

const badWorker = createPhase3Cv2Worker({
  baseWorker,
  handlePoint: async () => { throw new SwirlsPointRequestError('bad request', 400); },
  handlePointSeries: async () => { throw new SwirlsPointRequestError('bad series request', 422); }
});
const bad = await badWorker.fetch(new Request('https://example.test/api/rain/swirls/point?frame=x&lat=22.3&lon=114.17'));
assert.equal(bad.status, 400);
assert.deepEqual(await bad.json(), { ok: false, error: 'bad request' });
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
assert.deepEqual(await unavailable.json(), { ok: false, error: 'upstream unavailable' });
const seriesUnavailable = await upstreamWorker.fetch(new Request('https://example.test/api/rain/swirls/point-series?lat=22.3&lon=114.17'));
assert.equal(seriesUnavailable.status, 502);
assert.deepEqual(await seriesUnavailable.json(), { ok:false, error:'series upstream unavailable' });

console.log('Phase 3C v2 compact SWIRLS Worker entry + fetch-cache gate PASS');
