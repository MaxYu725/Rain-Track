import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeForecastRainArea } from '../js/forecast-map-spatial.js';

const latitudes = [22.75, 22.65, 22.55, 22.45, 22.30, 21.80];
const longitudes = [113.9, 114.1, 114.3, 114.5];
const grid = { latitudes, longitudes };
const cellCount = latitudes.length * longitudes.length;

function frameWith(wetIndexes = [], amount = 1) {
  const values = Array(cellCount).fill(0);
  wetIndexes.forEach(index => { values[index] = amount; });
  return { values };
}

const dry = summarizeForecastRainArea(frameWith(), grid);
assert.equal(dry.status, 'dry');
assert.equal(dry.label, '附近雨區不明顯');
assert.equal(dry.totalWetCellCount, 0);

const hkWide = summarizeForecastRainArea(frameWith([...Array(12)].map((_, i) => i + 8), 0.8), grid);
assert.equal(hkWide.status, 'hong-kong-widespread');
assert.equal(hkWide.zones.hongKong.wetShare, 1);
assert.equal(hkWide.zones.shenzhen.wetShare, 0);

const hkLocal = summarizeForecastRainArea(frameWith([8,9,10,11], 0.8), grid);
assert.equal(hkLocal.status, 'hong-kong-local');
assert.ok(hkLocal.zones.hongKong.wetShare > 0.3 && hkLocal.zones.hongKong.wetShare < 0.34);

const shenzhen = summarizeForecastRainArea(frameWith([0,1,2,3,4,5,6,7], 1.2), grid);
assert.equal(shenzhen.status, 'shenzhen');
assert.equal(shenzhen.zones.shenzhen.wetShare, 1);
assert.equal(shenzhen.zones.hongKong.wetShare, 0);

const sea = summarizeForecastRainArea(frameWith([20,21,22,23], 1.2), grid);
assert.equal(sea.status, 'south-sea');
assert.equal(sea.zones.southSea.wetShare, 1);
assert.match(sea.detail, /香港 0% · 深圳 0% · 南面海域 100%/);

assert.equal(summarizeForecastRainArea({ values:[1] }, grid), null, 'incomplete grids must fail closed');

const runtime = readFileSync(new URL('../js/forecast-map-runtime.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../js/rain-map-area-summary.js', import.meta.url), 'utf8');
const smoke = readFileSync(new URL('../js/forecast-map-smoke.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

for (const marker of [
  "summarizeForecastRainArea(frame, forecast.grid)",
  "spatialSummary:lastRender?.spatialSummary || null",
  "rain:forecast-map-frame-change"
]) assert.ok(runtime.includes(marker), `runtime spatial summary marker missing: ${marker}`);

for (const marker of [
  'data-rain-area-time',
  'selectedTimeText(snapshot)',
  'summary.label',
  'detail.textContent = summary.detail',
  'panel.dataset.rainAreaStatus',
  "activeMode === 'forecast'",
  "rain:forecast-map-frame-change",
  '.rain-map-area-summary{top:50px;left:8px',
  'padding:7px 9px'
]) assert.ok(ui.includes(marker), `rain-area summary UI marker missing: ${marker}`);

assert.ok(!ui.includes('detail.textContent = `${summary.detail} · 判讀門檻'), 'engineering threshold text must not be appended to the visible product summary');
assert.ok(!ui.includes('fitBounds'), 'rain-area summary must not change map viewport');
assert.ok(!ui.includes('setView'), 'rain-area summary must not recenter the map');
assert.ok(!ui.includes('setForecastMapIndex'), 'rain-area summary must not control forecast playback/frame selection');
assert.ok(smoke.includes("'./rain-map-area-summary.js'"), 'rain-area summary is not referenced by the app entry');
assert.ok(smoke.includes('Promise.allSettled(OPTIONAL_MAP_MODULES.map(path => import(path)))'), 'rain-area summary must be isolated from the Rain Home critical module graph');
assert.ok(sw.includes("'./js/forecast-map-spatial.js'"), 'spatial analyzer missing from PWA app shell inventory');
assert.ok(sw.includes("'./js/rain-map-area-summary.js'"), 'spatial summary UI missing from PWA app shell inventory');

const shellVersion = sw.match(/const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa(\d+)'/);
assert.ok(shellVersion, 'PWA shell version marker is missing');
assert.ok(Number(shellVersion[1]) >= 40, `Forecast Map fullscreen fix requires PWA generation at least pwa40, got pwa${shellVersion[1]}`);

console.log('Forecast rain-area compact fullscreen summary validation passed');
