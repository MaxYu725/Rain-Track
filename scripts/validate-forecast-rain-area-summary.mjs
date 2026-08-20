import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RAIN_AREA_PRODUCT_ZONES, summarizeForecastRainArea } from '../js/forecast-map-spatial.js';

const latitudes = [22.75, 22.65, 22.55, 22.45, 22.30, 21.80];
const longitudes = [113.9, 114.1, 114.3, 114.5];
const grid = { latitudes, longitudes };
const cellCount = latitudes.length * longitudes.length;

function frameWith(wetIndexes = [], amount = 1, count = cellCount) {
  const values = Array(count).fill(0);
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

const productZones = Object.values(RAIN_AREA_PRODUCT_ZONES);
assert.equal(productZones.length, 13, 'regional model must expose 13 product zones');
assert.equal(productZones.filter(zone => zone.parent === 'hongKong').length, 7, 'Hong Kong must have seven product zones');
assert.equal(productZones.filter(zone => zone.parent === 'shenzhen').length, 3, 'Shenzhen must have three product zones');
assert.equal(productZones.filter(zone => zone.parent === 'southSea').length, 3, 'south sea must have three product zones');

const regionalGrid = {
  latitudes:[22.75,22.53,22.40,22.32,22.25,21.80],
  longitudes:[113.5,113.9,114.18,114.38,114.70]
};
const regionalCount = regionalGrid.latitudes.length * regionalGrid.longitudes.length;
const regionalWetIndexes = [
  1,2,3,      // Shenzhen west / central / east
  6,7,8,      // NT west / north / Sai Kung-east
  11,12,13,   // NT west / east / Sai Kung-east
  17,          // Kowloon
  21,22,23,   // Lantau / HK Island / Sai Kung-east
  25,27,29    // SW sea / south sea / SE sea
];
const regional = summarizeForecastRainArea(frameWith(regionalWetIndexes, 1, regionalCount), regionalGrid);
for (const key of ['szWest','szCentral','szEast','hkNtWest','hkNtNorth','hkNtEast','hkSaiKungEast','hkKowloon','hkLantauIslands','hkIsland','seaWest','seaSouth','seaEast']) {
  assert.ok(regional.productZones[key].wetCellCount >= 1, `regional product zone not classified: ${key}`);
}
assert.ok(regional.regionalLabel, 'regional label must be available');
assert.ok(regional.regionalDetail, 'regional detail must be available');

const eastSeaValues = Array(regionalCount).fill(0);
[24,29].forEach(index => { eastSeaValues[index] = 1.2; });
const eastSea = summarizeForecastRainArea({ values:eastSeaValues }, regionalGrid);
assert.equal(eastSea.productZones.seaEast.wetCellCount, 2);
assert.match(eastSea.regionalLabel, /東南海域/);
assert.match(eastSea.regionalDetail, /東南海域/);

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
  'summary.regionalLabel || summary.label',
  'summary.regionalDetail || summary.detail',
  'panel.dataset.rainAreaStatus',
  "activeMode === 'forecast'",
  "rain:forecast-map-frame-change",
  '.rain-map-area-kicker::after{content:\' · \'',
  '.rain-map-area-summary{top:50px;left:8px',
  'width:calc(100% - 16px)',
  'padding:7px 9px',
  "panel.removeAttribute('title')"
]) assert.ok(ui.includes(marker), `rain-area summary UI marker missing: ${marker}`);

assert.ok(!ui.includes('detail.textContent = `${summary.detail} · 判讀門檻'), 'engineering threshold text must not be appended to the visible product summary');
assert.ok(!ui.includes('panel.title = `雨區判讀門檻'), 'engineering threshold tooltip must not bypass the explicit info disclosure');
assert.ok(!ui.includes('fitBounds'), 'rain-area summary must not change map viewport');
assert.ok(!ui.includes('setView'), 'rain-area summary must not recenter the map');
assert.ok(!ui.includes('setForecastMapIndex'), 'rain-area summary must not control forecast playback/frame selection');
assert.ok(smoke.includes("'./rain-map-area-summary.js'"), 'rain-area summary is not referenced by the app entry');
assert.ok(smoke.includes('Promise.allSettled(OPTIONAL_MAP_MODULES.map(path => import(path)))'), 'rain-area summary must be isolated from the Rain Home critical module graph');
assert.ok(sw.includes("'./js/forecast-map-spatial.js'"), 'spatial analyzer missing from PWA app shell inventory');
assert.ok(sw.includes("'./js/rain-map-area-summary.js'"), 'spatial summary UI missing from PWA app shell inventory');

const shellVersion = sw.match(/const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa(\d+)'/);
assert.ok(shellVersion, 'PWA shell version marker is missing');
assert.ok(Number(shellVersion[1]) >= 44, `Forecast Map regional v2 requires PWA generation at least pwa44, got pwa${shellVersion[1]}`);

console.log('Forecast rain-area regional v2 summary validation passed');
