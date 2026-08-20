import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  analyzeRadarPixels,
  classifyRadarPixel,
  describeRadarAnalysis,
  hongKongEchoLocationLabel
} from '../js/radar-analysis.js';

const runtime = readFileSync('js/radar-analysis-runtime.js', 'utf8');
const analysisSource = readFileSync('js/radar-analysis.js', 'utf8');
const smoke = readFileSync('js/forecast-map-smoke.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

assert.equal(classifyRadarPixel(215, 53, 69, 0), null, 'transparent pixels must never count as radar echo');
const weak = classifyRadarPixel(0, 185, 223, 255);
const strong = classifyRadarPixel(215, 53, 69, 255);
assert.ok(weak && strong && strong.strength > weak.strength, 'Radar palette must preserve relative weak-to-strong ordering');
assert.equal(classifyRadarPixel(100, 100, 100, 255), null, 'neutral pixels must not be interpreted as echo');

const width = 24;
const height = 24;
const data = new Uint8ClampedArray(width * height * 4);
const frame = {
  id:'synthetic',
  time:'2026-08-20T09:00:00.000Z',
  bounds:{ north:22.56, south:22.15, east:114.50, west:113.82 }
};

function coords(x, y) {
  return {
    lat:frame.bounds.north - (y / (height - 1)) * (frame.bounds.north - frame.bounds.south),
    lon:frame.bounds.west + (x / (width - 1)) * (frame.bounds.east - frame.bounds.west)
  };
}

function paint(x, y, rgba) {
  const offset = (y * width + x) * 4;
  data[offset] = rgba[0];
  data[offset + 1] = rgba[1];
  data[offset + 2] = rgba[2];
  data[offset + 3] = rgba[3];
}

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const point = coords(x, y);
    if (point.lon >= 114.30 && point.lat >= 22.25 && point.lat <= 22.45 && (x + y) % 2 === 0) {
      paint(x, y, [0, 201, 107, 255]);
    }
    if (Math.abs(point.lat - 22.32) < 0.035 && Math.abs(point.lon - 114.17) < 0.04) {
      paint(x, y, [0, 185, 223, 255]);
    }
  }
}

const analysis = analyzeRadarPixels({ data, width, height }, frame, {
  location:{ lat:22.32, lon:114.17 },
  radiusKm:6,
  rangeKm:64,
  heightKm:3
});
assert.ok(analysis.hongKong.echoCount > 0, 'synthetic Hong Kong echo must be detected');
assert.ok(analysis.nearby.sampleCount >= 3, 'nearby radius must contain enough samples');
assert.ok(analysis.nearby.echoCount > 0, 'nearby echo must be independent from Hong Kong aggregate');
assert.equal(Object.hasOwn(analysis, 'regional'), false, 'final Radar analysis must not maintain unused regional history metrics');
assert.match(hongKongEchoLocationLabel(analysis.hongKong.centroid), /香港東部|香港東北部|香港東南部/);

const described = describeRadarAnalysis(analysis, { locationName:'粉嶺' });
assert.match(described.hongKongText, /香港/);
assert.match(described.nearbyText, /粉嶺附近/);
assert.equal(Object.hasOwn(described, 'motionText'), false, 'final Radar UI must not expose historical motion analysis');

for (const marker of [
  "from './radar-analysis.js'",
  "window.addEventListener('rain:radar-frame-change'",
  'RADAR_ANALYSIS_SAMPLE_MAX_DIMENSION',
  "image.crossOrigin = 'anonymous'",
  "id = 'radar-analysis-card'",
  'analyzeRadarPixels(imageData, frame',
  '<div class="radar-analysis-kicker">目前回波</div>',
  "describeRadarAnalysis(current, { locationName:state.selected?.name || '所在地' })"
]) assert.ok(runtime.includes(marker), `Radar current-frame analysis marker missing: ${marker}`);

for (const forbidden of [
  'fetchRadarFrames',
  "api('/api/radar",
  'setRadarIndex(',
  'changeRadarRange(',
  'changeRadarHeight(',
  'summarizeRadarHistory',
  'warmRecentHistory',
  'state.radar.frames.slice(-6)',
  'data-radar-analysis-motion'
]) assert.ok(!runtime.includes(forbidden), `Radar final analysis must stay current-frame only: ${forbidden}`);

for (const forbidden of ['summarizeRadarHistory', 'trendDirection(', 'bearingDirection(', 'meanDistanceToLocationKm']) {
  assert.ok(!analysisSource.includes(forbidden), `historical Radar analysis code must be removed: ${forbidden}`);
}

assert.ok(smoke.includes("'./radar-analysis-runtime.js'"), 'Radar analysis must remain an optional enhancement');
assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa55'/);
assert.ok(sw.includes("'./js/radar-analysis.js'"));
assert.ok(sw.includes("'./js/radar-analysis-runtime.js'"));

console.log('Radar current-frame summary + nearby radius + pwa55 regression gate PASS');
