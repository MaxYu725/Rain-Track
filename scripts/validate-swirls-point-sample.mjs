import assert from 'node:assert/strict';
import { sampleSwirlsPoint } from '../swirls-point-sample.js';
import { SWIRLS_RAW_CONTRACT } from '../swirls-data.js';

function frame(values = [10, 20, 30, 40]) {
  return {
    frameIndex: 3,
    runTime: '2026-08-14T02:00:00.000Z',
    validTime: '2026-08-14T02:48:00.000Z',
    leadMinutes: 48,
    windowStart: '2026-08-14T02:18:00.000Z',
    windowEnd: '2026-08-14T02:48:00.000Z',
    unit: 'mm / 30 min',
    grid: {
      rows: 2,
      cols: 2,
      orientation: SWIRLS_RAW_CONTRACT.orientation,
      latitudes: [2, 1],
      longitudes: [100, 101],
      bounds: { south: 0.5, north: 2.5, west: 99.5, east: 101.5 }
    },
    values
  };
}

const center = sampleSwirlsPoint(frame(), 1.5, 100.5);
assert.equal(center.amountMm, 25);
assert.equal(center.frameIndex, 3);
assert.equal(center.validTime, '2026-08-14T02:48:00.000Z');
assert.equal(center.leadMinutes, 48);
assert.equal(center.windowStart, '2026-08-14T02:18:00.000Z');
assert.equal(center.windowEnd, '2026-08-14T02:48:00.000Z');
assert.equal(center.cadenceMinutes, 6);
assert.equal(center.accumulationMinutes, 30);
assert.equal(center.unit, 'mm / 30 min');
assert.equal(center.interpolation, 'bilinear-grid-centres');
assert.equal(center.clampedToGridCentreBoundary, false);

assert.equal(sampleSwirlsPoint(frame(), 2, 100).amountMm, 10);
assert.equal(sampleSwirlsPoint(frame(), 2, 101).amountMm, 20);
assert.equal(sampleSwirlsPoint(frame(), 1, 100).amountMm, 30);
assert.equal(sampleSwirlsPoint(frame(), 1, 101).amountMm, 40);

const edge = sampleSwirlsPoint(frame(), 0.75, 100.5);
assert.equal(edge.amountMm, 35);
assert.equal(edge.clampedToGridCentreBoundary, true);

assert.throws(() => sampleSwirlsPoint(frame(), 3, 100), /outside frame coverage/);
assert.throws(() => sampleSwirlsPoint(frame([10, 20, 30, Number.NaN]), 1.5, 100.5), /non-finite grid value/);
assert.throws(() => sampleSwirlsPoint({ ...frame(), grid: { ...frame().grid, orientation: 'unexpected' } }, 1.5, 100.5), /unexpected grid orientation/);

console.log('SWIRLS single-frame point sample gate PASS');
