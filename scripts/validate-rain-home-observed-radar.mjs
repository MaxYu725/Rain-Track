import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RAIN_HOME_OBSERVED_MAX_FRAMES,
  RAIN_HOME_OBSERVED_WINDOW_MINUTES,
  describeObservedRadarHistory,
  observedRadarLevel,
  selectObservedRadarFrames
} from '../js/rain-home-observed-radar.js';

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

const history = [
  { time:frames[2].time, nearby:weak },
  { time:frames[3].time, nearby:weak },
  { time:frames[4].time, nearby:dry }
];
const faded = describeObservedRadarHistory(history, { locationName:'粉嶺' });
assert.match(faded.text, /過去 30 分鐘粉嶺附近曾有回波/);
assert.match(faded.text, /目前暫未見明顯回波/);
assert.equal(faded.currentEcho, false);
const current = describeObservedRadarHistory([
  { time:frames[5].time, nearby:dry },
  { time:frames[6].time, nearby:weak },
  { time:frames[7].time, nearby:moderate }
], { locationName:'九龍灣' });
assert.match(current.text, /九龍灣附近目前有/);
assert.equal(current.currentEcho, true);

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
  '未來雨量仍以 SWIRLS 預報為準',
  'requestIdleCallback(run, { timeout:1200 })'
]) assert.ok(source.includes(marker), `Rain Home observed Radar marker missing: ${marker}`);

for (const forbidden of ['fetchSwirlsPointSeries', '/point-series', '/api/rain/swirls']) {
  assert.ok(!source.includes(forbidden), `observed Radar enhancement must not become a second SWIRLS client: ${forbidden}`);
}
assert.ok(source.includes('RAIN_HOME_OBSERVED_MAX_LATEST_AGE_MINUTES = 20'), 'stale Radar history must be rejected');
assert.ok(source.includes('if (frames.length < 3 || !latestFrameIsFresh(frames)) return'), 'insufficient/stale Radar history must fail soft');
assert.ok(imageHelper.includes('export async function analyzeRadarFrameImage'), 'Radar image analysis must be shared instead of duplicated');
assert.ok(radarRuntime.includes("from './radar-analysis-image.js'"), 'Radar page must reuse shared image analysis helper');
assert.ok(!radarRuntime.includes("image.crossOrigin = 'anonymous'"), 'Radar page must not keep a duplicate image decoder');
assert.ok(smoke.includes("'./rain-home-observed-radar.js'"), 'Home Radar history must remain an optional enhancement');
assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa57'/);
assert.ok(sw.includes("'./js/radar-analysis-image.js'"));
assert.ok(sw.includes("'./js/rain-home-observed-radar.js'"));

console.log('Rain Home past-30-minute Radar observation + SWIRLS separation + pwa57 gate PASS');
