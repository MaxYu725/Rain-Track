import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const quick = readFileSync(new URL('../js/rain-map-quickviews.js', import.meta.url), 'utf8');
const smoke = readFileSync(new URL('../js/forecast-map-smoke.js', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

for (const marker of [
  "id:'hong-kong'",
  "id:'shenzhen'",
  "id:'south-sea'",
  "id:'coverage'",
  "label:'香港'",
  "label:'深圳'",
  "label:'南面海域'",
  "label:'全域'",
  '21.328, 112.956',
  '23.487, 115.291',
  "id === 'location'",
  'map.fitBounds',
  'map.setView',
  "activeMode === 'forecast'",
  "state.map.on?.('movestart'",
  "state.map.on?.('zoomstart'"
]) {
  assert.ok(quick.includes(marker), `quick-view marker missing: ${marker}`);
}

assert.ok(!quick.includes('rain:forecast-playback-change'), 'forecast playback must not auto-recenter the map');
assert.ok(!quick.includes('setInterval('), 'quick views must not poll or repeatedly recenter');
assert.ok(!quick.includes('setTimeout('), 'quick views must not schedule delayed recentering');
assert.ok(smoke.includes("import './rain-map-quickviews.js';"), 'quick views are not loaded by the app entry');
assert.ok(serviceWorker.includes("point-rain-pwa-v1.6.4-pwa23"), 'PWA shell was not bumped to pwa23');
assert.ok(serviceWorker.includes("'./js/rain-map-quickviews.js'"), 'quick views are missing from the PWA app shell');

console.log('Forecast map quick-view validation passed');
