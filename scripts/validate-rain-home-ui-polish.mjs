import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  forecastAmountsLookDry,
  forecastDisplayRatio,
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

assert.equal(forecastDisplayRatio(30), 0, '+30 must become the visible left edge');
assert.equal(forecastDisplayRatio(60), 1 / 3, '+60 must sit one third across the visible forecast span');
assert.equal(forecastDisplayRatio(90), 2 / 3, '+90 must sit two thirds across the visible forecast span');
assert.equal(forecastDisplayRatio(120), 1, '+120 must become the visible right edge');
assert.equal(forecastDisplayRatio(75, { firstLeadMinutes:30, horizonMinutes:120 }), 0.5);
assert.equal(forecastDisplayRatio(30, { firstLeadMinutes:120, horizonMinutes:120 }), null, 'invalid span must fail soft');

assert.equal(forecastAmountsLookDry([0, 0, 0]), true, 'all-zero forecast should use the compact dry chart');
assert.equal(forecastAmountsLookDry([0, 0.04, 0]), true, 'sub-display-threshold rain may remain in compact dry mode');
assert.equal(forecastAmountsLookDry([0, 0.05, 0]), false, 'visible rain must preserve full chart height');
assert.equal(forecastAmountsLookDry([]), false, 'missing forecast amounts must fail soft');

for (const marker of [
  'data-rain-home-ui-polish="4"',
  '.is-dry-now-next .rain-home-detail{display:none}',
  "verdict.textContent = '暫無明顯降雨'",
  '.rain-home-now-next-item',
  "未見明顯回波` : summary.dataset.rainHomeUiOriginalSummary",
  '.rain-home-observed.is-dry .rain-home-observed-times{display:none}',
  '.rain-home-chart-scroll{width:100%;overflow:visible!important',
  '.rain-home-chart-scroll .rain-home-chart{display:block;width:100%!important',
  '.rain-home-chart-y-gutter{display:none!important}',
  "chart.dataset.rainHomeForecastAxis = '4'",
  'forecastDisplayRatio(leadMinutes',
  "if (text === '基準')",
  "text.match(/^\\+(\\d+)$/)",
  "leadMinutes === firstLead ? 'start' : leadMinutes === horizon ? 'end' : 'middle'",
  "chart.addEventListener('pointerdown'",
  "nearest.hit.click()",
  'const targetHeight = 210',
  'const targetBottom = 128',
  "chart.dataset.rainHomeDryChart = '1'",
  "help.textContent = '點按時間查看雨量'",
  'body.rain-home-v2:not(.rain-map-view) .header-top-bar',
  '.global-controls .radar-entry-button',
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

console.log('Rain Home final mobile proportions + compact dry chart + full-width +30..+120 axis gate PASS');
