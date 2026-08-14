import assert from 'node:assert/strict';
import { compactForecastGrid } from '../js/forecast-map-data.js';
import { forecastWindow, rainfallToRgba, rasterizeForecastFrame, validateRasterFrame } from '../js/forecast-map-renderer.js';

const issue = new Date('2026-08-14T07:00:00+08:00');
const latitudes = [22.20, 22.22, 22.24];
const longitudes = [114.10, 114.12, 114.14, 114.16];
const valuesByLead = new Map([
  [30, [0, 0.04, 0.05, 0.19, 0.2, 0.49, 0.5, 0.99, 1, 1.99, 2, 10]],
  [60, Array(12).fill(0.1)],
  [90, Array(12).fill(1.5)],
  [120, Array(12).fill(5.5)]
]);

const frames = [30, 60, 90, 120].map(leadMinutes => {
  const points = [];
  const sourceValues = valuesByLead.get(leadMinutes);
  let index = 0;
  for (const lat of latitudes) {
    for (const lon of longitudes) {
      points.push([lat, lon, sourceValues[index] ?? 0]);
      index += 1;
    }
  }
  return {
    time:new Date(issue.getTime() + leadMinutes * 60_000).toISOString(),
    leadMinutes,
    points
  };
});

const compact = compactForecastGrid({
  issueTime:issue.toISOString(),
  grid:{ minLat:22.20, maxLat:22.24, minLon:114.10, maxLon:114.16, stepLat:0.02, stepLon:0.02 },
  frames
});
assert.equal(compact.validation.readyForOverlay, true);

const raster = rasterizeForecastFrame(compact.frames[0], compact.grid);
assert.equal(raster.width, 4);
assert.equal(raster.height, 3);
assert.equal(raster.rgba.length, 48);
assert.equal(raster.wetCellCount, 10);
assert.equal(raster.dryCellCount, 2);
assert.equal(raster.maxMm, 10);

assert.deepEqual(rainfallToRgba(0), [0,0,0,0]);
assert.deepEqual(rainfallToRgba(0.049), [0,0,0,0]);
assert.deepEqual(rainfallToRgba(0.05), [36,162,214,210]);
assert.deepEqual(rainfallToRgba(0.2), [34,187,214,220]);
assert.deepEqual(rainfallToRgba(0.5), [41,199,104,225]);
assert.deepEqual(rainfallToRgba(1), [111,207,58,230]);
assert.deepEqual(rainfallToRgba(2), [232,204,50,235]);
assert.deepEqual(rainfallToRgba(5), [246,147,45,240]);
assert.deepEqual(rainfallToRgba(10), [235,72,58,245]);
assert.deepEqual(rainfallToRgba(Number.NaN), [0,0,0,0]);

const firstPixel = [...raster.rgba.slice(0, 4)];
// compactForecastGrid reverses latitude rows (north→south), so the first pixel
// comes from the source fixture's northernmost latitude row.
assert.deepEqual(firstPixel, rainfallToRgba(1));

const window = forecastWindow(compact.frames[0]);
assert.equal(window.start, '2026-08-13T23:00:00.000Z');
assert.equal(window.end, '2026-08-13T23:30:00.000Z');
assert.equal(forecastWindow({ time:'invalid' }), null);

assert.throws(() => validateRasterFrame({ values:[0] }, { rows:2, cols:2 }), /數量不符/);
assert.throws(() => rasterizeForecastFrame({ values:[0, 0, -1, 0] }, { rows:2, cols:2 }), /無效雨量值/);
assert.throws(() => rasterizeForecastFrame({ values:Array(40001).fill(0) }, { rows:201, cols:199 }), /數量過大/);

console.log('Forecast map renderer gate PASS');
