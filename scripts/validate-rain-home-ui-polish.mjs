import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  observedRadarLooksDry,
  splitNowNextTimingText
} from '../js/rain-home-ui-polish.js';

const source = readFileSync('js/rain-home-ui-polish.js', 'utf8');
const smoke = readFileSync('js/forecast-map-smoke.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

assert.deepEqual(splitNowNextTimingText('雷達截至 17:12 暫未見明顯回波 · SWIRLS 剩餘時段雨量偏低'), [
  { label:'現在', text:'雷達截至 17:12 暫未見明顯回波' },
  { label:'接下來', text:'SWIRLS 剩餘時段雨量偏低' }
]);
assert.deepEqual(splitNowNextTimingText('單一狀態'), [], 'single status must remain untouched');
assert.equal(observedRadarLooksDry(['rain-home-observed-segment level-0', 'rain-home-observed-segment level-0']), true);
assert.equal(observedRadarLooksDry(['rain-home-observed-segment level-0', 'rain-home-observed-segment level-2']), false);
assert.equal(observedRadarLooksDry([]), false);

for (const marker of [
  'data-rain-home-ui-polish="2"',
  '.rain-home-now-next-item',
  '.rain-home-observed.is-dry .rain-home-observed-track',
  '.rain-home-chart-scroll{width:100%;overflow:visible!important',
  '.rain-home-chart-scroll .rain-home-chart{display:block;width:100%!important',
  '.rain-home-chart-scroll-hint{display:none!important}',
  '.rain-home-chart-y-gutter{display:none!important}',
  '.rain-home-axis-label{opacity:1!important}',
  "String(label.textContent || '').trim() === '基準'",
  "MutationObserver(schedulePolish)",
  "window.addEventListener('rain:location-change', schedulePolish)",
  "window.addEventListener('rain:refresh', schedulePolish)"
]) assert.ok(source.includes(marker), `Rain Home UI polish marker missing: ${marker}`);

for (const forbidden of [
  "from './api.js'",
  'fetchSwirlsPointSeries',
  'fetchRadarFrames',
  'fetch(',
  '/api/rain/',
  '/api/radar/'
]) assert.ok(!source.includes(forbidden), `Rain Home UI polish must remain presentation-only: ${forbidden}`);

assert.ok(smoke.includes("'./rain-home-ui-polish.js'"), 'Rain Home UI polish must load as a best-effort optional enhancement');
assert.ok(smoke.includes('Promise.allSettled(OPTIONAL_MAP_MODULES.map(path => import(path)))'), 'UI polish must remain isolated behind optional module loading');
assert.ok(sw.includes("'./js/rain-home-ui-polish.js'"), 'Rain Home UI polish must be present in PWA dependency inventory');
assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa61'/);

console.log('Rain Home compact Now/Next + dry Radar + fit-width chart presentation gate PASS');
