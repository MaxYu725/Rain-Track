import assert from 'node:assert/strict';
import {
  SWIRLS_SNAPSHOT_MAX_AGE_MINUTES,
  buildCompleteSwirlsSnapshot,
  buildPointSeriesFromSnapshot,
  snapshotBuildAgeMinutes,
  snapshotIsFresh,
  snapshotSourceAgeMinutes,
} from '../swirls-snapshot.js';
import { SWIRLS_RAW_CONTRACT } from '../swirls-data.js';

const runTime = '2026-08-19T01:00:00.000Z';
const grid = buildGrid();
const frames = Array.from({ length: SWIRLS_RAW_CONTRACT.frameCount }, (_, index) => {
  const leadMinutes = SWIRLS_RAW_CONTRACT.firstLeadMinutes + index * SWIRLS_RAW_CONTRACT.cadenceMinutes;
  const validTime = new Date(Date.parse(runTime) + leadMinutes * 60_000).toISOString();
  return {
    frameIndex: index,
    runTime,
    validTime,
    leadMinutes,
    windowStart: new Date(Date.parse(validTime) - SWIRLS_RAW_CONTRACT.accumulationMinutes * 60_000).toISOString(),
    windowEnd: validTime,
    unit: SWIRLS_RAW_CONTRACT.unit,
    grid,
    values: Array.from({ length: SWIRLS_RAW_CONTRACT.cellCount }, () => index / 10),
  };
});

const runtime = {
  async loadFrame(index) {
    return frames[index];
  },
};

const builtAt = new Date('2026-08-19T01:05:00.000Z');
const snapshot = await buildCompleteSwirlsSnapshot({ runtime, maxConcurrent: 3, now: () => builtAt });
assert.equal(snapshot.frames.length, 16);
assert.equal(snapshot.runTime, runTime);
assert.equal(snapshot.builtAt, builtAt.toISOString());
assert.equal(snapshot.grid.rows, 121);
assert.equal(snapshot.frames[15].leadMinutes, 120);
assert.equal(snapshot.frames[15].values.length, SWIRLS_RAW_CONTRACT.cellCount);

const series = buildPointSeriesFromSnapshot(snapshot, 22.4075, 114.1235);
assert.equal(series.sampleCount, 16);
assert.deepEqual(series.samples.map(sample => sample.leadMinutes), Array.from({ length: 16 }, (_, index) => 30 + index * 6));
assert.equal(series.samples[0].accumulationMm, 0);
assert.equal(series.samples[15].accumulationMm, 1.5);

const sourcePlus17 = Date.parse(runTime) + 17 * 60_000;
const sourcePlus18 = Date.parse(runTime) + SWIRLS_SNAPSHOT_MAX_AGE_MINUTES * 60_000;
const sourcePlus19 = Date.parse(runTime) + 19 * 60_000;
assert.equal(snapshotIsFresh(snapshot, sourcePlus17), true);
assert.equal(snapshotIsFresh(snapshot, sourcePlus18), true);
assert.equal(snapshotIsFresh(snapshot, sourcePlus19), false);
assert.equal(snapshotSourceAgeMinutes(snapshot, sourcePlus17), 17);
assert.equal(snapshotBuildAgeMinutes(snapshot, sourcePlus17), 12);

// Rebuilding an unchanged old HKO run must not reset its freshness clock.
const rebuiltOldRun = await buildCompleteSwirlsSnapshot({
  runtime,
  maxConcurrent: 3,
  now: () => new Date('2026-08-19T02:00:00.000Z'),
});
assert.equal(snapshotIsFresh(rebuiltOldRun, Date.parse('2026-08-19T02:00:00.000Z')), false);
assert.equal(snapshotBuildAgeMinutes(rebuiltOldRun, Date.parse('2026-08-19T02:00:00.000Z')), 0);
assert.equal(snapshotSourceAgeMinutes(rebuiltOldRun, Date.parse('2026-08-19T02:00:00.000Z')), 60);

await assert.rejects(
  buildCompleteSwirlsSnapshot({
    runtime: {
      async loadFrame(index) {
        return index === 8 ? { ...frames[index], runTime: '2026-08-19T01:06:00.000Z' } : frames[index];
      },
    },
  }),
  /mixed runs/,
);

assert.throws(
  () => buildPointSeriesFromSnapshot({ ...snapshot, frames: snapshot.frames.slice(0, 15) }, 22.4, 114.1),
  /incomplete/,
);

console.log('SWIRLS prebuilt snapshot validation passed');

function buildGrid() {
  const rows = SWIRLS_RAW_CONTRACT.rows;
  const cols = SWIRLS_RAW_CONTRACT.cols;
  const minLat = SWIRLS_RAW_CONTRACT.coverage.minLat;
  const maxLat = SWIRLS_RAW_CONTRACT.coverage.maxLat;
  const minLon = SWIRLS_RAW_CONTRACT.coverage.minLon;
  const maxLon = SWIRLS_RAW_CONTRACT.coverage.maxLon;
  const stepLat = (maxLat - minLat) / (rows - 1);
  const stepLon = (maxLon - minLon) / (cols - 1);
  return {
    rows,
    cols,
    cellCount: rows * cols,
    orientation: SWIRLS_RAW_CONTRACT.orientation,
    latitudes: Array.from({ length: rows }, (_, index) => maxLat - index * stepLat),
    longitudes: Array.from({ length: cols }, (_, index) => minLon + index * stepLon),
    stepLat,
    stepLon,
    bounds: { north: maxLat, south: minLat, east: maxLon, west: minLon },
  };
}
