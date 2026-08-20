import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RAIN_HOME_INTENSITY_THRESHOLDS,
  buildSteppedIntensityStops,
  rainfallIntensityStyle
} from '../js/rain-home-chart-intensity.js';
import { scrollPixelsToSvgUnits } from '../js/rain-home-chart-fixed-y.js';

const source = readFileSync('js/rain-home-chart-intensity.js', 'utf8');
const fixedYSource = readFileSync('js/rain-home-chart-fixed-y.js', 'utf8');
const smoke = readFileSync('js/forecast-map-smoke.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

assert.deepEqual(RAIN_HOME_INTENSITY_THRESHOLDS, [0.5, 2, 5, 10], 'Rain Home intensity thresholds must stay absolute and independent of the dynamic Y axis');
assert.equal(rainfallIntensityStyle(0).opacity, 0, 'zero rain must not create a visible area fill');
assert.equal(rainfallIntensityStyle(0.49).color, '#2aa6e8', 'sub-0.5 rain must use the weak blue band');
assert.equal(rainfallIntensityStyle(0.5).color, '#1fc69a', '0.5 mm / 30 min must enter the green band');
assert.equal(rainfallIntensityStyle(2).color, '#d6d600', '2 mm / 30 min must enter the yellow band');
assert.equal(rainfallIntensityStyle(5).color, '#f28b20', '5 mm / 30 min must enter the orange band');
assert.equal(rainfallIntensityStyle(10).color, '#d73545', '10 mm / 30 min must enter the red band');

const stops = buildSteppedIntensityStops([
  { offset:.25, amountMm:.2 },
  { offset:.5, amountMm:1.2 },
  { offset:.75, amountMm:6 },
  { offset:1, amountMm:12 }
]);
assert.ok(stops.length >= 10, 'stepped intensity gradient must preserve discrete point bands');
assert.equal(stops[0].offset, 0, 'gradient must extend the first point colour to the start of the plot');
assert.equal(stops.at(-1).offset, 1, 'gradient must extend the final point colour to the end of the plot');
const duplicateOffsets = stops.filter((stop, index) => index > 0 && stop.offset === stops[index - 1].offset);
assert.ok(duplicateOffsets.length >= 3, 'adjacent point bands must change colour at midpoint boundaries instead of blending arbitrary hues');

assert.equal(scrollPixelsToSvgUnits(0, 860, 700), 0, 'zero horizontal scroll must not move the Y axis');
assert.ok(Math.abs(scrollPixelsToSvgUnits(200, 860, 700) - (200 * 700 / 860)) < 1e-9, 'Y-axis compensation must convert CSS scroll pixels through the live SVG scale');
assert.equal(scrollPixelsToSvgUnits(200, 0, 700), 0, 'invalid rendered width must fail soft');

for (const marker of [
  "const CHART_MIN_WIDTH_PX = 840",
  'overflow-x:auto',
  '.rain-home-chart-scroll .rain-home-chart{width:max(100%,${CHART_MIN_WIDTH_PX}px)',
  '@media(max-width:700px)',
  'width:860px',
  "const SERIES_SESSION_PREFIX = 'rain-home-series-v1:'",
  'sessionStorage.getItem(`${SERIES_SESSION_PREFIX}${pointKey}`)',
  "data-rain-home-intensity-layer",
  "data-rain-home-intensity-legend",
  '左右滑動查看完整 2 小時',
  "MutationObserver(() => enhanceCurrentChart())"
]) assert.ok(source.includes(marker), `Rain Home chart intensity marker missing: ${marker}`);

for (const marker of [
  "const CHART_SELECTOR = '.rain-home-chart-scroll .rain-home-chart'",
  "const FIXED_LABEL_SELECTOR = '.rain-home-axis-label'",
  "chart.dataset.rainHomeFixedYAxis = '1'",
  "label.dataset.rainHomeFixedYLabel = '1'",
  "viewport.addEventListener('scroll'",
  'scrollPixelsToSvgUnits(binding.viewport.scrollLeft, renderedWidth, viewBoxWidth(binding.chart))',
  "label.setAttribute('transform', transform)",
  'paint-order:stroke fill',
  "MutationObserver(() => enhanceCurrentChart())"
]) assert.ok(fixedYSource.includes(marker), `Rain Home fixed Y-axis marker missing: ${marker}`);

for (const forbidden of [
  'fetchSwirlsPointSeries',
  "from './api.js'",
  'fetch(',
  '/point-series',
  '/api/rain/swirls'
]) {
  assert.ok(!source.includes(forbidden), `chart intensity enhancement must not become a second weather client: ${forbidden}`);
  assert.ok(!fixedYSource.includes(forbidden), `fixed Y-axis polish must remain presentation-only: ${forbidden}`);
}

assert.ok(!/\.scrollLeft\s*=/.test(fixedYSource), 'fixed Y-axis polish must never change the user chart scroll position');
assert.ok(smoke.includes("'./rain-home-chart-intensity.js'"), 'chart intensity must load as a best-effort optional Home enhancement');
assert.ok(smoke.includes("'./rain-home-chart-fixed-y.js'"), 'fixed Y axis must load as a best-effort optional Home enhancement');
assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa55'/);
assert.ok(sw.includes("'./js/rain-home-chart-intensity.js'"), 'chart intensity must be included in the PWA dependency inventory');
assert.ok(sw.includes("'./js/rain-home-chart-fixed-y.js'"), 'fixed Y-axis polish must be included in the PWA dependency inventory');

console.log('Rain Home fixed intensity bands + horizontal chart + fixed Y axis + pwa55 regression gate PASS');
