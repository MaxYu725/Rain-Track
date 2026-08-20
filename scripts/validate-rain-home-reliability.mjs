import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.localStorage = {
  getItem:() => null,
  setItem:() => {},
  removeItem:() => {}
};
globalThis.sessionStorage = {
  store:new Map(),
  getItem(key) { return this.store.get(key) ?? null; },
  setItem(key, value) { this.store.set(key, String(value)); },
  removeItem(key) { this.store.delete(key); },
  clear() { this.store.clear(); }
};
globalThis.location = { search:'' };

const {
  RAIN_HOME_FOREGROUND_MAX_AGE_MS,
  RAIN_HOME_REFRESH_COOLDOWN_MS,
  inspectRainHomeStoredSeries,
  rainHomeReliabilityPointKey,
  shouldRefreshRainHome
} = await import('../js/rain-home-reliability.js');

const nowMs = Date.parse('2026-08-20T13:40:00.000Z');
const point = { lat:22.3259, lon:114.2186, name:'九龍灣' };
const pointKey = rainHomeReliabilityPointKey(point);
assert.equal(pointKey, '22.3259|114.2186');
assert.equal(RAIN_HOME_FOREGROUND_MAX_AGE_MS, 4 * 60 * 1000);
assert.equal(RAIN_HOME_REFRESH_COOLDOWN_MS, 90 * 1000);

function record({ savedAgoMinutes = 2, pointOffsets = [10,30,60,90,120], runOffsetMinutes = 0 } = {}) {
  const runTime = new Date(nowMs + runOffsetMinutes * 60_000).toISOString();
  return {
    savedAt:nowMs - savedAgoMinutes * 60_000,
    data:{
      runTime,
      points:pointOffsets.map((offset, index) => ({
        frameIndex:index,
        validTime:new Date(nowMs + offset * 60_000).toISOString(),
        amountMm:0.2
      }))
    }
  };
}

const fresh = inspectRainHomeStoredSeries(record(), { nowMs });
assert.equal(fresh.usable, true);
assert.equal(fresh.shouldRefresh, false);
assert.equal(fresh.reason, 'fresh');

const aged = inspectRainHomeStoredSeries(record({ savedAgoMinutes:5 }), { nowMs });
assert.equal(aged.shouldRefresh, true);
assert.equal(aged.reason, 'series-aged');

const expired = inspectRainHomeStoredSeries(record({ savedAgoMinutes:1, pointOffsets:[-40,-30,-20,-10] }), { nowMs });
assert.equal(expired.shouldRefresh, true);
assert.equal(expired.reason, 'forecast-expired');

const invalid = inspectRainHomeStoredSeries('{bad json', { nowMs });
assert.equal(invalid.usable, false);
assert.equal(invalid.shouldRefresh, false, 'invalid storage must fail soft instead of creating a refresh loop');

sessionStorage.setItem(`rain-home-series-v1:${pointKey}`, JSON.stringify(record()));
const readyRoot = { dataset:{ viewKind:'ready', pointKey } };
assert.equal(shouldRefreshRainHome(readyRoot, { point, nowMs, mapView:false }).refresh, false);

sessionStorage.setItem(`rain-home-series-v1:${pointKey}`, JSON.stringify(record({ savedAgoMinutes:5 })));
assert.equal(shouldRefreshRainHome(readyRoot, { point, nowMs, mapView:false }).refresh, true);
assert.equal(shouldRefreshRainHome(readyRoot, { point, nowMs, mapView:false }).reason, 'series-aged');

const oldRoot = { dataset:{ viewKind:'ready', pointKey:'22.4992|114.1467' } };
assert.deepEqual(shouldRefreshRainHome(oldRoot, { point, nowMs, mapView:false }), { refresh:true, reason:'location-mismatch' });
assert.equal(shouldRefreshRainHome(readyRoot, { point, nowMs, mapView:true }).refresh, false, 'hidden Home behind a map must not refresh until the user returns');
assert.equal(shouldRefreshRainHome({ dataset:{ viewKind:'loading', pointKey } }, { point, nowMs, mapView:false }).refresh, false, 'loading Home must own its current request');
assert.equal(shouldRefreshRainHome({ dataset:{ viewKind:'error', pointKey } }, { point, nowMs, mapView:false }).refresh, false, 'error Home must not enter an automatic retry loop');

sessionStorage.clear();
assert.equal(shouldRefreshRainHome(readyRoot, { point, nowMs, mapView:false }).refresh, false, 'missing session storage must fail soft');

const source = readFileSync('js/rain-home-reliability.js', 'utf8');
const smoke = readFileSync('js/forecast-map-smoke.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

for (const marker of [
  "window.addEventListener('rain:location-change'",
  "window.addEventListener('rain:refresh'",
  "window.addEventListener('pageshow'",
  "document.addEventListener('visibilitychange'",
  "window.addEventListener('rain:map-mode-change'",
  "new CustomEvent('rain:refresh', { detail:{ source:'rain-home-reliability', reason } })",
  "root.querySelector('[data-rain-home-observed-radar]')?.remove()",
  "root.dataset.rainHomeSwirlsCaptured === '1'",
  "delete root.dataset.rainHomeNowNext",
  "document.visibilityState === 'hidden'",
  "document.body?.classList?.contains('rain-map-view')"
]) assert.ok(source.includes(marker), `Rain Home reliability marker missing: ${marker}`);

for (const forbidden of [
  "window.addEventListener('online'",
  'fetchSwirlsPointSeries',
  "from './api.js'",
  '/point-series',
  '/api/rain/swirls',
  'setInterval('
]) assert.ok(!source.includes(forbidden), `Rain Home reliability must not become another weather/retry client: ${forbidden}`);

assert.ok(smoke.includes("'./rain-home-reliability.js'"), 'Rain Home reliability must remain a best-effort optional enhancement');
assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa60'/);
assert.ok(sw.includes("'./js/rain-home-reliability.js'"), 'Rain Home reliability must be included in the PWA dependency inventory');

console.log('Rain Home foreground freshness + location isolation + bounded refresh hardening + pwa60 PASS');
