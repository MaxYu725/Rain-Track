import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
const home = readFileSync(new URL('../js/rain-home.js', import.meta.url), 'utf8');
const time = readFileSync(new URL('../js/rain-home-time.js', import.meta.url), 'utf8');
const state = readFileSync(new URL('../js/state.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../js/rain-home-shell.js', import.meta.url), 'utf8');
const smoke = readFileSync(new URL('../js/forecast-map-smoke.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

assert.match(api, /fetchSwirlsPointSeries/);
assert.match(api, /\/api\/rain\/swirls\/point-series/);
assert.ok(!api.includes('fetchSwirlsPointFrame'), 'Rain Home API must not expose the 16-frame fallback helper');
assert.ok(!api.includes("cache:'no-store'"), 'generic browser API requests must not force no-store');

assert.match(home, /FRAME_COUNT\s*=\s*16/);
assert.match(home, /RAIN_HOME_CADENCE_MINUTES/);
assert.match(home, /Number\(data\.accumulationMinutes\) !== 30/);
assert.match(home, /expectedRainHomeLeadMinutes/);
assert.match(home, /每 6 分鐘預測/);
assert.match(home, /數值代表 30 分鐘預測雨量/);
assert.match(home, /setRainMapMode\('forecast'\)/);
assert.match(home, /查看 2 小時雨區/);
assert.ok(!home.includes('loadSeriesViaFrames'), 'Rain Home must not reconstruct a series through 16 /point requests');
assert.ok(!home.includes('fetchSwirlsPointFrame'), 'Rain Home must have exactly one SWIRLS client path');
assert.ok(!home.includes("window.addEventListener('online'"), 'network recovery must not trigger an automatic retry');
assert.ok(!home.includes('data-rain-home-retry'), 'terminal error state must not create a hidden retry path');
assert.ok(home.includes("window.addEventListener('rain:location-change'"), 'location change must be an explicit fetch trigger');
assert.ok(home.includes("document.getElementById('refresh-button')?.addEventListener('click'"), 'user refresh must be an explicit fetch trigger');
assert.ok(home.includes('observer = new MutationObserver(restoreOwnedView)'), 'DOM ownership observer must only restore rendered state');

const restoreBody = home.match(/function restoreOwnedView\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.ok(restoreBody, 'restoreOwnedView body missing');
assert.ok(!restoreBody.includes('requestSeries'), 'MutationObserver callback must never trigger a network request');
assert.ok(!restoreBody.includes('fetchSwirlsPointSeries'), 'MutationObserver callback must never fetch SWIRLS');

assert.ok(state.includes("new CustomEvent('rain:location-change'"), 'state.selected changes must emit an explicit location event');
assert.match(time, /RAIN_HOME_FIRST_LEAD_MINUTES\s*=\s*30/);
assert.match(time, /RAIN_HOME_CADENCE_MINUTES\s*=\s*6/);
assert.match(time, /RAIN_HOME_HORIZON_MINUTES\s*=\s*120/);

for (const marker of [
  "localStorage.removeItem('hkRainSheetMode')",
  "localStorage.removeItem('hkRainSheetUserMode')",
  'panelHasLegacySheetState',
  'bodyHasLegacySheetState',
  'new MutationObserver(restorePanelIfNeeded)',
  'new MutationObserver(restoreBodyIfNeeded)',
  "attributeFilter:['class', 'style', 'data-sheet']"
]) assert.ok(shell.includes(marker), `Rain Home shell cleanup marker missing: ${marker}`);

assert.ok(!shell.includes('new MutationObserver(stripLegacySheetState)'), 'an observer must never call the mutating cleanup function unconditionally');
const stripShell = shell.match(/function stripLegacySheetState\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.ok(stripShell, 'stripLegacySheetState body missing');
assert.ok(stripShell.includes('if (panel && panelHasLegacySheetState(panel))'), 'panel mutations must be guarded by actual legacy state');
assert.ok(stripShell.includes("if (panel.hasAttribute('data-sheet')) panel.removeAttribute('data-sheet')"), 'data-sheet removal must be conditional');
assert.ok(stripShell.includes("if (panel.style.getPropertyValue('height')) panel.style.removeProperty('height')"), 'style removal must be conditional');
assert.ok(stripShell.includes('if (bodyHasLegacySheetState())'), 'body class cleanup must be conditional');

assert.match(smoke, /import '\.\/rain-home\.js';/);
assert.match(smoke, /import '\.\/rain-home-shell\.js';/);
assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa(\d+)'/);

console.log('Rain Home zero-base one-request architecture validation passed');
