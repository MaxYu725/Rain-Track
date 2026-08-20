import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync('index.html', 'utf8');
const criticalCss = readFileSync('css/rain-home-first-paint.css', 'utf8');
const boot = readFileSync('js/boot-watchdog.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

assert.ok(index.includes('<body class="rain-home-v2">'), 'Rain Home mode must exist before first paint');
assert.ok(index.includes('<link rel="stylesheet" href="./css/rain-home-first-paint.css">'), 'first-paint CSS must remain render-blocking');
assert.ok(index.includes('data-rain-home-first-paint'), 'index.html must contain Rain Home static loading markup');
assert.ok(index.includes('正在整理未來兩小時雨勢'), 'static first paint must use Rain Home loading language');
assert.ok(index.includes('rain-home-skeleton-chart'), 'static first paint must include the Rain Home skeleton');
assert.ok(index.indexOf('data-rain-home-first-paint') < index.indexOf('<script type="module"'), 'static Rain Home must exist before modules execute');

const homeScript = index.indexOf('<script type="module" src="./js/rain-home.js"></script>');
const appScript = index.indexOf('<script type="module" src="./js/app.js"></script>');
assert.ok(homeScript >= 0, 'Rain Home must still have its normal module path');
assert.ok(appScript > homeScript, 'Rain Home module must stay ahead of the legacy app graph');

for (const legacyMarker of [
  'id="sheet-handle"',
  'id="forecast-toggle"',
  'data-sheet="half"',
  '正在讀取定點雨量預報…'
]) assert.ok(!index.includes(legacyMarker), `legacy first-paint marker must not return: ${legacyMarker}`);

for (const marker of [
  'body.rain-home-v2:not(.rain-map-view) #rain-map{visibility:hidden!important',
  'body.rain-home-v2:not(.rain-map-view) #forecast-panel{',
  'position:relative!important',
  '.rain-home-first-paint .rain-home-loading{',
  '.rain-home-first-paint .rain-home-skeleton-chart{',
  '@media(prefers-reduced-motion:reduce)'
]) assert.ok(criticalCss.includes(marker), `critical first-paint CSS marker missing: ${marker}`);

assert.ok(boot.includes('data-rain-boot-recovery'), 'classic watchdog must provide a reload-only recovery UI');
assert.ok(boot.includes('.rain-home-root[data-rain-home-owned="series"]'), 'watchdog must detect normal Rain Home takeover');
for (const forbidden of ['/api/rain/swirls', 'data-rain-critical-fallback', '正在直接讀取 SWIRLS', 'runCriticalForecast']) {
  assert.ok(!boot.includes(forbidden), `first-paint watchdog must not become a second weather client: ${forbidden}`);
}

assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa56'/);
assert.ok(!sw.includes('const CORE_SHELL = ['), 'first paint must not trigger a PWA core prefetch storm');
const appShell = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] || '';
assert.ok(appShell.includes("'./css/rain-home-first-paint.css'"), 'first-paint CSS must remain in dependency inventory');
assert.ok(appShell.includes("'./js/boot-watchdog.js'"), 'boot watchdog must remain in dependency inventory');
assert.ok(appShell.includes("'./js/rain-home.js'"), 'normal Rain Home module must remain in dependency inventory');
assert.ok(appShell.includes("'./js/rain-home-chart-intensity.js'"), 'optional Rain Home chart intensity must remain in dependency inventory');
assert.ok(appShell.includes("'./js/rain-home-chart-fixed-y.js'"), 'optional Y-axis gutter must remain in dependency inventory');
assert.ok(appShell.includes("'./js/radar-entry.js'"), 'Radar entry must remain in dependency inventory');
assert.ok(appShell.includes("'./js/radar-analysis-runtime.js'"), 'optional Radar analysis must remain in dependency inventory');

console.log('Rain Home first paint + optional chart polish/Radar inventory + pwa56 regression gate PASS');
