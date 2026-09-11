import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync('index.html', 'utf8');
const criticalCss = readFileSync('css/rain-home-first-paint.css', 'utf8');
const settingsCss = readFileSync('css/settings-phase1a.css', 'utf8');
const boot = readFileSync('js/boot-watchdog.js', 'utf8');
const mapMode = readFileSync('js/rain-map-mode.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

assert.ok(index.includes('<body class="rain-home-v2">'), 'Rain Home mode must exist before first paint');
assert.ok(index.includes('<link rel="stylesheet" href="./css/rain-home-first-paint.css">'), 'first-paint CSS must remain render-blocking');
assert.ok(index.includes('data-rain-home-first-paint'), 'index.html must retain the deferred Rain Home detail markup');
assert.ok(index.includes('正在整理未來兩小時雨勢'), 'deferred detail shell must retain Rain Home loading language');
assert.ok(index.includes('rain-home-skeleton-chart'), 'deferred detail shell must retain the Rain Home skeleton');
assert.ok(index.indexOf('data-rain-home-first-paint') < index.indexOf('<script type="module"'), 'deferred detail markup must exist before modules execute');

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
  'body.rain-home-v2 #forecast-panel{display:none!important}',
  'body.rain-home-v2.rain-home-details-view #rain-map{visibility:hidden!important',
  'body.rain-home-v2.rain-home-details-view #map-container > :not(#forecast-panel):not(#settings-drawer):not(#drawer-backdrop){display:none!important}',
  'body.rain-home-v2.rain-home-details-view #forecast-panel{',
  'display:block!important',
  'position:relative!important',
  '.rain-home-first-paint .rain-home-loading{',
  '.rain-home-first-paint .rain-home-skeleton-chart{',
  '@media(prefers-reduced-motion:reduce)'
]) assert.ok(criticalCss.includes(marker), `critical map-first CSS marker missing: ${marker}`);

for (const marker of [
  "document.body.classList.add('rain-map-view')",
  "document.body.classList.remove('rain-home-details-view')",
  "button.textContent = '預報詳情'",
  "button.textContent = '← 返回 2 小時雨區'",
  "body.classList.add('rain-home-details-view')",
  "body.classList.remove('rain-map-view')",
  "body.classList.remove('rain-home-details-view')",
  "body.classList.add('rain-map-view')",
  "window.addEventListener('rain:map-ready'",
  "await setRainMapMode('forecast')",
  "bodyObserver.observe(document.body, { attributes:true, attributeFilter:['class'] })"
]) assert.ok(mapMode.includes(marker), `map-first Rain Home marker missing: ${marker}`);
assert.ok(mapMode.includes("body.rain-home-v2.rain-map-view #rain-home-back-map{display:none!important}"), 'legacy map back button must stay hidden in favor of the explicit Details action');
assert.ok(mapMode.includes("body.rain-home-v2.rain-map-view #rain-map-quickviews{max-width:calc(100% - 154px)!important}"), 'Details action must reserve space instead of covering map quick views');

const showDetails = mapMode.match(/function showForecastDetails\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.ok(showDetails, 'showForecastDetails implementation missing');
assert.ok(
  showDetails.indexOf("body.classList.remove('rain-map-view')") < showDetails.indexOf("body.classList.add('rain-home-details-view')"),
  'entering details must remove map view before setting details state so the state observer cannot undo the transition'
);
const bodySync = mapMode.match(/function syncMapFirstBodyState\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.ok(bodySync.includes("if (body.classList.contains('rain-map-view'))"), 'explicit return-to-map state must win over stale details state');
assert.ok(bodySync.includes("body.classList.remove('rain-home-details-view')"), 'return-to-map must clear the details state');

assert.ok(settingsCss.includes('.settings-drawer-phase1a .drawer-heading{display:flex;'), 'mobile settings drawer must keep its close heading visible');
assert.ok(!settingsCss.includes('.settings-drawer-phase1a .drawer-heading{display:none}'), 'mobile settings drawer must never hide its only close control');
assert.ok(settingsCss.includes('.settings-drawer-phase1a .panel-close{flex:0 0 42px'), 'mobile settings close button must retain a stable touch target');

assert.ok(boot.includes('data-rain-boot-recovery'), 'classic watchdog must provide a reload-only recovery UI');
assert.ok(boot.includes('.rain-home-root[data-rain-home-owned="series"]'), 'watchdog must detect normal Rain Home takeover');
for (const forbidden of ['/api/rain/swirls', 'data-rain-critical-fallback', '正在直接讀取 SWIRLS', 'runCriticalForecast']) {
  assert.ok(!boot.includes(forbidden), `first-paint watchdog must not become a second weather client: ${forbidden}`);
}

assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa61'/);
assert.ok(!sw.includes('const CORE_SHELL = ['), 'first paint must not trigger a PWA core prefetch storm');
const appShell = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] || '';
assert.ok(appShell.includes("'./css/rain-home-first-paint.css'"), 'first-paint CSS must remain in dependency inventory');
assert.ok(appShell.includes("'./css/settings-phase1a.css'"), 'settings CSS must remain in dependency inventory');
assert.ok(appShell.includes("'./js/boot-watchdog.js'"), 'boot watchdog must remain in dependency inventory');
assert.ok(appShell.includes("'./js/rain-home.js'"), 'normal Rain Home module must remain in dependency inventory');
assert.ok(appShell.includes("'./js/rain-map-mode.js'"), 'map-first mode controller must remain in dependency inventory');
assert.ok(appShell.includes("'./js/rain-home-chart-scale.js'"), 'Rain Home chart scale model must remain in dependency inventory');
assert.ok(appShell.includes("'./js/rain-home-chart-scale-polish.js'"), 'optional Rain Home chart scale polish must remain in dependency inventory');
assert.ok(appShell.includes("'./js/rain-home-chart-intensity.js'"), 'optional Rain Home chart intensity must remain in dependency inventory');
assert.ok(appShell.includes("'./js/rain-home-chart-fixed-y.js'"), 'optional Y-axis gutter must remain in dependency inventory');
assert.ok(appShell.includes("'./js/rain-home-observed-radar.js'"), 'optional Rain Home Now + Next Radar context must remain in dependency inventory');
assert.ok(appShell.includes("'./js/radar-analysis-image.js'"), 'shared Radar image analysis helper must remain in dependency inventory');
assert.ok(appShell.includes("'./js/radar-entry.js'"), 'Radar entry must remain in dependency inventory');
assert.ok(appShell.includes("'./js/radar-analysis-runtime.js'"), 'optional Radar analysis must remain in dependency inventory');

console.log('Rain Home map-first first paint + mobile escape paths + on-demand details + pwa61 regression gate PASS');
