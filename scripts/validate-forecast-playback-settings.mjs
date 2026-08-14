import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const timeline = readFileSync('js/forecast-map-timeline.js', 'utf8');
const mode = readFileSync('js/rain-map-mode.js', 'utf8');
const serviceWorker = readFileSync('service-worker.js', 'utf8');

for (const marker of [
  'forecast-play-button',
  'toggleForecastPlayback',
  'stopForecastPlayback',
  'setForecastPlaybackSpeed',
  "hkRainForecastSpeed",
  "document.visibilityState === 'hidden'",
  'await setFrame(nextIndex, { fromPlayback:true })'
]) {
  assert.ok(timeline.includes(marker), `forecast playback marker missing: ${marker}`);
}

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
assert.ok(serviceWorker.includes("point-rain-pwa-v1.6.4-pwa19"), 'PWA shell version was not bumped to pwa19');

console.log('Forecast playback + separated settings gate PASS');
