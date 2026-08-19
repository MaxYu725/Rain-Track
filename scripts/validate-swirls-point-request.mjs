import assert from 'node:assert/strict';
import { createSwirlsPointRequestHandler, SwirlsPointRequestError } from '../swirls-point-request.js';
import { SWIRLS_RAW_CONTRACT } from '../swirls-data.js';

function makeFrame(frameIndex) {
  const rows = 2;
  const cols = 2;
  return {
    contractVersion: SWIRLS_RAW_CONTRACT.version,
    frameIndex,
    runTime: '2026-08-14T02:00:00.000Z',
    validTime: '2026-08-14T02:48:00.000Z',
    leadMinutes: 48,
    windowStart: '2026-08-14T02:18:00.000Z',
    windowEnd: '2026-08-14T02:48:00.000Z',
    unit: SWIRLS_RAW_CONTRACT.unit,
    grid: {
      rows,
      cols,
      orientation: SWIRLS_RAW_CONTRACT.orientation,
      latitudes: [23.0, 22.0],
      longitudes: [113.5, 114.5],
      bounds: { south: 21.5, north: 23.5, west: 113.0, east: 115.0 }
    },
    values: [0, 2, 4, 6]
  };
}

const loaded = [];
const handler = createSwirlsPointRequestHandler({
  loadFrame: async frameIndex => {
    loaded.push(frameIndex);
    return makeFrame(frameIndex);
  }
});

const result = await handler(new URL('https://example.test/api/rain/swirls/point?frame=3&lat=22.5&lon=114.0'));
assert.equal(result.ok, true);
assert.equal(result.frameIndex, 3);
assert.equal(result.amountMm, 3);
assert.equal(result.cadenceMinutes, 6);
assert.equal(result.accumulationMinutes, 30);
assert.equal(result.unit, 'mm / 30 min');
assert.deepEqual(loaded, [3], 'one point request must load exactly one requested SWIRLS frame');

for (const invalidUrl of [
  'https://example.test/api/rain/swirls/point?lat=22.5&lon=114.0',
  'https://example.test/api/rain/swirls/point?frame=16&lat=22.5&lon=114.0',
  'https://example.test/api/rain/swirls/point?frame=0&lat=x&lon=114.0',
  'https://example.test/api/rain/swirls/point?frame=0&lat=20&lon=114.0'
]) {
  const before = loaded.length;
  await assert.rejects(
    () => handler(new URL(invalidUrl)),
    error => error instanceof SwirlsPointRequestError && [400, 422].includes(error.status)
  );
  assert.equal(loaded.length, before, 'invalid point requests must fail before any frame load');
}

console.log('SWIRLS single-frame point request gate PASS');
