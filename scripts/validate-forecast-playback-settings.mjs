import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const timeline = readFileSync('js/forecast-map-timeline.js', 'utf8');
const timelineCore = readFileSync('js/forecast-map-timeline-core.js', 'utf8');
const modeFacade = readFileSync('js/rain-map-mode.js', 'utf8');
const mode = readFileSync('js/rain-map-mode-heavy.js', 'utf8');
const serviceWorker = readFileSync('service-worker.js', 'utf8');

for (const marker of [
  'forecast-play-button',
  'toggleForecastPlayback',
  'stopForecastPlayback',
  'setForecastPlaybackSpeed',
  "hkRainForecastSpeed",
  "document.visibilityState === 'hidden'",
  'await setFrame(nextIndex, { fromPlayback:true })',
  'export function initForecastTimeline()',
  "document.readyState === 'loading'",
  'initForecastTimeline();'
]) {
  assert.ok(timelineCore.includes(marker), `forecast playback marker missing from core: ${marker}`);
}

for (const marker of [
  "from './forecast-map-timeline-core.js'",
  'forecast-map-fullscreen-position-style',
  'bottom:calc(14px + var(--safe-bottom))!important',
  'forecast-mobile-scrubber',
  'forecast-mobile-range',
  'forecast-mobile-output',
  "range?.addEventListener('input'",
  "range?.addEventListener('change'",
  'target.click()',
  'stopForecastPlayback()',
  "#forecast-map-timeline .forecast-frame-buttons{display:none!important}"
]) {
  assert.ok(timeline.includes(marker), `map-first forecast timeline marker missing: ${marker}`);
}

const inputHandler = timeline.match(/range\?\.addEventListener\('input',[\s\S]*?\n  \}\);/)?.[0] || '';
assert.ok(inputHandler, 'mobile scrubber input handler missing');
assert.ok(!inputHandler.includes('target.click()'), 'scrubber input must not trigger frame fetches while the user is dragging');
assert.ok(!inputHandler.includes('setForecastMapIndex'), 'scrubber input must not call the frame loader while dragging');

for (const removedMarker of [
  'forecast-map-sheet-avoidance-style',
  '--forecast-timeline-bottom',
  'forecast-panel',
  'ResizeObserver',
  'sheet-obscured',
  'FORECAST_SHEET_GAP_PX'
]) {
  assert.ok(!timeline.includes(removedMarker), `legacy bottom-sheet avoidance still present: ${removedMarker}`);
}

assert.ok(!timeline.includes('radar-timeline'), 'forecast timeline wrapper must not alter radar timeline behavior');

assert.ok(modeFacade.includes("import('./rain-map-mode-heavy.js')"), 'mode facade must lazily load the full map settings implementation');
for (const marker of [
  'rain-radar-settings',
  'rain-forecast-settings',
  'forecast-map-opacity',
  'forecast-playback-speed',
  'forecast-autoplay-toggle',
  'forecast-settings-play',
  "hkRainForecastOpacity",
  "hkRainForecastAutoplay",
  "loadForecastMap({ frameIndex:0, opacity:forecastOpacity / 100 })"
]) {
  assert.ok(mode.includes(marker), `mode-specific settings marker missing: ${marker}`);
}

assert.ok(mode.includes("selectedMode !== 'radar'"), 'radar settings are not mode-gated');
assert.ok(mode.includes("selectedMode !== 'forecast'"), 'forecast settings are not mode-gated');
assert.ok(mode.includes("legacyObserver.observe(radarPanel, { childList:true })"), 'radar dynamic controls are not observed safely');
assert.ok(!mode.includes('subtree:true'), 'settings observer must not watch the whole subtree and self-loop on UI text changes');

const shellVersion = serviceWorker.match(/const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa(\d+)'/);
assert.ok(shellVersion, 'PWA shell version marker is missing');
assert.ok(Number(shellVersion[1]) >= 39, `Forecast Map first pass requires PWA generation at least pwa39, got pwa${shellVersion[1]}`);
assert.ok(serviceWorker.includes("'./js/forecast-map-timeline.js'"), 'forecast timeline wrapper is missing from the PWA app shell inventory');
assert.ok(serviceWorker.includes("'./js/forecast-map-timeline-core.js'"), 'forecast timeline core is missing from the PWA app shell inventory');
assert.ok(serviceWorker.includes("'./js/rain-map-mode-heavy.js'"), 'full rain-map mode implementation is missing from the PWA app shell inventory');

console.log('Forecast playback + mobile scrubber + lazy map-mode validation passed');
