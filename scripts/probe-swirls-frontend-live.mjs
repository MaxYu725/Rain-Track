import assert from 'node:assert/strict';
import { assertSwirlsFrameCompatible, buildSwirlsForecast, normalizeSwirlsFramePayload } from '../js/forecast-map-swirls.js';

const BASE = (process.env.WORKER_BASE_URL || 'https://radar.max-yu.workers.dev').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 60_000;
const ATTEMPTS = 2;

async function fetchFrame(frameIndex) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS);
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

async function getFrame(frameIndex) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await fetchFrame(frameIndex);
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) console.warn(`SWIRLS frame ${frameIndex} live attempt ${attempt} failed; retrying once`);
    }
  }
  throw lastError;
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
