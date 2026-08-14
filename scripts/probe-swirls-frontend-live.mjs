import assert from 'node:assert/strict';
import { assertSwirlsFrameCompatible, buildSwirlsForecast, normalizeSwirlsFramePayload } from '../js/forecast-map-swirls.js';

const BASE = (process.env.WORKER_BASE_URL || 'https://radar.max-yu.workers.dev').replace(/\/$/, '');

async function getFrame(frameIndex) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), 30_000);
  try {
    const response = await fetch(`${BASE}/api/rain/swirls/frame?frame=${frameIndex}`, {
      cache:'no-store',
      headers:{ Accept:'application/json', 'User-Agent':'Rain-Track-SWIRLS-frontend-live/1.0' },
      signal:controller.signal
    });
    assert.ok(response.ok, `SWIRLS frame ${frameIndex} HTTP ${response.status}`);
    return normalizeSwirlsFramePayload(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

const first = await getFrame(0);
const forecast = buildSwirlsForecast(first);
const last = await getFrame(15);

assert.equal(forecast.frames.length, 16);
assert.equal(forecast.frames[0].leadMinutes, 30);
assert.equal(forecast.frames.at(-1).leadMinutes, 120);
assert.equal(Math.round((Date.parse(last.validTime) - Date.parse(first.validTime)) / 60000), 90);
assert.equal(forecast.frames.at(-1).time, last.validTime);
assert.equal(assertSwirlsFrameCompatible(forecast, last), true);
assert.equal(first.values.length, 14641);
assert.equal(last.values.length, 14641);

console.log(`SWIRLS frontend live PASS: run=${first.runTime} first=${first.validTime} last=${last.validTime}`);
