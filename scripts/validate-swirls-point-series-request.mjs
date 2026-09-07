import assert from 'node:assert/strict';
import { parseSwirlsIndex } from '../swirls-data.js';
import { createSwirlsPointSeriesBatchLoader } from '../swirls-point-series-batch.js';
import { createSwirlsPointSeriesRequestHandler } from '../swirls-point-series-request.js';

const runTime = '2026-08-19T12:00:00.000Z';
const frameIndexes = Array.from({ length:16 }, (_, frameIndex) => frameIndex);

function makeFrame(frameIndex) {
  const leadMinutes = 30 + frameIndex * 6;
  const validTime = new Date(Date.parse(runTime) + leadMinutes * 60_000).toISOString();
  return {
    contractVersion:'1.0', frameIndex, runTime, validTime, leadMinutes,
    windowStart:new Date(Date.parse(validTime) - 30 * 60_000).toISOString(),
    windowEnd:validTime, unit:'mm / 30 min',
    grid:{ orientation:'row-major-north-to-south-west-to-east', latitudes:[23,22], longitudes:[113,114], bounds:{ north:23,south:22,west:113,east:114 } },
    values:[frameIndex,frameIndex,frameIndex,frameIndex]
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
  const lats = Array.from({ length:121 }, (_, index) => Number((23.487 - index * 0.01799).toFixed(3)));
  const lons = Array.from({ length:121 }, (_, index) => Number((112.956 + index * 0.01946).toFixed(3)));
  const lines = [`SL-RF  DMO    ${header.year} ${header.month} ${header.day} ${header.hour} ${header.minute}`];
  for (const lat of lats) for (const lon of lons) lines.push(`${lon.toFixed(3)} ${lat.toFixed(3)} 0.500`);
  return lines.join('\n');
}

const completeHandler = createSwirlsPointSeriesRequestHandler({
  loadFrames: async indexes => ({
    index:{ runTime },
    frames:indexes.map(makeFrame),
    failures:[]
  })
});
const complete = await completeHandler(new URL('https://example.test/api/rain/swirls/point-series?lat=22.5&lon=113.5'));
assert.equal(complete.ok, true);
assert.equal(complete.complete, true);
assert.equal(complete.points.length, 16);
assert.deepEqual(complete.missingFrames, []);
assert.equal(complete.points[0].leadMinutes, 30);
assert.equal(complete.points.at(-1).leadMinutes, 120);

const partialHandler = createSwirlsPointSeriesRequestHandler({
  loadFrames: async indexes => ({
    index:{ runTime },
    frames:indexes.map(frameIndex => frameIndex === 7 ? null : makeFrame(frameIndex)),
    failures:[{ frameIndex:7, error:'synthetic failure' }]
  })
});
const partial = await partialHandler(new URL('https://example.test/api/rain/swirls/point-series?lat=22.5&lon=113.5'));
assert.equal(partial.ok, true);
assert.equal(partial.complete, false);
assert.equal(partial.points.length, 15, 'one failed frame must not discard the other 15');
assert.deepEqual(partial.missingFrames, [7]);
assert.equal(partial.points.some(point => point.frameIndex === 7), false);
assert.equal(new Set(partial.points.map(point => point.runTime).filter(Boolean)).size, 0, 'public compact points do not need duplicate runTime fields');

const parsedIndex = parseSwirlsIndex(makeIndex());
const mdl = makeMdl();
let indexCalls = 0;
let mdlStarts = 0;
let releaseAll;
const allStarted = new Promise(resolve => { releaseAll = resolve; });
const pendingResolvers = [];
const productionBatchLoader = createSwirlsPointSeriesBatchLoader({
  loadIndex: async () => { indexCalls += 1; return parsedIndex; },
  fetchText: async (url, options) => {
    assert.match(url, /\.af\.mdl$/);
    assert.equal(options.kind, 'mdl');
    mdlStarts += 1;
    if (mdlStarts === 16) releaseAll();
    await allStarted;
    return new Promise(resolve => pendingResolvers.push(() => resolve({ body:mdl, cacheStatus:null })));
  }
});
const batchPromise = productionBatchLoader(frameIndexes);
await allStarted;
assert.equal(indexCalls, 1, 'point-series must read exactly one index snapshot');
assert.equal(mdlStarts, 16, 'all 16 MDL tasks must start without manual batch throttling');
while (pendingResolvers.length < 16) await new Promise(resolve => setTimeout(resolve, 0));
pendingResolvers.splice(0).forEach(resolve => resolve());
const productionBatch = await batchPromise;
assert.equal(productionBatch.frames.length, 16);
assert.equal(productionBatch.failures.length, 0);
assert.deepEqual(productionBatch.frames.map(frame => frame.frameIndex), frameIndexes);
assert.equal(new Set(productionBatch.frames.map(frame => frame.runTime)).size, 1, 'all successful frames must share the single index snapshot run');

let failedIndexCalls = 0;
const oneFailureLoader = createSwirlsPointSeriesBatchLoader({
  loadIndex: async () => { failedIndexCalls += 1; return parsedIndex; },
  fetchText: async (url, options) => {
    if (options.frameIndex === 5) throw new Error('frame 5 failed');
    return { body:mdl };
  }
});
const oneFailure = await oneFailureLoader(frameIndexes);
assert.equal(failedIndexCalls, 1);
assert.equal(oneFailure.frames.filter(Boolean).length, 15);
assert.equal(oneFailure.frames[5], null);
assert.deepEqual(oneFailure.failures.map(item => item.frameIndex), [5]);

await assert.rejects(
  () => completeHandler(new URL('https://example.test/api/rain/swirls/point-series?lat=30&lon=113.5')),
  error => error?.status === 422
);
assert.throws(() => createSwirlsPointSeriesRequestHandler({}), /requires loadFrames\(frameIndexes\)/);
assert.throws(() => createSwirlsPointSeriesBatchLoader({ loadIndex:async () => parsedIndex }), /requires fetchText\(\)/);

console.log('SWIRLS zero-base point-series validation passed');
