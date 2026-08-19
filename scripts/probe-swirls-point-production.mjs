import assert from 'node:assert/strict';
import { sampleSwirlsPoint } from '../swirls-point-sample.js';

const base = (process.env.WORKER_BASE_URL || 'https://radar.max-yu.workers.dev').replace(/\/$/, '');
const frameIndex = 3;
const lat = 22.3023;
const lon = 114.1746;

async function getJson(path, expectedStatus = 200) {
  const response = await fetch(`${base}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, expectedStatus, `${path} expected HTTP ${expectedStatus}, got ${response.status}`);
  return { response, payload: await response.json() };
}

const pointPath = `/api/rain/swirls/point?frame=${frameIndex}&lat=${lat}&lon=${lon}`;
const pointResult = await getJson(pointPath);
const point = pointResult.payload;
assert.equal(point.ok, true);
assert.equal(point.frameIndex, frameIndex);
assert.equal(point.leadMinutes, 48);
assert.equal(point.cadenceMinutes, 6);
assert.equal(point.accumulationMinutes, 30);
assert.equal(point.unit, 'mm / 30 min');
assert.equal(point.location.lat, lat);
assert.equal(point.location.lon, lon);
assert.equal(Number.isFinite(point.amountMm), true);
assert.equal('grid' in point, false, 'compact point response must not return a full grid');
assert.equal('values' in point, false, 'compact point response must not return grid values');
assert.match(pointResult.response.headers.get('cache-control') || '', /no-store/i);

const frameResult = await getJson(`/api/rain/swirls/frame?frame=${frameIndex}`);
const frame = frameResult.payload;
assert.equal(frame.ok, true);
assert.equal(frame.frameIndex, frameIndex);
assert.equal(frame.runTime, point.runTime);
assert.equal(frame.validTime, point.validTime);
assert.equal(frame.windowStart, point.windowStart);
assert.equal(frame.windowEnd, point.windowEnd);

const expected = sampleSwirlsPoint(frame, lat, lon);
assert.equal(point.amountMm, expected.amountMm, 'production point sample must match the legacy full-frame interpolation');

const invalid = await getJson(`/api/rain/swirls/point?frame=16&lat=${lat}&lon=${lon}`, 400);
assert.equal(invalid.payload.ok, false);

const outside = await getJson('/api/rain/swirls/point?frame=0&lat=20&lon=114', 422);
assert.equal(outside.payload.ok, false);

console.log(`SWIRLS production point PASS frame=${frameIndex} valid=${point.validTime} amount=${point.amountMm} ${point.unit}`);
