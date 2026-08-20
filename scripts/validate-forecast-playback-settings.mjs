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
  "from './state.js'",
  'forecast-map-fullscreen-position-style',
  'flex:1 1 0!important',
  'height:auto!important',
  'min-height:0!important',
  'bottom:calc(12px + var(--safe-bottom))!important',
  'forecast-mobile-scrubber',
  'forecast-mobile-range',
  'forecast-mobile-output',
  "range?.addEventListener('input'",
  "range?.addEventListener('change'",
  'target.click()',
  'stopForecastPlayback()',
  "#forecast-map-timeline .forecast-frame-buttons{display:none!important}",
  "state.map?.invalidateSize?.({ pan:false, animate:false })",
  'forecast-map-info-button',
  'forecast-map-info-note',
  'INFO_HIDE_MS = 4500',
  'setTimeout(hideForecastInfo, INFO_HIDE_MS)',
  '時間點相隔 6 分鐘',
  '30 分鐘累積預測雨量',
  'forecast-map-product-meta',
  "meta.textContent = `${source} · 基準 ${timeText(snapshot?.issueTime)}`"
]) {
  assert.ok(timeline.includes(marker), `map-first forecast timeline marker missing: ${marker}`);
}

for (const hiddenMarker of [
  '#forecast-map-timeline #forecast-map-title',
  '#forecast-map-timeline #forecast-map-unit',
  '#forecast-map-timeline #forecast-map-window',
  '#forecast-map-timeline #forecast-map-counter',
  '#forecast-map-timeline #forecast-map-issued',
  '#forecast-map-timeline .forecast-map-legend-title'
]) {
  assert.ok(timeline.includes(hiddenMarker), `technical HUD element is not hidden by default: ${hiddenMarker}`);
}
assert.ok(timeline.includes('display:none!important'), 'technical Forecast Map annotations must be hidden in the normal HUD');
assert.ok(timeline.includes("infoButton.addEventListener('click'"), 'data semantics must be revealed only from an explicit info-button click');
assert.ok(timeline.includes("if (event.key === 'Escape') hideForecastInfo()"), 'temporary disclosure must be dismissible with Escape');

const inputHandler = timeline.match(/range\?\.addEventListener\('input',[\s\S]*?\n  \}\);/)?.[0] || '';
assert.ok(inputHandler, 'mobile scrubber input handler missing');
assert.ok(!inputHandler.includes('target.click()'), 'scrubber input must not trigger frame fetches while the user is dragging');
assert.ok(!inputHandler.includes('setForecastMapIndex'), 'scrubber input must not call the frame loader while dragging');
assert.ok(!timeline.includes('height:100%!important;overflow:hidden!important;visibility:visible'), 'timeline polish must not reintroduce the overflowing 100%-height flex child pattern');

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
assert.ok(Number(shellVersion[1]) >= 41, `Forecast Map disclosure polish requires PWA generation at least pwa41, got pwa${shellVersion[1]}`);
assert.ok(serviceWorker.includes("'./js/forecast-map-timeline.js'"), 'forecast timeline wrapper is missing from the PWA app shell inventory');
assert.ok(serviceWorker.includes("'./js/forecast-map-timeline-core.js'"), 'forecast timeline core is missing from the PWA app shell inventory');
assert.ok(serviceWorker.includes("'./js/rain-map-mode-heavy.js'"), 'full rain-map mode implementation is missing from the PWA app shell inventory');

console.log('Forecast playback + fullscreen viewport + on-demand data-note validation passed');
