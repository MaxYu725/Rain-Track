import assert from 'node:assert/strict';
import { FORECAST_MAP_CONTRACT, compactForecastGrid, normalizeNowcastPayload } from '../js/forecast-map-data.js';

function makeFixture({ omit = null, duplicate = null, includeLeadMinutes = true, irregularAxes = false } = {}) {
  const issue = new Date('2026-08-14T07:00:00+08:00');
  const latitudes = irregularAxes
    ? [22.200, 22.219, 22.239, 22.258, 22.278, 22.297]
    : Array.from({ length:6 }, (_, index) => Number((22.20 + index * 0.02).toFixed(6)));
  const longitudes = irregularAxes
    ? [114.100, 114.120, 114.139, 114.159, 114.178, 114.198]
    : Array.from({ length:6 }, (_, index) => Number((114.10 + index * 0.02).toFixed(6)));
  const frames = FORECAST_MAP_CONTRACT.nominalLeadMinutes.map(leadMinutes => {
    const time = new Date(issue.getTime() + leadMinutes * 60_000).toISOString();
    const points = [];
    for (let latIndex = 0; latIndex < latitudes.length; latIndex += 1) {
      for (let lonIndex = 0; lonIndex < longitudes.length; lonIndex += 1) {
        if (omit && omit.leadMinutes === leadMinutes && omit.latIndex === latIndex && omit.lonIndex === lonIndex) continue;
        const value = leadMinutes / 30 + latIndex / 10 + lonIndex / 100;
        points.push([latitudes[latIndex], longitudes[lonIndex], value]);
        if (duplicate && duplicate.leadMinutes === leadMinutes && duplicate.latIndex === latIndex && duplicate.lonIndex === lonIndex) {
          points.push([latitudes[latIndex], longitudes[lonIndex], value]);
        }
      }
    }
    return { time, ...(includeLeadMinutes ? { leadMinutes } : {}), points };
  });
  return {
    ok:true,
    issueTime:issue.toISOString(),
    unit:'mm / 30 min',
    grid:{
      // Worker metadata exposes the minimum positive geographic step. HKO's
      // three-decimal coordinates can alternate between 0.019 and 0.020 degrees,
      // so this value must never be used to synthesize the coordinate axis.
      stepLat:irregularAxes ? 0.019 : 0.02,
      stepLon:irregularAxes ? 0.019 : 0.02,
      minLat:latitudes[0],
      maxLat:latitudes.at(-1),
      minLon:longitudes[0],
      maxLon:longitudes.at(-1)
    },
    frames
  };
}

const valid = normalizeNowcastPayload(makeFixture());
assert.equal(valid.contractVersion, '1.0');
assert.equal(valid.unit, 'mm / 30 min');
assert.equal(valid.grid.rows, 6);
assert.equal(valid.grid.cols, 6);
assert.equal(valid.grid.orientation, 'row-major-north-to-south-west-to-east');
assert.deepEqual(valid.frames.map(frame => frame.leadMinutes), [30, 60, 90, 120]);
assert.equal(valid.frames.length, 4);
assert.equal(valid.frames[0].values.length, 36);
assert.equal(valid.validation.completeFrames, true);
assert.equal(valid.validation.expectedLeadMinutesPresent, true);
assert.equal(valid.validation.readyForOverlay, true);
assert.equal(valid.grid.bounds.north, 22.31);
assert.equal(valid.grid.bounds.south, 22.19);
assert.equal(valid.grid.bounds.west, 114.09);
assert.equal(valid.grid.bounds.east, 114.21);

// North-to-south, west-to-east: first value must be max-lat/min-lon,
// last value must be min-lat/max-lon for the deterministic fixture.
assert.equal(valid.frames[0].values[0], 1.5);
assert.equal(valid.frames[0].values.at(-1), 1.05);

// The production adapter must also derive lead times from issue/valid timestamps,
// matching the current /api/rain/nowcast public payload shape if leadMinutes is absent.
const derivedLead = normalizeNowcastPayload(makeFixture({ includeLeadMinutes:false }));
assert.deepEqual(derivedLead.frames.map(frame => frame.leadMinutes), [30, 60, 90, 120]);

// HKO geographic coordinates are rounded to three decimals. Adjacent grid
// coordinates therefore do not have one exact degree step even though the source
// grid itself is complete. Observed point axes must remain authoritative.
const irregular = normalizeNowcastPayload(makeFixture({ irregularAxes:true }));
assert.equal(irregular.grid.rows, 6);
assert.equal(irregular.grid.cols, 6);
assert.equal(irregular.validation.completeFrames, true);
assert.equal(irregular.validation.readyForOverlay, true);
assert.deepEqual(irregular.grid.longitudes, [114.1, 114.12, 114.139, 114.159, 114.178, 114.198]);
assert.deepEqual(irregular.grid.latitudes, [22.297, 22.278, 22.258, 22.239, 22.219, 22.2]);
assert.equal(irregular.grid.stepLat, 0.0194);
assert.equal(irregular.grid.stepLon, 0.0196);
assert.equal(irregular.grid.bounds.south, 22.1905);
assert.equal(irregular.grid.bounds.north, 22.3065);
assert.equal(irregular.grid.bounds.west, 114.09);
assert.equal(irregular.grid.bounds.east, 114.208);

const incompleteFixture = makeFixture({ omit:{ leadMinutes:60, latIndex:2, lonIndex:3 } });
const incomplete = compactForecastGrid(incompleteFixture);
assert.equal(incomplete.validation.completeFrames, false);
assert.equal(incomplete.validation.readyForOverlay, false);
assert.equal(incomplete.frames[1].diagnostics.missingValueCount, 1);
assert.throws(() => normalizeNowcastPayload(incompleteFixture), /格點不完整/);

const duplicateFixture = makeFixture({ duplicate:{ leadMinutes:30, latIndex:1, lonIndex:1 } });
const duplicate = compactForecastGrid(duplicateFixture);
assert.equal(duplicate.frames[0].diagnostics.duplicatePointCount, 1);
assert.equal(duplicate.validation.readyForOverlay, false);
assert.throws(() => normalizeNowcastPayload(duplicateFixture), /格點不完整/);

const missingLeadFixture = makeFixture();
missingLeadFixture.frames = missingLeadFixture.frames.filter(frame => frame.leadMinutes !== 90);
const missingLead = compactForecastGrid(missingLeadFixture);
assert.equal(missingLead.validation.expectedLeadMinutesPresent, false);
assert.equal(missingLead.validation.readyForOverlay, false);
assert.throws(() => normalizeNowcastPayload(missingLeadFixture), /格點不完整/);

console.log('Forecast map contract gate PASS');
