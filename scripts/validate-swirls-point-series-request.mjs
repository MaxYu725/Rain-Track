import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSwirlsIndex } from '../swirls-data.js';
import { createSwirlsPointSeriesBatchLoader } from '../swirls-point-series-batch.js';
import { createSwirlsPointSeriesRequestHandler } from '../swirls-point-series-request.js';

const runTime = '2026-08-19T12:00:00.000Z';
const frameIndexes = Array.from({ length:16 }, (_, frameIndex) => frameIndex);
const targetPoint = { lat:22.3258, lon:114.2186 };

function makeSample(frameIndex, amountMm = frameIndex / 10) {
  const leadMinutes = 30 + frameIndex * 6;
  const validTime = new Date(Date.parse(runTime) + leadMinutes * 60_000).toISOString();
  return {
    contractVersion:'1.0', frameIndex, runTime, validTime, leadMinutes,
    windowStart:new Date(Date.parse(validTime) - 30 * 60_000).toISOString(),
    windowEnd:validTime, cadenceMinutes:6, accumulationMinutes:30,
    unit:'mm / 30 min', location:{ ...targetPoint }, interpolation:'bilinear-grid-centres',
    amountMm, clampedToGridCentreBoundary:false
  };
}

function compactHkt(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Hong_Kong', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' })
    .formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]:part.value }), {});
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

function makeIndex(runIso = runTime) {
  const run = new Date(runIso);
  const assetMinute = compactHkt(run).slice(-2);
  return frameIndexes.map(frameIndex => {
    const valid = new Date(run.getTime() + (30 + frameIndex * 6) * 60_000);
    return `${compactHkt(valid)},ncrf_minute${assetMinute}_${frameIndex}.png,ncrf_minute${assetMinute}_${frameIndex}.af.mdl`;
  }).join('\n');
}

function makeMdl(runIso = runTime) {
  const run = new Date(runIso);
  const header = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Hong_Kong', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' })
    .formatToParts(run).reduce((acc, part) => ({ ...acc, [part.type]:part.value }), {});
  const lats = Array.from({ length:121 }, (_, index) => Number((23.487 - index * ((23.487 - 21.328) / 120)).toFixed(3)));
  const lons = Array.from({ length:121 }, (_, index) => Number((112.956 + index * ((115.291 - 112.956) / 120)).toFixed(3)));
  const lines = [`SL-RF  DMO    ${header.year} ${header.month} ${header.day} ${header.hour} ${header.minute}`];
  for (const lat of lats) for (const lon of lons) lines.push(`${lon.toFixed(3)} ${lat.toFixed(3)} ${(lat + lon - 133).toFixed(3)}`);
  return lines.join('\n');
}

let completePoint = null;
const completeHandler = createSwirlsPointSeriesRequestHandler({
  loadFrames: async (indexes, options) => {
    completePoint = options?.point;
    return { index:{ runTime }, samples:indexes.map(makeSample), failures:[] };
  }
});
const complete = await completeHandler(new URL(`https://example.test/api/rain/swirls/point-series?lat=${targetPoint.lat}&lon=${targetPoint.lon}`));
assert.deepEqual(completePoint, targetPoint, 'request handler must pass the target point into the compact loader');
assert.equal(complete.ok, true);
assert.equal(complete.complete, true);
assert.equal(complete.points.length, 16);
assert.deepEqual(complete.missingFrames, []);
assert.equal(complete.points[0].leadMinutes, 30);
assert.equal(complete.points.at(-1).leadMinutes, 120);

const partialHandler = createSwirlsPointSeriesRequestHandler({
  loadFrames: async indexes => ({
    index:{ runTime },
    samples:indexes.map(frameIndex => frameIndex === 7 ? null : makeSample(frameIndex)),
    failures:[{ frameIndex:7, error:'synthetic failure' }]
  })
});
const partial = await partialHandler(new URL(`https://example.test/api/rain/swirls/point-series?lat=${targetPoint.lat}&lon=${targetPoint.lon}`));
assert.equal(partial.ok, true);
assert.equal(partial.complete, false);
assert.equal(partial.points.length, 15);
assert.deepEqual(partial.missingFrames, [7]);

const parsedIndex = parseSwirlsIndex(makeIndex());
const mdl = makeMdl();
let indexCalls = 0;
let mdlStarts = 0;
const productionBatchLoader = createSwirlsPointSeriesBatchLoader({
  loadIndex: async () => { indexCalls += 1; return parsedIndex; },
  fetchText: async (url, options) => {
    assert.match(url, /\.af\.mdl$/);
    assert.equal(options.kind, 'mdl');
    mdlStarts += 1;
    return { body:mdl, cacheStatus:null };
  }
});
const productionBatch = await productionBatchLoader(frameIndexes, { point:targetPoint });
assert.equal(indexCalls, 1, 'point-series must read exactly one index snapshot');
assert.equal(mdlStarts, 16, 'all 16 compact MDL reads must be started for a healthy series');
assert.equal(productionBatch.failures.length, 0);
assert.equal(productionBatch.samples.length, 16);
assert.deepEqual(productionBatch.samples.map(sample => sample.frameIndex), frameIndexes);
assert.equal(new Set(productionBatch.samples.map(sample => sample.runTime)).size, 1);
const expectedAmount = targetPoint.lat + targetPoint.lon - 133;
for (const sample of productionBatch.samples) {
  assert.ok(Math.abs(sample.amountMm - expectedAmount) < 0.003, 'fast local interpolation must preserve the linear synthetic field');
}

let failedIndexCalls = 0;
const oneFailureLoader = createSwirlsPointSeriesBatchLoader({
  loadIndex: async () => { failedIndexCalls += 1; return parsedIndex; },
  fetchText: async (url, options) => {
    if (options.frameIndex === 5) throw new Error('frame 5 failed');
    return { body:mdl };
  }
});
const oneFailure = await oneFailureLoader(frameIndexes, { point:targetPoint });
assert.equal(failedIndexCalls, 1);
assert.equal(oneFailure.samples.filter(Boolean).length, 15);
assert.equal(oneFailure.samples[5], null);
assert.deepEqual(oneFailure.failures.map(item => item.frameIndex), [5]);

const malformedFrameLoader = createSwirlsPointSeriesBatchLoader({
  loadIndex: async () => parsedIndex,
  fetchText: async (url, options) => ({ body:options.frameIndex === 9 ? 'not an MDL' : mdl })
});
const malformed = await malformedFrameLoader(frameIndexes, { point:targetPoint });
assert.equal(malformed.samples.filter(Boolean).length, 15);
assert.equal(malformed.samples[9], null);
assert.deepEqual(malformed.failures.map(item => item.frameIndex), [9]);

const batchSource = readFileSync(new URL('../swirls-point-series-batch.js', import.meta.url), 'utf8');
const sampleSource = readFileSync(new URL('../swirls-point-series-sample.js', import.meta.url), 'utf8');
assert.ok(batchSource.includes('sampleSwirlsMdlPoint'), 'Rain Home compact series must use direct MDL point sampling');
assert.ok(!batchSource.includes('bindSwirlsMdlFrame'), 'Rain Home compact series must not decode full 121x121 frames');
assert.ok(!batchSource.includes('withHardDeadline'), 'compact-series speed must not depend on artificial hard deadlines');
assert.ok(!batchSource.includes('SWIRLS_POINT_SERIES_CONCURRENCY'), 'compact-series speed must not depend on manual concurrency throttling');
assert.ok(sampleSource.includes('selectNativeGridCells'), 'direct sampler must scan native grid text without materializing every grid point');

await assert.rejects(
  () => completeHandler(new URL('https://example.test/api/rain/swirls/point-series?lat=30&lon=113.5')),
  error => error?.status === 422
);
assert.throws(() => createSwirlsPointSeriesRequestHandler({}), /requires loadFrames\(frameIndexes\)/);
assert.throws(() => createSwirlsPointSeriesBatchLoader({ loadIndex:async () => parsedIndex }), /requires fetchText\(\)/);
await assert.rejects(
  () => productionBatchLoader(frameIndexes),
  /requires a finite point/
);

console.log('SWIRLS direct point-series sampling validation passed');
