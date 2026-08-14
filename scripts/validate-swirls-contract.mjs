import assert from 'node:assert/strict';
import {
  SWIRLS_RAW_CONTRACT,
  bindSwirlsMdlFrame,
  parseSwirlsIndex,
  parseSwirlsMdl
} from '../swirls-data.js';

function makeAxis(min, max, count) {
  return Array.from({ length: count }, (_, index) => {
    const value = min + ((max - min) * index) / (count - 1);
    return Number(value.toFixed(3));
  });
}

function compactHkt(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

function makeIndexFixture({ runIso = '2026-08-14T10:00:00+08:00', assetMinute = null } = {}) {
  const run = new Date(runIso);
  const minute = assetMinute ?? compactHkt(run).slice(-2);
  return Array.from({ length: SWIRLS_RAW_CONTRACT.frameCount }, (_, frameIndex) => {
    const valid = new Date(run.getTime() + (SWIRLS_RAW_CONTRACT.firstLeadMinutes + frameIndex * SWIRLS_RAW_CONTRACT.cadenceMinutes) * 60_000);
    return `${compactHkt(valid)},ncrf_minute${minute}_${frameIndex}.png,ncrf_minute${minute}_${frameIndex}.af.mdl`;
  }).join('\n');
}

function makeMdlFixture({ omitLast = false, negativeAt = null, browserWrapped = false, runMinute = '00' } = {}) {
  const lons = makeAxis(SWIRLS_RAW_CONTRACT.coverage.minLon, SWIRLS_RAW_CONTRACT.coverage.maxLon, SWIRLS_RAW_CONTRACT.cols);
  const lats = makeAxis(SWIRLS_RAW_CONTRACT.coverage.minLat, SWIRLS_RAW_CONTRACT.coverage.maxLat, SWIRLS_RAW_CONTRACT.rows).reverse();
  const lines = [`SL-RF  DMO    2026 08 14 10 ${runMinute}`];

  let cellIndex = 0;
  for (const lat of lats) {
    for (const lon of lons) {
      if (omitLast && cellIndex === SWIRLS_RAW_CONTRACT.cellCount - 1) {
        cellIndex += 1;
        continue;
      }
      let rainfall = Number((((lon - 112) * 0.17 + (24 - lat) * 0.31 + (cellIndex % 17) * 0.013) % 50).toFixed(3));
      if (negativeAt === cellIndex) rainfall = -0.5;
      lines.push(`${lon.toFixed(3).padStart(10)} ${lat.toFixed(3).padStart(10)} ${rainfall.toFixed(3).padStart(10)}`);
      cellIndex += 1;
    }
  }

  const raw = lines.join('\n');
  return browserWrapped
    ? `<!-- saved from url=(0014)about:internet --><html><head></head><body>${raw}</body></html>`
    : raw;
}

const index = parseSwirlsIndex(makeIndexFixture());
assert.equal(index.contractVersion, '1.0');
assert.equal(index.frameCount, 16);
assert.equal(index.cadenceMinutes, 6);
assert.equal(index.accumulationMinutes, 30);
assert.equal(index.unit, 'mm / 30 min');
assert.equal(index.assetMinute, '00');
assert.equal(index.inferredRunTime, '2026-08-14T02:00:00.000Z');
assert.equal(index.frames[0].frameIndex, 0);
assert.equal(index.frames[0].assetMinute, '00');
assert.equal(index.frames[0].validTime, '2026-08-14T02:30:00.000Z');
assert.equal(index.frames[0].leadMinutes, 30);
assert.equal(index.frames[0].windowStart, '2026-08-14T02:00:00.000Z');
assert.equal(index.frames[0].windowEnd, '2026-08-14T02:30:00.000Z');
assert.equal(index.frames[1].validTime, '2026-08-14T02:36:00.000Z');
assert.equal(index.frames[1].windowStart, '2026-08-14T02:06:00.000Z');
assert.equal(index.frames.at(-1).validTime, '2026-08-14T04:00:00.000Z');
assert.equal(index.frames.at(-1).leadMinutes, 120);

// Live HKO asset names follow the six-minute run minute. A 10:30 run uses
// ncrf_minute30_N.* while preserving the same 16-frame / 6-minute contract.
const index30 = parseSwirlsIndex(makeIndexFixture({ runIso: '2026-08-14T10:30:00+08:00' }));
assert.equal(index30.assetMinute, '30');
assert.equal(index30.inferredRunTime, '2026-08-14T02:30:00.000Z');
assert.equal(index30.frames[0].validTime, '2026-08-14T03:00:00.000Z');
assert.equal(index30.frames.at(-1).validTime, '2026-08-14T04:30:00.000Z');

const mdl = parseSwirlsMdl(makeMdlFixture());
assert.equal(mdl.contractVersion, '1.0');
assert.equal(mdl.runTime, '2026-08-14T02:00:00.000Z');
assert.equal(mdl.unit, 'mm / 30 min');
assert.equal(mdl.grid.rows, 121);
assert.equal(mdl.grid.cols, 121);
assert.equal(mdl.grid.cellCount, 14641);
assert.equal(mdl.values.length, 14641);
assert.equal(mdl.grid.orientation, 'row-major-north-to-south-west-to-east');
assert.equal(mdl.grid.latitudes[0], 23.487);
assert.equal(mdl.grid.latitudes.at(-1), 21.328);
assert.equal(mdl.grid.longitudes[0], 112.956);
assert.equal(mdl.grid.longitudes.at(-1), 115.291);
assert.equal(mdl.grid.stepLat, 0.017992);
assert.equal(mdl.grid.stepLon, 0.019458);
assert.equal(mdl.validation.completeGrid, true);
assert.equal(mdl.validation.orientationValid, true);
assert.equal(mdl.validation.ready, true);

// Browser "Save page" can wrap the raw .mdl in a tiny HTML shell. The parser
// accepts that diagnostic form while production Worker fetches remain raw text.
const browserSaved = parseSwirlsMdl(makeMdlFixture({ browserWrapped: true }));
assert.equal(browserSaved.validation.ready, true);
assert.equal(browserSaved.runTime, mdl.runTime);

const frame0 = bindSwirlsMdlFrame(index, 0, makeMdlFixture());
assert.equal(frame0.runTime, '2026-08-14T02:00:00.000Z');
assert.equal(frame0.validTime, '2026-08-14T02:30:00.000Z');
assert.equal(frame0.windowStart, '2026-08-14T02:00:00.000Z');
assert.equal(frame0.windowEnd, '2026-08-14T02:30:00.000Z');
assert.equal(frame0.validation.runTimeMatchesIndex, true);

// Frame 1 shares the same model run/base time but has a valid window shifted
// six minutes later: 10:06-10:36 HKT. This prevents treating the MDL header as
// a per-frame valid timestamp.
const frame1 = bindSwirlsMdlFrame(index, 1, makeMdlFixture());
assert.equal(frame1.runTime, frame0.runTime);
assert.equal(frame1.validTime, '2026-08-14T02:36:00.000Z');
assert.equal(frame1.windowStart, '2026-08-14T02:06:00.000Z');
assert.equal(frame1.leadMinutes, 36);

assert.throws(() => parseSwirlsMdl(makeMdlFixture({ omitLast: true })), /grid incomplete/);
assert.throws(() => parseSwirlsMdl(makeMdlFixture({ negativeAt: 100 })), /invalid grid point/);
assert.throws(() => bindSwirlsMdlFrame(index, 0, makeMdlFixture({ runMinute: '06' })), /run time mismatch/);

const badCadence = makeIndexFixture().split('\n');
badCadence[1] = badCadence[1].replace(/^202608141036/, '202608141037');
assert.throws(() => parseSwirlsIndex(badCadence.join('\n')), /cadence mismatch/);

const mismatchedAsset = makeIndexFixture().split('\n');
mismatchedAsset[3] = mismatchedAsset[3].replace('ncrf_minute00_3.af.mdl', 'ncrf_minute00_4.af.mdl');
assert.throws(() => parseSwirlsIndex(mismatchedAsset.join('\n')), /asset indices disagree/);

const changedAssetMinute = makeIndexFixture().split('\n');
changedAssetMinute[8] = changedAssetMinute[8].replace(/minute00/g, 'minute06');
assert.throws(() => parseSwirlsIndex(changedAssetMinute.join('\n')), /asset minute changes/);

assert.throws(
  () => parseSwirlsIndex(makeIndexFixture({ assetMinute: '30' })),
  /asset minute 30 does not match inferred run minute 00/
);
assert.throws(
  () => parseSwirlsIndex(makeIndexFixture().replace(/minute00/g, 'minute05')),
  /unexpected asset names/
);

const missingFrame = makeIndexFixture().split('\n').slice(0, -1).join('\n');
assert.throws(() => parseSwirlsIndex(missingFrame), /expected 16 frames/);

console.log('SWIRLS raw feed contract gate PASS');
