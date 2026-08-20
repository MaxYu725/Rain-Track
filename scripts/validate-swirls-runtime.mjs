import assert from 'node:assert/strict';
import { SWIRLS_RAW_CONTRACT } from '../swirls-data.js';
import { createSwirlsRuntime, summarizeFrame } from '../swirls-worker-runtime.js';

function compactHkt(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Hong_Kong', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' })
    .formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]:part.value }), {});
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

function makeIndex(runIso = '2026-08-14T02:00:00.000Z') {
  const run = new Date(runIso);
  const assetMinute = compactHkt(run).slice(-2);
  return Array.from({ length:SWIRLS_RAW_CONTRACT.frameCount }, (_, frameIndex) => {
    const valid = new Date(run.getTime() + (30 + frameIndex * 6) * 60_000);
    return `${compactHkt(valid)},ncrf_minute${assetMinute}_${frameIndex}.png,ncrf_minute${assetMinute}_${frameIndex}.af.mdl`;
  }).join('\n');
}

function makeMdl(runIso = '2026-08-14T02:00:00.000Z', offset = 0) {
  const run = new Date(runIso);
  const header = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Hong_Kong', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' })
    .formatToParts(run).reduce((acc, part) => ({ ...acc, [part.type]:part.value }), {});
  const lats = Array.from({ length:121 }, (_, index) => Number((23.487 - index * 0.01799).toFixed(3)));
  const lons = Array.from({ length:121 }, (_, index) => Number((112.956 + index * 0.01946).toFixed(3)));
  const lines = [`SL-RF  DMO    ${header.year} ${header.month} ${header.day} ${header.hour} ${header.minute}`];
  for (let latIndex = 0; latIndex < lats.length; latIndex += 1) {
    for (let lonIndex = 0; lonIndex < lons.length; lonIndex += 1) {
      const rainfall = Number((offset + ((latIndex + lonIndex) % 17) / 10).toFixed(3));
      lines.push(`${lons[lonIndex].toFixed(3)} ${lats[latIndex].toFixed(3)} ${rainfall.toFixed(3)}`);
    }
  }
  return lines.join('\n');
}

const indexA = makeIndex();
const mdlA = makeMdl();
const calls = [];
const runtime = createSwirlsRuntime({
  fetchText: async (url, options) => {
    calls.push({ url, ...options });
    if (url === SWIRLS_RAW_CONTRACT.indexUrl) return { body:indexA, cacheStatus:null };
    return { body:mdlA, cacheStatus:null };
  }
});

const frame = await runtime.loadFrame(1);
assert.equal(frame.frameIndex, 1);
assert.equal(frame.leadMinutes, 36);
assert.equal(frame.grid.rows, 121);
assert.equal(frame.grid.cols, 121);
assert.equal(frame.grid.cellCount, 14641);
assert.equal(frame.values.length, 14641);
assert.equal(frame.validation.ready, true);
assert.equal(frame.validation.runTimeMatchesIndex, true);
assert.equal(frame.index.frameCount, 16);
assert.equal(calls.length, 2);
assert.equal(calls[0].kind, 'index');
assert.equal(calls[1].kind, 'mdl');
assert.equal(calls[0].ttlSeconds, 45);
assert.equal(calls[1].ttlSeconds, 45);

const compact = summarizeFrame(frame);
assert.equal(compact.ready, true);
assert.equal(compact.grid.cellCount, 14641);
assert.equal(compact.wetCellCount > 0, true);
assert.equal('values' in compact, false);

const probe = await runtime.probe({ frameIndex:0, includeLastFrame:true });
assert.equal(probe.ok, true);
assert.equal(probe.frameCount, 16);
assert.equal(probe.cadenceMinutes, 6);
assert.equal(probe.sampledFrames.length, 2);
assert.deepEqual(probe.sampledFrames.map(item => item.frameIndex), [0,15]);

// Zero-base behavior: a rollover mismatch fails closed. The runtime must not
// re-read index/MDL automatically or start a hidden retry cascade.
const mdlB = makeMdl('2026-08-14T02:06:00.000Z', 0.5);
let rolloverIndexReads = 0;
let rolloverMdlReads = 0;
const rollover = createSwirlsRuntime({
  fetchText: async url => {
    if (url === SWIRLS_RAW_CONTRACT.indexUrl) { rolloverIndexReads += 1; return { body:indexA }; }
    rolloverMdlReads += 1;
    return { body:mdlB };
  }
});
await assert.rejects(() => rollover.loadFrame(0), /SWIRLS run time mismatch/);
assert.equal(rolloverIndexReads, 1, 'rollover mismatch must not re-fetch index automatically');
assert.equal(rolloverMdlReads, 1, 'rollover mismatch must not re-fetch MDL automatically');

await assert.rejects(() => runtime.loadFrame(-1), /0\.\.15/);
await assert.rejects(() => runtime.loadFrame(16), /0\.\.15/);

console.log('SWIRLS runtime zero-base gate PASS');
