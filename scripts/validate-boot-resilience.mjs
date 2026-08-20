import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const index = readFileSync('index.html', 'utf8');
const boot = readFileSync('js/boot-watchdog.js', 'utf8');
const home = readFileSync('js/rain-home.js', 'utf8');
const map = readFileSync('js/map.js', 'utf8');
const smoke = readFileSync('js/forecast-map-smoke.js', 'utf8');
const mode = readFileSync('js/rain-map-mode.js', 'utf8');
const pwa = readFileSync('js/pwa.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

assert.ok(index.includes('<script src="./js/boot-watchdog.js"></script>'), 'classic boot layer must load before application modules');
assert.ok(index.includes('media="print" onload="this.media=\'all\'"'), 'Leaflet CSS must not block Rain Home paint');
assert.ok(index.includes('<script async src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"'), 'Leaflet JS must remain non-blocking');

const homeScript = index.indexOf('<script type="module" src="./js/rain-home.js"></script>');
const shellScript = index.indexOf('<script type="module" src="./js/rain-home-shell.js"></script>');
const settingsScript = index.indexOf('<script type="module" src="./js/settings-segmented.js"></script>');
const appScript = index.indexOf('<script type="module" src="./js/app.js"></script>');
const smokeScript = index.indexOf('<script type="module" src="./js/forecast-map-smoke.js"></script>');
assert.ok(homeScript >= 0, 'Rain Home must have a direct module entry');
assert.ok(shellScript > homeScript, 'Rain Home shell cleanup must follow Home');
assert.ok(settingsScript > homeScript && appScript > homeScript && smokeScript > homeScript, 'optional app modules must stay behind Rain Home');
assert.ok(home.includes('void syncHome();'), 'normal Rain Home module must start its request immediately');
assert.ok(home.trimEnd().endsWith('initRainHome();'), 'normal Rain Home module must not wait for DOMContentLoaded');

assert.ok(map.includes('if (!window.L) {\n    queueLeafletInit({ onSelect });\n    return null;\n  }'), 'map must fail soft while Leaflet is unavailable');
assert.ok(map.includes("window.addEventListener('rain:leaflet-ready', retry)"), 'map must retry after Leaflet loads');

for (const marker of [
  'const FALLBACK_START_MS = 800',
  "const API_BASE = 'https://radar.max-yu.workers.dev'",
  'data-rain-critical-fallback',
  '/api/rain/swirls/point-series?lat=',
  '正在直接讀取 SWIRLS',
  'points.length < 2',
  "intercept('refresh-button'",
  "intercept('locate-button'",
  "intercept('drawer-button'",
  'data-critical-retry',
  'const BOOT_TIMEOUT_MS = 5000'
]) assert.ok(boot.includes(marker), `classic fallback marker missing: ${marker}`);
assert.ok(!boot.includes("navigator.serviceWorker.register('./service-worker.js'"), 'service-worker registration must not compete with critical boot');
assert.ok(!boot.includes('caches.keys()'), 'critical boot must not migrate caches');
assert.ok(!boot.includes('registration?.unregister?.()'), 'critical boot must not unregister service workers');

assert.ok(smoke.includes("import './rain-home.js';"), 'Forecast Map smoke may reuse Rain Home');
assert.ok(smoke.includes('Promise.allSettled(OPTIONAL_MAP_MODULES.map(path => import(path)))'), 'map enhancements must remain best-effort');
assert.ok(existsSync('js/rain-map-mode-heavy.js'), 'full rain-map mode implementation is missing');
assert.ok(mode.includes("import('./rain-map-mode-heavy.js')"), 'Rain Home map facade must defer the heavy map graph');
assert.ok(!mode.match(/^import\s/m), 'rain-map-mode facade must not have static imports');

assert.ok(!pwa.includes('hadControllerAtStart'), 'background controller changes must not force reload');
assert.ok(pwa.includes("if (!updateInProgress) return;\n    reloadForNewController();"), 'PWA reload must require explicit update application');

assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa33'/);
assert.ok(!sw.includes('const CORE_SHELL = ['), 'pwa33 must not have an install-time core prefetch list');
assert.ok(sw.includes('event.waitUntil(self.skipWaiting())'), 'pwa33 install must be zero-prefetch');
assert.ok(!sw.includes('for (const path of CORE_SHELL)'), 'pwa33 must not serially fetch app assets during install');
assert.ok(sw.includes('navigationNetworkFirst(request)'), 'navigation must prefer the live network');
assert.ok(sw.includes('shellAssetNetworkFirst(request)'), 'same-origin assets must prefer the live network');
assert.ok(sw.includes("fetch(request, { cache:'no-store' })"), 'shell network fetches must bypass stale HTTP cache');
assert.ok(sw.includes('cache.put(request, response.clone()).catch(() => {})'), 'successfully used shell assets should still become cached');
assert.ok(!sw.includes('client.navigate('), 'service-worker activation must not navigate clients');
assert.ok(!sw.includes('self.clients.matchAll('), 'service-worker activation must not run a second reload path');
assert.ok(sw.includes("'./js/rain-map-mode-heavy.js'"), 'heavy map module must stay in dependency inventory');

console.log('Classic Rain Home fallback + zero-prefetch pwa33 boot resilience PASS');
