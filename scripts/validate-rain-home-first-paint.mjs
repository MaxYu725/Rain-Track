import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync('index.html', 'utf8');
const criticalCss = readFileSync('css/rain-home-first-paint.css', 'utf8');
const boot = readFileSync('js/boot-watchdog.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

assert.ok(index.includes('<body class="rain-home-v2">'), 'Rain Home mode must be present before the browser first paint');
assert.ok(index.includes('<link rel="stylesheet" href="./css/rain-home-first-paint.css">'), 'critical Rain Home first-paint CSS must be render-blocking in index.html');
assert.ok(index.includes('data-rain-home-first-paint'), 'index.html must contain a Rain Home-native static loading shell');
assert.ok(index.includes('正在整理未來兩小時雨勢'), 'static first paint must use the Rain Home loading language');
assert.ok(index.includes('rain-home-skeleton-chart'), 'static first paint must include the Rain Home skeleton instead of the legacy spinner-only view');
assert.ok(index.indexOf('data-rain-home-first-paint') < index.indexOf('<script type="module"'), 'Rain Home first paint must exist before application modules execute');

const homeScript = index.indexOf('<script type="module" src="./js/rain-home.js"></script>');
const appScript = index.indexOf('<script type="module" src="./js/app.js"></script>');
assert.ok(homeScript >= 0, 'Rain Home must be loaded directly from index.html');
assert.ok(appScript > homeScript, 'Rain Home must start before the legacy app module graph');

for (const legacyMarker of [
  'id="sheet-handle"',
  'id="forecast-toggle"',
  'data-sheet="half"',
  '正在讀取定點雨量預報…'
]) {
  assert.ok(!index.includes(legacyMarker), `legacy first-paint marker must not return to index.html: ${legacyMarker}`);
}

for (const marker of [
  'body.rain-home-v2:not(.rain-map-view) #rain-map{visibility:hidden!important',
  'body.rain-home-v2:not(.rain-map-view) #forecast-panel{',
  'position:relative!important',
  '.rain-home-first-paint .rain-home-loading{',
  '.rain-home-first-paint .rain-home-skeleton-chart{',
  '@media(prefers-reduced-motion:reduce)'
]) {
  assert.ok(criticalCss.includes(marker), `critical first-paint CSS marker missing: ${marker}`);
}

assert.ok(boot.includes("!root.hasAttribute('data-rain-home-first-paint')"), 'boot watchdog must distinguish static first paint from JavaScript takeover');
assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa32'/);

const appShell = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] || '';
const coreShell = sw.match(/const CORE_SHELL = \[([\s\S]*?)\];/)?.[1] || '';
assert.ok(appShell.includes("'./css/rain-home-first-paint.css'"), 'first-paint CSS must remain in the full PWA inventory');
assert.ok(coreShell.includes("'./css/rain-home-first-paint.css'"), 'first-paint CSS must be atomic with the Rain Home core');
assert.ok(coreShell.includes("'./js/rain-home.js'"), 'direct Rain Home module must be atomic with the PWA core');

console.log('Rain Home static first-paint + direct startup + pwa32 regression gate PASS');
