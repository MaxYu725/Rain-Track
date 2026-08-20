import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const radar = readFileSync('js/radar.js', 'utf8');
const entry = readFileSync('js/radar-entry.js', 'utf8');
const mirror = readFileSync('js/radar-settings-mirror.js', 'utf8');
const smoke = readFileSync('js/forecast-map-smoke.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

for (const marker of [
  'const RECENT_PRELOAD_COUNT = 8',
  'async function showRadarFrame(targetIndex = state.radar.index',
  'const loaded = await preloadImage(url)',
  'state.radar.index = index',
  "new CustomEvent('rain:radar-frame-change'",
  'const shown = await showRadarFrame(targetIndex)',
  'const keepPlaying = await waitForPlaybackDelay(delay, token)',
  'if (!sliderScrubbing) return',
  'event.stopImmediatePropagation()',
  'previewRadarIndex(event.currentTarget.value)',
  'void setRadarIndex(event.currentTarget.value)',
  'loadRadarFrames({ preserveTime:true, fitBounds:true })',
  'loadRadarFrames({ preserveTime:true, fitBounds:false })',
  'document.visibilityState === \'hidden\' || !state.layers.radar || playing || radarBusy',
  "id = 'radar-quick-controls'",
  'changeRadarRange(rangeButton.dataset.radarRange)',
  'changeRadarHeight(heightButton.dataset.radarHeight)',
  "bottom:calc(8px + var(--safe-bottom))!important"
]) assert.ok(radar.includes(marker), `Radar v2 marker missing: ${marker}`);

const preloadPosition = radar.indexOf('const loaded = await preloadImage(url)');
const commitPosition = radar.indexOf('state.radar.index = index');
assert.ok(preloadPosition >= 0 && commitPosition > preloadPosition, 'Radar frame index must commit only after the target image is available');

const loopPosition = radar.indexOf('async function playbackLoop');
const loopEnd = radar.indexOf('function waitForPlaybackDelay', loopPosition);
const loopBody = radar.slice(loopPosition, loopEnd);
assert.ok(loopBody.includes('await showRadarFrame(targetIndex)'), 'autoplay must await each committed Radar frame');
assert.ok(!loopBody.includes('updateTimelineLabels();'), 'autoplay must not advance labels ahead of the Radar image');

const quickStart = radar.indexOf('function ensureRadarQuickControls');
const quickEnd = radar.indexOf('function syncRadarQuickControls', quickStart);
const quickBody = radar.slice(quickStart, quickEnd);
assert.ok(!quickBody.includes('fetchRadarFrames'), 'Radar quick controls must reuse the existing Radar loader');

assert.ok(!radar.includes('function playNext()'), 'legacy timer-first Radar playback must not return');
assert.ok(!radar.includes('setSheetMode('), 'Radar v2 must not depend on the removed mobile bottom sheet');
assert.ok(!radar.includes('bottom:calc(96px + var(--safe-bottom))'), 'Radar timeline must not reserve the removed 96px sheet offset');
assert.ok(!entry.includes('fetchRadarFrames'), 'direct Radar entry must remain navigation-only');

for (const marker of [
  "document.getElementById('radar-range')",
  "document.getElementById('radar-height')",
  "queueMicrotask(syncRadarSettingsMirror)",
  "window.addEventListener('rain:radar-frame-change'",
  "window.addEventListener('rain:map-mode-change'"
]) assert.ok(mirror.includes(marker), `Radar settings mirror marker missing: ${marker}`);
assert.ok(!mirror.includes('fetchRadarFrames'), 'Radar settings mirror must never load Radar data');
assert.ok(smoke.includes("'./radar-settings-mirror.js'"), 'Radar settings mirror must remain an optional map enhancement');

assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa54'/);
assert.ok(sw.includes("'./js/radar.js'"), 'Radar runtime must remain in the PWA dependency inventory');
assert.ok(sw.includes("'./js/radar-entry.js'"), 'Radar entry must remain in the PWA dependency inventory');
assert.ok(sw.includes("'./js/radar-settings-mirror.js'"), 'Radar settings mirror must remain in the PWA dependency inventory');

console.log('Radar commit-based playback + direct controls + synchronized settings + pwa54 regression gate PASS');
