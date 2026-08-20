import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RAIN_HOME_INTENSITY_THRESHOLDS,
  buildSteppedIntensityStops,
  rainfallIntensityStyle
} from '../js/rain-home-chart-intensity.js';
import { axisLabelCenterPx } from '../js/rain-home-chart-fixed-y.js';
import { rainfallScaleSpec } from '../js/rain-home-chart-scale.js';

const source = readFileSync('js/rain-home-chart-intensity.js', 'utf8');
const fixedYSource = readFileSync('js/rain-home-chart-fixed-y.js', 'utf8');
const scaleSource = readFileSync('js/rain-home-chart-scale-polish.js', 'utf8');
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

assert.deepEqual(rainfallScaleSpec(0.16), { max:0.3, step:0.1, ticks:[0,0.1,0.2,0.3] }, 'very small signals must keep the readable 0–0.3 scale');
assert.equal(rainfallScaleSpec(0.44).max, 0.5, '0.44 mm peak should use 0.5 instead of an oversized scale');
assert.equal(rainfallScaleSpec(1.7).max, 2, '1.7 mm peak should use 2');
assert.equal(rainfallScaleSpec(3.2).max, 4, '3.2 mm peak should use 4');
assert.equal(rainfallScaleSpec(5.2).max, 6, '5.2 mm peak should use 6 instead of jumping to 10');
assert.equal(rainfallScaleSpec(12).max, 15, '12 mm peak should use a readable 15 scale');
for (const peak of [0.21,0.44,0.5,1.7,3.2,5.2,9.5,12,24,50]) {
  const spec = rainfallScaleSpec(peak);
  assert.ok(spec.max >= peak, `scale max must cover peak ${peak}`);
  assert.ok(spec.ticks.length >= 4 && spec.ticks.length <= 7, `scale ${peak} must keep a readable tick count`);
  assert.equal(spec.ticks[0], 0);
  assert.equal(spec.ticks.at(-1), spec.max);
}

assert.equal(axisLabelCenterPx(100, 20, 40), 70, 'gutter labels must preserve the rendered SVG label centre');
assert.equal(axisLabelCenterPx(40, 0, 40), 0, 'zero-height labels at chart top must remain aligned');
assert.equal(axisLabelCenterPx(Number.NaN, 20, 40), 0, 'invalid label geometry must fail soft');

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
  "const AXIS_LABEL_SELECTOR = '.rain-home-axis-label'",
  'const GUTTER_WIDTH_PX = 48',
  "stage.className = 'rain-home-chart-stage'",
  "gutter.className = 'rain-home-chart-y-gutter'",
  "clone.className = 'rain-home-chart-y-gutter-label'",
  "chart.dataset.rainHomeFixedYAxis = '2'",
  '.rain-home-chart[data-rain-home-fixed-y-axis="2"] .rain-home-axis-label{opacity:0}',
  'label.removeAttribute(\'transform\')',
  'axisLabelCenterPx(rect.top, rect.height, chartRect.top)',
  'binding.gutter.style.height',
  'new ResizeObserver(() => scheduleSync(binding))',
  "MutationObserver(() => enhanceCurrentChart())"
]) assert.ok(fixedYSource.includes(marker), `Rain Home Y-axis gutter marker missing: ${marker}`);

for (const marker of [
  "from './rain-home-chart-scale.js'",
  "const SERIES_SESSION_PREFIX = 'rain-home-series-v1:'",
  'rainfallScaleSpec(peak)',
  'replaceYAxis(chart, spec',
  'resetFixedYAxis(chart)',
  "chart.dataset.rainHomeScalePolish = '1'",
  "MutationObserver(() => enhanceCurrentChart())"
]) assert.ok(scaleSource.includes(marker), `Rain Home chart scale polish marker missing: ${marker}`);

for (const forbidden of [
  'fetchSwirlsPointSeries',
  "from './api.js'",
  'fetch(',
  '/point-series',
  '/api/rain/swirls'
]) {
  assert.ok(!source.includes(forbidden), `chart intensity enhancement must not become a second weather client: ${forbidden}`);
  assert.ok(!fixedYSource.includes(forbidden), `Y-axis gutter must remain presentation-only: ${forbidden}`);
  assert.ok(!scaleSource.includes(forbidden), `chart scale polish must remain presentation-only: ${forbidden}`);
}

for (const forbidden of [
  "viewport.addEventListener('scroll'",
  'scrollPixelsToSvgUnits',
  "label.setAttribute('transform'",
  'paint-order:stroke fill'
]) assert.ok(!fixedYSource.includes(forbidden), `Y-axis gutter must not use the old scroll-translation approach: ${forbidden}`);
assert.ok(!/\.scrollLeft\s*=/.test(fixedYSource), 'Y-axis gutter must never change the user chart scroll position');
assert.ok(!/\.scrollLeft\s*=/.test(scaleSource), 'chart scale polish must never change the user chart scroll position');

assert.ok(smoke.includes("'./rain-home-chart-scale-polish.js'"), 'chart scale polish must load as a best-effort optional Home enhancement');
assert.ok(smoke.includes("'./rain-home-chart-intensity.js'"), 'chart intensity must load as a best-effort optional Home enhancement');
assert.ok(smoke.includes("'./rain-home-chart-fixed-y.js'"), 'Y-axis gutter must load as a best-effort optional Home enhancement');
assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa61'/);
assert.ok(sw.includes("'./js/rain-home-chart-scale.js'"), 'chart scale model must be included in the PWA dependency inventory');
assert.ok(sw.includes("'./js/rain-home-chart-scale-polish.js'"), 'chart scale polish must be included in the PWA dependency inventory');
assert.ok(sw.includes("'./js/rain-home-chart-intensity.js'"), 'chart intensity must be included in the PWA dependency inventory');
assert.ok(sw.includes("'./js/rain-home-chart-fixed-y.js'"), 'Y-axis gutter must be included in the PWA dependency inventory');

console.log('Rain Home nice dynamic scale + fixed intensity bands + horizontal chart + Y-axis gutter v2 + pwa61 regression gate PASS');
