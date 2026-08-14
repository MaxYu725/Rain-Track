import assert from 'node:assert/strict';
import { FORECAST_MAP_CONTRACT, compactForecastGrid, normalizeNowcastPayload } from '../js/forecast-map-data.js';

function makeFixture({ omit = null, duplicate = null, includeLeadMinutes = true } = {}) {
  const issue = new Date('2026-08-14T07:00:00+08:00');
  const latitudes = Array.from({ length:6 }, (_, index) => Number((22.20 + index * 0.02).toFixed(6)));
  const longitudes = Array.from({ length:6 }, (_, index) => Number((114.10 + index * 0.02).toFixed(6)));
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
      stepLat:0.02,
      stepLon:0.02,
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
