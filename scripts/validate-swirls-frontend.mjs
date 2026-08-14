import assert from 'node:assert/strict';
import { SWIRLS_FORECAST_CONTRACT, assertSwirlsFrameCompatible, buildSwirlsForecast, normalizeSwirlsFramePayload } from '../js/forecast-map-swirls.js';
import { forecastWindow, validateRasterFrame } from '../js/forecast-map-renderer.js';

function isoFromRun(runTime, minutes) {
  return new Date(Date.parse(runTime) + minutes * 60_000).toISOString();
}

function syntheticFrame(frameIndex, runTime = '2026-08-14T03:18:00.000Z') {
  const leadMinutes = SWIRLS_FORECAST_CONTRACT.firstLeadMinutes + frameIndex * SWIRLS_FORECAST_CONTRACT.cadenceMinutes;
  const validTime = isoFromRun(runTime, leadMinutes);
  return {
    ok:true,
    version:'2.5.0',
    frameIndex,
    runTime,
    validTime,
    leadMinutes,
    windowStart:isoFromRun(runTime, leadMinutes - SWIRLS_FORECAST_CONTRACT.accumulationMinutes),
    windowEnd:validTime,
    unit:SWIRLS_FORECAST_CONTRACT.unit,
    grid:{
      rows:121,
      cols:121,
      cellCount:14641,
      orientation:SWIRLS_FORECAST_CONTRACT.orientation,
      latitudes:Array.from({ length:121 }, (_, index) => 23.487 - index * 0.018),
      longitudes:Array.from({ length:121 }, (_, index) => 112.956 + index * 0.019),
      stepLat:0.018,
      stepLon:0.019,
      bounds:{ north:23.496, south:21.319, east:115.3005, west:112.9465 }
    },
    values:Array.from({ length:14641 }, (_, index) => index % 97 === 0 ? 0.5 : 0),
    validation:{ ready:true, runTimeMatchesIndex:true }
  };
}

const first = normalizeSwirlsFramePayload(syntheticFrame(0));
assert.equal(first.frameIndex, 0);
assert.equal(first.leadMinutes, 30);
assert.equal(first.values.length, 14641);
validateRasterFrame(first, first.grid);

const forecast = buildSwirlsForecast(first);
assert.equal(forecast.source, 'swirls');
assert.equal(forecast.frames.length, 16);
assert.deepEqual(forecast.frames.map(frame => frame.leadMinutes), [30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120]);
assert.equal(forecast.frames[0].loaded, true);
assert.ok(forecast.frames.slice(1).every(frame => frame.loaded === false && frame.values === null));
assert.equal(forecast.frames.at(-1).time, isoFromRun(first.runTime, 120));
assert.deepEqual(forecastWindow(forecast.frames[1]), {
  start:isoFromRun(first.runTime, 6),
  end:isoFromRun(first.runTime, 36)
});

const last = normalizeSwirlsFramePayload(syntheticFrame(15));
assert.equal(assertSwirlsFrameCompatible(forecast, last), true);
validateRasterFrame(last, last.grid);

assert.throws(() => normalizeSwirlsFramePayload({ ...syntheticFrame(1), leadMinutes:35 }), /lead time/);
assert.throws(() => normalizeSwirlsFramePayload({ ...syntheticFrame(1), values:[0] }), /values/);
assert.throws(() => assertSwirlsFrameCompatible(forecast, normalizeSwirlsFramePayload(syntheticFrame(1, '2026-08-14T03:24:00.000Z'))), /run time/);

console.log('SWIRLS frontend 6-minute forecast gate PASS');
