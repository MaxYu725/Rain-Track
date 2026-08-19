import assert from 'node:assert/strict';
import { createSwirlsPointSeriesRequestHandler } from '../swirls-point-series-request.js';

const runTime = '2026-08-19T12:00:00.000Z';

function makeFrame(frameIndex) {
  const leadMinutes = 30 + frameIndex * 6;
  const validTime = new Date(Date.parse(runTime) + leadMinutes * 60_000).toISOString();
  return {
    contractVersion: '1.0',
    frameIndex,
    runTime,
    validTime,
    leadMinutes,
    windowStart: new Date(Date.parse(validTime) - 30 * 60_000).toISOString(),
    windowEnd: validTime,
    unit: 'mm / 30 min',
    grid: {
      orientation: 'row-major-north-to-south-west-to-east',
      latitudes: [23, 22],
      longitudes: [113, 114],
      bounds: { north:23, south:22, west:113, east:114 }
    },
    values: [frameIndex, frameIndex, frameIndex, frameIndex]
  };
}

const calls = [];
const handler = createSwirlsPointSeriesRequestHandler({
  concurrency: 3,
  loadFrame: async frameIndex => {
    calls.push(frameIndex);
    return makeFrame(frameIndex);
  }
});

const result = await handler(new URL('https://example.test/api/rain/swirls/point-series?lat=22.5&lon=113.5'));
assert.equal(result.ok, true);
assert.equal(result.points.length, 16);
assert.equal(result.cadenceMinutes, 6);
assert.equal(result.accumulationMinutes, 30);
assert.equal(result.points[0].leadMinutes, 30);
assert.equal(result.points[15].leadMinutes, 120);
assert.equal(result.points[7].amountMm, 7);
assert.equal(new Set(calls).size, 16);
assert.deepEqual([...calls].sort((a,b) => a-b), Array.from({length:16}, (_, i) => i));

const batchCalls = [];
const batchHandler = createSwirlsPointSeriesRequestHandler({
  concurrency: 4,
  loadFrame: async () => { throw new Error('individual loader must not be used when loadFrames exists'); },
  loadFrames: async (frameIndexes, options) => {
    batchCalls.push({ frameIndexes:[...frameIndexes], options:{ ...options } });
    return frameIndexes.map(makeFrame);
  }
});
const batchResult = await batchHandler(new URL('https://example.test/api/rain/swirls/point-series?lat=22.5&lon=113.5'));
assert.equal(batchResult.ok, true);
assert.equal(batchResult.points.length, 16);
assert.equal(batchCalls.length, 1);
assert.deepEqual(batchCalls[0].frameIndexes, Array.from({ length:16 }, (_, i) => i));
assert.equal(batchCalls[0].options.concurrency, 4);

await assert.rejects(
  () => handler(new URL('https://example.test/api/rain/swirls/point-series?lat=30&lon=113.5')),
  error => error?.status === 422
);

assert.throws(
  () => createSwirlsPointSeriesRequestHandler({}),
  /requires loadFrame\(frameIndex\) or loadFrames\(frameIndexes\)/
);

console.log('SWIRLS point-series request validation passed');
