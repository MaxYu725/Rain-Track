import assert from 'node:assert/strict';
import {
  buildSwirlsPointSeries,
  loadSwirlsPointSeries,
  sampleFrameAtPoint,
} from '../swirls-point-series.js';

const frames = Array.from({ length: 16 }, (_, index) => makeFrame(index));

const center = sampleFrameAtPoint(frames[0], 22, 114);
assert.equal(center.value, 0.15, 'bilinear center should average four corners');
assert.equal(center.spatialSpreadMm, 0.3, 'spatial spread should preserve corner range');

const direct = buildSwirlsPointSeries({ frames, latitude: 22, longitude: 114 });
assert.equal(direct.sampleCount, 16);
assert.equal(direct.samples[0].leadMinutes, 30);
assert.equal(direct.samples.at(-1).leadMinutes, 120);
assert.equal(direct.samples[0].accumulationMm, 0.15);
assert.equal(direct.samples[5].accumulationMm, 0.65);
assert.equal(direct.cadenceMinutes, 6);
assert.equal(direct.accumulationMinutes, 30);
assert.equal(direct.unit, 'mm / 30 min');
assert.equal(direct.interpolation, 'bilinear-four-grid-points');
assert.ok(!JSON.stringify(direct).includes('"values"'), 'compact response must not include frame grids');
assert.ok(!JSON.stringify(direct).includes('"latitudes"'), 'compact response must not include grid axes');

const calls = [];
const runtime = {
  async loadFrame(index, options) {
    calls.push({ index, bypassCache: options?.bypassCache === true });
    return frames[index];
  },
};
const loaded = await loadSwirlsPointSeries({
  runtime,
  latitude: 22,
  longitude: 114,
  maxConcurrent: 4,
});
assert.equal(loaded.sampleCount, 16);
assert.equal(calls.length, 16, 'normal load should fetch each frame once');
assert.ok(calls.every(call => !call.bypassCache));

const mixed = frames.map(frame => ({ ...frame }));
mixed[15] = { ...mixed[15], runTime: '2026-08-19T00:06:00.000Z' };
assert.throws(
  () => buildSwirlsPointSeries({ frames: mixed, latitude: 22, longitude: 114 }),
  /mixed SWIRLS run/,
);

await assert.rejects(
  () => loadSwirlsPointSeries({ runtime, latitude: 30, longitude: 114 }),
  /outside the SWIRLS coverage/,
);

console.log('SWIRLS compact point-series validation passed');

function makeFrame(index) {
  const base = index * 0.1;
  const valid = new Date(Date.UTC(2026, 7, 18, 12, 30 + index * 6)).toISOString();
  return {
    frameIndex: index,
    runTime: '2026-08-18T12:00:00.000Z',
    validTime: valid,
    leadMinutes: 30 + index * 6,
    windowStart: new Date(Date.parse(valid) - 30 * 60_000).toISOString(),
    windowEnd: valid,
    unit: 'mm / 30 min',
    grid: {
      rows: 2,
      cols: 2,
      latitudes: [23, 21],
      longitudes: [113, 115],
    },
    values: [base, base + 0.1, base + 0.2, base + 0.3],
  };
}
