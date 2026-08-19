import assert from 'node:assert/strict';
import { parseSwirlsIndex } from '../swirls-data.js';
import { createSwirlsPointSeriesBatchLoader } from '../swirls-point-series-batch.js';
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

function compactHkt(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Hong_Kong',
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]:part.value }), {});
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

function makeIndex(runIso = runTime) {
  const run = new Date(runIso);
  const assetMinute = compactHkt(run).slice(-2);
  return Array.from({ length:16 }, (_, frameIndex) => {
    const valid = new Date(run.getTime() + (30 + frameIndex * 6) * 60_000);
    return `${compactHkt(valid)},ncrf_minute${assetMinute}_${frameIndex}.png,ncrf_minute${assetMinute}_${frameIndex}.af.mdl`;
  }).join('\n');
}

function makeMdl(runIso = runTime) {
  const run = new Date(runIso);
  const header = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Hong_Kong',
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(run).reduce((acc, part) => ({ ...acc, [part.type]:part.value }), {});
  const lats = Array.from({ length:121 }, (_, index) => Number((23.487 - index * 0.01799).toFixed(3)));
  const lons = Array.from({ length:121 }, (_, index) => Number((112.956 + index * 0.01946).toFixed(3)));
  const lines = [`SL-RF  DMO    ${header.year} ${header.month} ${header.day} ${header.hour} ${header.minute}`];
  for (const lat of lats) {
    for (const lon of lons) lines.push(`${lon.toFixed(3)} ${lat.toFixed(3)} 0.500`);
  }
  return lines.join('\n');
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

// Directly validate the Phase 3C production batch adapter. One point-series
// invocation must parse exactly one index snapshot and fetch exactly 16 MDLs.
const parsedIndex = parseSwirlsIndex(makeIndex());
const mdl = makeMdl();
let indexCalls = 0;
let mdlCalls = 0;
const productionBatchLoader = createSwirlsPointSeriesBatchLoader({
  loadIndex: async () => {
    indexCalls += 1;
    return parsedIndex;
  },
  fetchText: async (url, options) => {
    assert.match(url, /\.af\.mdl$/);
    assert.equal(options.kind, 'mdl');
    mdlCalls += 1;
    return { body:mdl, cacheStatus:'MISS' };
  }
});
const productionFrames = await productionBatchLoader(
  Array.from({ length:16 }, (_, frameIndex) => frameIndex),
  { concurrency:4 }
);
assert.equal(indexCalls, 1, 'point-series batch must load the SWIRLS index exactly once');
assert.equal(mdlCalls, 16, 'point-series batch must load one MDL per frame');
assert.equal(indexCalls + mdlCalls, 17, 'point-series fetch plan must remain 1 index + 16 MDLs');
assert.equal(productionFrames.length, 16);
assert.deepEqual(productionFrames.map(frame => frame.frameIndex), Array.from({ length:16 }, (_, i) => i));
assert.equal(new Set(productionFrames.map(frame => frame.runTime)).size, 1, 'all point-series frames must share one run');
assert.equal(productionFrames[0].leadMinutes, 30);
assert.equal(productionFrames.at(-1).leadMinutes, 120);

await assert.rejects(
  () => handler(new URL('https://example.test/api/rain/swirls/point-series?lat=30&lon=113.5')),
  error => error?.status === 422
);

assert.throws(
  () => createSwirlsPointSeriesRequestHandler({}),
  /requires loadFrame\(frameIndex\) or loadFrames\(frameIndexes\)/
);
assert.throws(
  () => createSwirlsPointSeriesBatchLoader({ loadIndex:async () => parsedIndex }),
  /requires fetchText\(\)/
);

console.log('SWIRLS point-series request + batch budget validation passed');
