import assert from 'node:assert/strict';

const CONTRACT = Object.freeze({
  version: '1.0',
  unit: 'mm / 30 min',
  horizonMinutes: 120,
  nominalLeadMinutes: [30, 60, 90, 120],
  orientation: 'row-major-north-to-south-west-to-east'
});

function key(lat, lon) {
  return `${Number(lat).toFixed(6)}|${Number(lon).toFixed(6)}`;
}

function compactForecastGrid({ issueTime, latitudes, longitudes, frames }) {
  const northToSouth = [...latitudes].sort((a, b) => b - a);
  const westToEast = [...longitudes].sort((a, b) => a - b);
  const rows = northToSouth.length;
  const cols = westToEast.length;
  const expectedCellCount = rows * cols;
  const coordinateKeys = northToSouth.flatMap(lat => westToEast.map(lon => key(lat, lon)));

  const compactFrames = frames
    .filter(frame => Number.isFinite(frame.leadMinutes)
      && frame.leadMinutes > 0
      && frame.leadMinutes <= CONTRACT.horizonMinutes)
    .sort((a, b) => a.leadMinutes - b.leadMinutes)
    .map((frame, index) => {
      const pointIndex = new Map(frame.points.map(([lat, lon, value]) => [key(lat, lon), Number(value)]));
      let missingValueCount = 0;
      const values = coordinateKeys.map(cellKey => {
        const value = pointIndex.get(cellKey);
        if (!Number.isFinite(value)) {
          missingValueCount += 1;
          return null;
        }
        return value;
      });
      return {
        index,
        time: frame.time,
        leadMinutes: frame.leadMinutes,
        values,
        diagnostics: {
          sourcePointCount: frame.points.length,
          uniquePointCount: pointIndex.size,
          valueCount: values.length,
          missingValueCount
        }
      };
    });

  const leadSet = new Set(compactFrames.map(frame => frame.leadMinutes));
  const expectedLeadMinutesPresent = CONTRACT.nominalLeadMinutes.every(lead => leadSet.has(lead));
  const completeFrames = compactFrames.length > 0 && compactFrames.every(frame =>
    frame.diagnostics.uniquePointCount === expectedCellCount
      && frame.diagnostics.valueCount === expectedCellCount
      && frame.diagnostics.missingValueCount === 0
  );

  return {
    contractVersion: CONTRACT.version,
    issueTime,
    unit: CONTRACT.unit,
    horizonMinutes: CONTRACT.horizonMinutes,
    grid: {
      rows,
      cols,
      orientation: CONTRACT.orientation,
      latitudes: northToSouth,
      longitudes: westToEast
    },
    frames: compactFrames,
    validation: {
      completeFrames,
      expectedLeadMinutesPresent,
      nominalLeadMinutes: CONTRACT.nominalLeadMinutes,
      readyForOverlay: rows > 1 && cols > 1 && completeFrames && expectedLeadMinutesPresent
    }
  };
}

function makeFixture({ omit = null } = {}) {
  const issue = new Date('2026-08-14T07:00:00+08:00');
  const latitudes = Array.from({ length: 6 }, (_, index) => 22.20 + index * 0.02);
  const longitudes = Array.from({ length: 6 }, (_, index) => 114.10 + index * 0.02);
  const frames = CONTRACT.nominalLeadMinutes.map(leadMinutes => {
    const time = new Date(issue.getTime() + leadMinutes * 60_000).toISOString();
    const points = [];
    for (let latIndex = 0; latIndex < latitudes.length; latIndex += 1) {
      for (let lonIndex = 0; lonIndex < longitudes.length; lonIndex += 1) {
        if (omit && omit.leadMinutes === leadMinutes && omit.latIndex === latIndex && omit.lonIndex === lonIndex) continue;
        const value = leadMinutes / 30 + latIndex / 10 + lonIndex / 100;
        points.push([latitudes[latIndex], longitudes[lonIndex], value]);
      }
    }
    return { time, leadMinutes, points };
  });
  return { issueTime: issue.toISOString(), latitudes, longitudes, frames };
}

const valid = compactForecastGrid(makeFixture());
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

// North-to-south, west-to-east: first value must be max-lat/min-lon,
// last value must be min-lat/max-lon for the deterministic fixture.
assert.equal(valid.frames[0].values[0], 1.5);
assert.equal(valid.frames[0].values.at(-1), 1.05);

const incomplete = compactForecastGrid(makeFixture({ omit: { leadMinutes: 60, latIndex: 2, lonIndex: 3 } }));
assert.equal(incomplete.validation.completeFrames, false);
assert.equal(incomplete.validation.readyForOverlay, false);
assert.equal(incomplete.frames[1].diagnostics.missingValueCount, 1);

const missingLeadFixture = makeFixture();
missingLeadFixture.frames = missingLeadFixture.frames.filter(frame => frame.leadMinutes !== 90);
const missingLead = compactForecastGrid(missingLeadFixture);
assert.equal(missingLead.validation.expectedLeadMinutesPresent, false);
assert.equal(missingLead.validation.readyForOverlay, false);

console.log('Forecast map contract gate PASS');
