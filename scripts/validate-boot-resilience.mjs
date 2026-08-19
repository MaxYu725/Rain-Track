import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync('index.html', 'utf8');
const boot = readFileSync('js/boot-watchdog.js', 'utf8');
const map = readFileSync('js/map.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

assert.ok(index.includes('<script src="./js/boot-watchdog.js"></script>'), 'boot watchdog must load before the application modules');
assert.ok(index.includes('media="print" onload="this.media=\'all\'"'), 'Leaflet CSS must not block Rain Home boot');
assert.ok(index.includes('<script async src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"'), 'Leaflet JS must be non-blocking');
assert.ok(index.includes("window.dispatchEvent(new Event('rain:leaflet-ready'))"), 'Leaflet load must notify the deferred map bootstrap');

assert.ok(map.includes('if (!window.L) {\n    queueLeafletInit({ onSelect });\n    return null;\n  }'), 'initMap must fail soft while Leaflet is still loading');
assert.ok(map.includes("window.addEventListener('rain:leaflet-ready', retry)"), 'map bootstrap must retry when Leaflet becomes ready');
assert.ok(map.includes("window.addEventListener('load', retry, { once:true })"), 'map bootstrap needs a load-event fallback');
assert.ok(map.includes("window.dispatchEvent(new CustomEvent('rain:map-ready'))"), 'successful deferred map init must announce readiness');

assert.ok(boot.includes('const BOOT_TIMEOUT_MS = 8000'), 'startup watchdog timeout marker is missing');
assert.ok(boot.includes('data-rain-boot-recovery'), 'startup watchdog must replace an indefinite static spinner with recovery UI');
assert.ok(boot.includes("navigator.serviceWorker.register('./service-worker.js'"), 'watchdog must refresh the service-worker registration independently of app.js');
assert.ok(boot.includes("navigator.serviceWorker.getRegistration('./')"), 'recovery must target only this app service-worker scope');
assert.ok(boot.includes('registration?.unregister?.()'), 'recovery must be able to remove a broken app service worker');
assert.ok(boot.includes("name.startsWith(CACHE_PREFIX)"), 'recovery must clear only Rain-Track PWA caches');
assert.ok(boot.includes("url.searchParams.set('_boot'"), 'recovery reload must bypass the stale navigation state');

assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa29'/);
assert.ok(sw.includes("'./js/boot-watchdog.js'"), 'boot watchdog must be in the atomic App Shell');
assert.ok(sw.includes('await self.skipWaiting()'), 'new atomic shells must activate without waiting for a broken old page');
assert.ok(!sw.includes('OPTIONAL_EXTERNAL'), 'service-worker installation must not wait for third-party Leaflet assets');
assert.ok(sw.includes('const priorShells = keys.filter'), 'activation must detect version migrations');
assert.ok(sw.includes("self.clients.matchAll({ type:'window', includeUncontrolled:true })"), 'version migration must find already-open windows');
assert.ok(sw.includes('await client.navigate(client.url)'), 'version migration must reload open windows onto the new shell');

console.log('Frontend boot resilience + pwa29 self-heal gate PASS');
