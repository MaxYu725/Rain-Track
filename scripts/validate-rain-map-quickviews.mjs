import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const quick = readFileSync(new URL('../js/rain-map-quickviews.js', import.meta.url), 'utf8');
const smoke = readFileSync(new URL('../js/forecast-map-smoke.js', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

for (const marker of [
  "id:'regional'",
  "id:'hong-kong'",
  "id:'shenzhen'",
  "id:'south-sea'",
  "label:'區域'",
  "label:'香港'",
  "label:'深圳'",
  "label:'南海'",
  "data-rain-map-view=\"location\"",
  '查看目前定位附近',
  'map.fitBounds',
  'map.setView',
  "activeMode === 'forecast'",
  "applyView('regional', button, { animate:false })",
  "state.map.on?.('movestart'",
  "state.map.on?.('zoomstart'"
]) {
  assert.ok(quick.includes(marker), `quick-view marker missing: ${marker}`);
}

assert.ok(!quick.includes("label:'全域'"), 'product quick views should prefer a regional orientation view over an engineering full-grid preset');
assert.ok(!quick.includes('rain:forecast-playback-change'), 'forecast playback must not auto-recenter the map');
assert.ok(!quick.includes('setInterval('), 'quick views must not poll or repeatedly recenter');
assert.ok(!quick.includes('setTimeout('), 'quick views must not schedule delayed recentering');
assert.ok(smoke.includes("'./rain-map-quickviews.js'"), 'quick views are not referenced by the app entry');
assert.ok(smoke.includes('Promise.allSettled(OPTIONAL_MAP_MODULES.map(path => import(path)))'), 'optional map modules must load independently of the Rain Home critical graph');

const shellVersion = serviceWorker.match(/const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa(\d+)'/);
assert.ok(shellVersion, 'PWA shell version marker is missing');
assert.ok(Number(shellVersion[1]) >= 39, `Forecast Map first pass requires PWA generation at least pwa39, got pwa${shellVersion[1]}`);
assert.ok(serviceWorker.includes("'./js/rain-map-quickviews.js'"), 'quick views are missing from the PWA app shell inventory');

console.log('Forecast Map regional quick-view validation passed');
