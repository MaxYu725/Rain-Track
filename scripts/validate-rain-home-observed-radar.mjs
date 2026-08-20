import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.localStorage = {
  getItem:() => null,
  setItem:() => {},
  removeItem:() => {}
};
globalThis.sessionStorage = {
  getItem:() => null,
  setItem:() => {},
  removeItem:() => {}
};
globalThis.location = { search:'' };

const {
  RAIN_HOME_OBSERVED_MAX_FRAMES,
  RAIN_HOME_OBSERVED_WINDOW_MINUTES,
  RAIN_HOME_OBSERVED_NOW_MAX_AGE_MINUTES,
  RAIN_HOME_OBSERVED_MAX_LATEST_AGE_MINUTES,
  buildNowNextSummary,
  classifySwirlsFuture,
  describeObservedRadarHistory,
  observedRadarLevel,
  selectObservedRadarFrames
} = await import('../js/rain-home-observed-radar.js');

const base = Date.parse('2026-08-20T10:00:00.000Z');
const frames = Array.from({ length:8 }, (_, index) => ({
  id:`f${index}`,
  time:new Date(base + index * 6 * 60_000).toISOString(),
  imageUrl:`/radar/${index}.png`,
  bounds:{ north:22.6, south:22.0, east:114.6, west:113.8 }
}));
const selected = selectObservedRadarFrames(frames);
assert.equal(RAIN_HOME_OBSERVED_WINDOW_MINUTES, 30);
assert.equal(RAIN_HOME_OBSERVED_MAX_FRAMES, 6);
assert.equal(RAIN_HOME_OBSERVED_NOW_MAX_AGE_MINUTES, 12);
assert.equal(RAIN_HOME_OBSERVED_MAX_LATEST_AGE_MINUTES, 20);
assert.equal(selected.length, 6, 'Rain Home must cap Radar history to six recent frames');
assert.equal(selected[0].id, 'f2');
assert.equal(selected.at(-1).id, 'f7');
assert.equal((Date.parse(selected.at(-1).time) - Date.parse(selected[0].time)) / 60_000, 30, 'selected Radar history must cover exactly the latest 30 minutes when cadence allows');

const dry = { sampleCount:12, coverage:0, meanStrength:0, maxStrength:0 };
const weak = { sampleCount:12, coverage:0.09, meanStrength:1.2, maxStrength:1.2 };
const moderate = { sampleCount:12, coverage:0.16, meanStrength:2.4, maxStrength:3 };
assert.equal(observedRadarLevel(dry), 0);
assert.ok(observedRadarLevel(weak) > 0);
assert.ok(observedRadarLevel(moderate) > observedRadarLevel(weak));

const latestFrameMs = Date.parse(frames[7].time);
const recent = describeObservedRadarHistory([
  { time:frames[5].time, nearby:dry },
  { time:frames[6].time, nearby:weak },
  { time:frames[7].time, nearby:moderate }
], { locationName:'九龍灣', nowMs:latestFrameMs + 8 * 60_000 });
assert.match(recent.text, /九龍灣附近目前有/);
assert.equal(recent.currentEcho, true);
assert.equal(recent.freshForNow, true);

const aged = describeObservedRadarHistory([
  { time:frames[5].time, nearby:dry },
  { time:frames[6].time, nearby:weak },
  { time:frames[7].time, nearby:moderate }
], { locationName:'九龍灣', nowMs:latestFrameMs + 15 * 60_000 });
assert.match(aged.text, /最近雷達幀顯示九龍灣附近有/);
assert.equal(aged.currentEcho, true);
assert.equal(aged.freshForNow, false, '12-20 minute Radar data may remain visible but must not drive Now messaging');

const faded = describeObservedRadarHistory([
  { time:frames[2].time, nearby:weak },
  { time:frames[3].time, nearby:weak },
  { time:frames[4].time, nearby:dry }
], { locationName:'粉嶺', nowMs:Date.parse(frames[4].time) + 6 * 60_000 });
assert.match(faded.text, /過去 30 分鐘粉嶺附近曾有回波/);
assert.match(faded.text, /目前暫未見明顯回波/);
assert.equal(faded.currentEcho, false);

const nowMs = Date.parse('2026-08-20T12:00:00.000Z');
const forecast = offsets => ({ points:offsets.map(([minutes, amount], index) => ({
  frameIndex:index,
  validTime:new Date(nowMs + minutes * 60_000).toISOString(),
  amountMm:amount
})) });
assert.equal(classifySwirlsFuture(forecast([[10,0],[20,0],[30,0]]) , { nowMs }).state, 'dry');
assert.equal(classifySwirlsFuture(forecast([[10,0.3],[20,0.4],[30,0.1]]) , { nowMs }).state, 'near-term-wet');
assert.equal(classifySwirlsFuture(forecast([[10,0],[36,0.3],[48,0.5]]) , { nowMs }).state, 'later-wet');
assert.equal(classifySwirlsFuture({ points:[{ validTime:new Date(nowMs - 10 * 60_000).toISOString(), amountMm:1 }] }, { nowMs }).state, 'expired');

const freshEcho = { freshForNow:true, currentEcho:true, latestClock:'20:12' };
const freshDry = { freshForNow:true, currentEcho:false, latestClock:'20:12' };
assert.match(buildNowNextSummary(freshEcho, { state:'near-term-wet' }).title, /目前附近有雨訊號/);
assert.match(buildNowNextSummary(freshEcho, { state:'dry' }).title, /稍後雨勢或減弱/);
assert.match(buildNowNextSummary(freshDry, { state:'later-wet' }).title, /稍後可能有雨/);
assert.match(buildNowNextSummary(freshDry, { state:'dry' }).title, /目前及短時預報暫無明顯降雨/);
assert.equal(buildNowNextSummary({ ...freshEcho, freshForNow:false }, { state:'dry' }), null, 'aged Radar must never rewrite the Home headline');

const source = readFileSync('js/rain-home-observed-radar.js', 'utf8');
const imageHelper = readFileSync('js/radar-analysis-image.js', 'utf8');
const radarRuntime = readFileSync('js/radar-analysis-runtime.js', 'utf8');
const smoke = readFileSync('js/forecast-map-smoke.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

for (const marker of [
  "fetchRadarFrames(HOME_RADAR_RANGE_KM, 'live', height",
  'selectObservedRadarFrames(sourceFrames)',
  'analyzeRadarFrameImage(frame',
  "data-rain-home-observed-radar",
  '過去 30 分鐘實況',
  'HKO 雷達回波',
  'rain-home-observed-legend-bar',
  'RAIN_HOME_OBSERVED_NOW_MAX_AGE_MINUTES = 12',
  "const SERIES_SESSION_PREFIX = 'rain-home-series-v1:'",
  'sessionStorage.getItem(`${SERIES_SESSION_PREFIX}${seriesPointKey(point)}`)',
  'buildNowNextSummary(radarSummary, forecastSummary',
  "root.dataset.rainHomeNowNext = forecastSummary.state",
  'clearObserved(root, { restoreSummary:true })',
  "document.addEventListener('visibilitychange'",
  'requestIdleCallback(run, { timeout:1200 })',
  "root.dataset.rainHomeObservedAttempted = '1'"
]) assert.ok(source.includes(marker), `Rain Home Now + Next marker missing: ${marker}`);

for (const forbidden of ['fetchSwirlsPointSeries', '/point-series', '/api/rain/swirls']) {
  assert.ok(!source.includes(forbidden), `Now + Next enhancement must not become a second SWIRLS client: ${forbidden}`);
}
assert.ok(source.includes('RAIN_HOME_OBSERVED_MAX_LATEST_AGE_MINUTES = 20'), 'stale Radar history must be rejected');
assert.ok(source.includes('if (frames.length < 3 || !latestFrameIsFresh(frames)) return'), 'insufficient/stale Radar history must fail soft');
assert.ok(imageHelper.includes('export async function analyzeRadarFrameImage'), 'Radar image analysis must be shared instead of duplicated');
assert.ok(radarRuntime.includes("from './radar-analysis-image.js'"), 'Radar page must reuse shared image analysis helper');
assert.ok(!radarRuntime.includes("image.crossOrigin = 'anonymous'"), 'Radar page must not keep a duplicate image decoder');
assert.ok(smoke.includes("'./rain-home-observed-radar.js'"), 'Home Radar history must remain an optional enhancement');
assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa58'/);
assert.ok(sw.includes("'./js/radar-analysis-image.js'"));
assert.ok(sw.includes("'./js/rain-home-observed-radar.js'"));

console.log('Rain Home Now + Next + Radar freshness + SWIRLS separation + pwa58 gate PASS');
