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

assert.ok(index.includes('<script src="./js/boot-watchdog.js"></script>'), 'boot watchdog must load before the application modules');
assert.ok(index.includes('media="print" onload="this.media=\'all\'"'), 'Leaflet CSS must not block Rain Home boot');
assert.ok(index.includes('<script async src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"'), 'Leaflet JS must be non-blocking');
assert.ok(index.includes("window.dispatchEvent(new Event('rain:leaflet-ready'))"), 'Leaflet load must notify the deferred map bootstrap');

const homeScript = index.indexOf('<script type="module" src="./js/rain-home.js"></script>');
const shellScript = index.indexOf('<script type="module" src="./js/rain-home-shell.js"></script>');
const settingsScript = index.indexOf('<script type="module" src="./js/settings-segmented.js"></script>');
const appScript = index.indexOf('<script type="module" src="./js/app.js"></script>');
const smokeScript = index.indexOf('<script type="module" src="./js/forecast-map-smoke.js"></script>');
assert.ok(homeScript >= 0, 'Rain Home must have a direct module entry in index.html');
assert.ok(shellScript > homeScript, 'Rain Home shell cleanup must follow the direct Home entry');
assert.ok(settingsScript > homeScript && appScript > homeScript && smokeScript > homeScript, 'settings/app/map modules must not execute ahead of Rain Home');
assert.ok(home.includes('void syncHome();'), 'Rain Home must start the location request immediately during module boot');
assert.ok(home.trimEnd().endsWith('initRainHome();'), 'Rain Home must not wait for DOMContentLoaded after being loaded at the end of the document');
assert.ok(home.includes('if (activeLoadKey === key) {\n    if (!alreadyRendered) renderLoading(content, point);'), 'legacy renderers must not replace an active Rain Home loading surface');

assert.ok(map.includes('if (!window.L) {\n    queueLeafletInit({ onSelect });\n    return null;\n  }'), 'initMap must fail soft while Leaflet is still loading');
assert.ok(map.includes("window.addEventListener('rain:leaflet-ready', retry)"), 'map bootstrap must retry when Leaflet becomes ready');
assert.ok(map.includes("window.addEventListener('load', retry, { once:true })"), 'map bootstrap needs a load-event fallback');
assert.ok(map.includes("window.dispatchEvent(new CustomEvent('rain:map-ready'))"), 'successful deferred map init must announce readiness');

assert.ok(boot.includes('const BOOT_TIMEOUT_MS = 5000'), 'startup watchdog must detect a static-shell stall promptly');
assert.ok(boot.includes('data-rain-boot-recovery'), 'startup watchdog must replace an indefinite static loader with recovery UI');
assert.ok(boot.includes("!root.hasAttribute('data-rain-home-first-paint')"), 'static first paint must not be mistaken for JavaScript takeover');
assert.ok(boot.includes("window.addEventListener('error'"), 'watchdog must observe frontend load errors');
assert.ok(boot.includes('}, true);'), 'watchdog error listener must capture resource-load errors');
assert.ok(boot.includes("navigator.serviceWorker.register('./service-worker.js'"), 'watchdog must refresh the service-worker registration independently of app.js');
assert.ok(boot.includes("navigator.serviceWorker.getRegistration('./')"), 'recovery must target only this app service-worker scope');
assert.ok(boot.includes('registration?.unregister?.()'), 'recovery must be able to remove a broken app service worker');
assert.ok(boot.includes("name.startsWith(CACHE_PREFIX)"), 'recovery must clear only Rain-Track PWA caches');
assert.ok(boot.includes("url.searchParams.set('_boot'"), 'recovery reload must bypass the stale navigation state');

assert.ok(smoke.includes("import './rain-home.js';"), 'Forecast Map smoke entry may reuse the already-started Rain Home module');
assert.ok(smoke.includes("import './rain-home-shell.js';"), 'Forecast Map smoke entry may reuse shell cleanup');
assert.ok(smoke.includes('Promise.allSettled(OPTIONAL_MAP_MODULES.map(path => import(path)))'), 'map enhancements must remain isolated best-effort imports');
assert.ok(smoke.includes("'./rain-map-quickviews.js'"));
assert.ok(smoke.includes("'./rain-map-area-summary.js'"));

assert.ok(existsSync('js/rain-map-mode-heavy.js'), 'the preserved full rain-map mode implementation is missing');
assert.ok(mode.includes("import('./rain-map-mode-heavy.js')"), 'Rain Home map control facade must defer the heavy map graph');
assert.ok(!mode.match(/^import\s/m), 'rain-map-mode facade must not have static imports');
assert.ok(mode.includes('requestIdleCallback'), 'heavy map controls should warm only after the critical Home graph can execute');

assert.ok(!pwa.includes('hadControllerAtStart'), 'background controller changes must not force a normal-startup reload');
assert.ok(pwa.includes("if (!updateInProgress) return;\n    reloadForNewController();"), 'PWA controller reload must require explicit update application');

assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa32'/);
assert.ok(sw.includes('const CORE_SHELL = ['), 'pwa32 must keep a small installation-critical Rain Home core');
const coreShell = sw.match(/const CORE_SHELL = \[([\s\S]*?)\];/)?.[1] || '';
for (const corePath of [
  "'./css/rain-home-first-paint.css'",
  "'./js/boot-watchdog.js'",
  "'./js/rain-home.js'",
  "'./js/rain-home-time.js'",
  "'./js/rain-home-shell.js'",
  "'./js/rain-map-mode.js'",
  "'./js/api.js'",
  "'./js/config.js'",
  "'./js/state.js'",
  "'./js/utils.js'"
]) assert.ok(coreShell.includes(corePath), `critical core path missing from service worker source: ${corePath}`);
assert.ok(!coreShell.includes("'./js/forecast-map-smoke.js'"), 'Forecast Map smoke module must not gate Rain Home PWA installation');
assert.ok(!coreShell.includes("'./js/app.js'"), 'legacy app graph must not gate Rain Home PWA installation');
assert.ok(!coreShell.includes("'./js/settings-segmented.js'"), 'settings enhancement must not gate Rain Home PWA installation');
assert.ok(sw.includes('for (const path of CORE_SHELL)'), 'service-worker install must gate only on the Rain Home core');
assert.ok(sw.includes('await self.skipWaiting()'), 'a complete pwa32 core must be able to replace the prior shell');
assert.ok(!sw.includes('client.navigate('), 'service-worker activation must not race application code with an automatic client navigation');
assert.ok(!sw.includes('self.clients.matchAll('), 'service-worker activation must not run a second reload path');
assert.ok(sw.includes('cache.put(request, response.clone()).catch(() => {})'), 'optional same-origin features must become cached progressively after use');
assert.ok(sw.includes("'./js/rain-map-mode-heavy.js'"), 'heavy map implementation must remain in the full PWA dependency inventory');

console.log('Frontend boot priority + static Rain Home first paint + pwa32 core gate PASS');
