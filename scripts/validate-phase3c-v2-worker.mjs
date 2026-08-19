import assert from 'node:assert/strict';
import { createPhase3Cv2Worker } from '../worker-phase3c-v2.js';
import { SwirlsPointRequestError } from '../swirls-point-request.js';

const forwarded = [];
const baseWorker = {
  async fetch(request) {
    forwarded.push(`${request.method} ${new URL(request.url).pathname}`);
    return new Response('stable-recovery', { status: 207, headers: { 'X-Stable-Recovery': 'true' } });
  }
};

const pointCalls = [];
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
  }
});

const legacy = await worker.fetch(new Request('https://example.test/api/rain/swirls/frame?frame=0'));
assert.equal(legacy.status, 207);
assert.equal(await legacy.text(), 'stable-recovery');
assert.equal(legacy.headers.get('X-Stable-Recovery'), 'true');
assert.deepEqual(forwarded, ['GET /api/rain/swirls/frame']);
assert.equal(pointCalls.length, 0);

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
assert.equal(point.headers.get('Access-Control-Allow-Origin'), '*');
assert.equal(forwarded.length, 1, 'new point GET must not pass through the legacy Worker');
assert.equal(pointCalls.length, 1);

const post = await worker.fetch(new Request('https://example.test/api/rain/swirls/point?frame=3&lat=22.3&lon=114.17', { method: 'POST' }));
assert.equal(post.status, 207);
assert.deepEqual(forwarded, ['GET /api/rain/swirls/frame', 'POST /api/rain/swirls/point']);
assert.equal(pointCalls.length, 1);

const badWorker = createPhase3Cv2Worker({
  baseWorker,
  handlePoint: async () => {
    throw new SwirlsPointRequestError('bad request', 400);
  }
});
const bad = await badWorker.fetch(new Request('https://example.test/api/rain/swirls/point?frame=x&lat=22.3&lon=114.17'));
assert.equal(bad.status, 400);
assert.deepEqual(await bad.json(), { ok: false, error: 'bad request' });

const upstreamWorker = createPhase3Cv2Worker({
  baseWorker,
  handlePoint: async () => {
    throw new Error('upstream unavailable');
  }
});
const unavailable = await upstreamWorker.fetch(new Request('https://example.test/api/rain/swirls/point?frame=0&lat=22.3&lon=114.17'));
assert.equal(unavailable.status, 502);
assert.deepEqual(await unavailable.json(), { ok: false, error: 'upstream unavailable' });

console.log('Phase 3C v2 isolated Worker entry gate PASS');
