import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rainfallScaleSpec } from '../js/rain-home-chart-scale.js';
import {
  RAIN_HOME_INTENSITY_THRESHOLDS,
  buildSteppedIntensityStops,
  rainfallIntensityStyle
} from '../js/rain-home-chart-intensity.js';
import { forecastAmountsLookDry } from '../js/rain-home-ui-polish.js';

assert.deepEqual(RAIN_HOME_INTENSITY_THRESHOLDS, [0.5, 2, 5, 10]);

const scenarios = [
  {
    name:'first visible signal',
    values:[0, 0, 0.06, 0.08, 0.12, 0.2, 0.14, 0.08, 0, 0, 0, 0, 0, 0, 0, 0],
    expectedLabel:'偏弱'
  },
  {
    name:'light shower',
    values:[0, 0.1, 0.25, 0.45, 0.8, 0.7, 0.5, 0.3, 0.15, 0.05, 0, 0, 0, 0, 0, 0],
    expectedLabel:'較弱至中等'
  },
  {
    name:'moderate burst',
    values:[0, 0.2, 0.6, 1.1, 1.8, 2.4, 2.0, 1.4, 0.8, 0.4, 0.1, 0, 0, 0, 0, 0],
    expectedLabel:'中等'
  },
  {
    name:'heavy short peak',
    values:[0, 0.3, 0.9, 1.8, 3.2, 5.5, 3.8, 2.1, 1.2, 0.5, 0.2, 0, 0, 0, 0, 0],
    expectedLabel:'較強'
  },
  {
    name:'very heavy peak',
    values:[0, 0.5, 1.4, 3.2, 6.5, 10.5, 7.5, 4.3, 2.2, 1.0, 0.4, 0.1, 0, 0, 0, 0],
    expectedLabel:'強'
  }
];

for (const scenario of scenarios) {
  assert.equal(
    forecastAmountsLookDry(scenario.values),
    false,
    `${scenario.name}: any visible >=0.05 mm signal must keep the quantitative wet chart`
  );

  const peak = Math.max(...scenario.values);
  const scale = rainfallScaleSpec(peak);
  assert.ok(scale.max >= peak, `${scenario.name}: Y-axis max must contain the peak`);
  assert.equal(scale.ticks[0], 0, `${scenario.name}: Y-axis must start at zero`);
  assert.equal(scale.ticks.at(-1), scale.max, `${scenario.name}: top tick must match Y-axis max`);
  assert.ok(scale.ticks.length >= 4 && scale.ticks.length <= 7, `${scenario.name}: keep Y-axis tick density readable`);
  assert.equal(rainfallIntensityStyle(peak).label, scenario.expectedLabel, `${scenario.name}: peak intensity band mismatch`);
}

assert.equal(forecastAmountsLookDry(new Array(16).fill(0)), true, 'all-zero series must stay on the compact dry timeline');
assert.equal(forecastAmountsLookDry([0, 0.04, 0]), true, 'sub-display-threshold series may stay compact');
assert.equal(forecastAmountsLookDry([0, 0.05, 0]), false, '0.05 mm must switch back to the quantitative wet chart');

const stops = buildSteppedIntensityStops([
  { offset:0, amountMm:0.2 },
  { offset:0.33, amountMm:0.8 },
  { offset:0.66, amountMm:2.4 },
  { offset:1, amountMm:5.5 }
]);
assert.ok(stops.length >= 8, 'stepped intensity gradient should preserve interval transitions');
assert.equal(stops[0].color, rainfallIntensityStyle(0.2).color);
assert.equal(stops.at(-1).color, rainfallIntensityStyle(5.5).color);

const v5 = readFileSync('js/rain-home-ui-polish-v5.js', 'utf8');
assert.ok(
  v5.includes('.is-dry-chart .rain-home-chart-scroll{display:none!important}'),
  'v5 may hide the quantitative chart only behind the dry-state class'
);
assert.ok(
  v5.includes('.is-dry-chart .rain-home-dry-timeline{display:block'),
  'dry timeline must remain conditional on dry-state detection'
);
assert.ok(
  !v5.includes('.rain-home-chart-scroll{display:none!important}\n'),
  'wet chart must not be hidden unconditionally'
);

console.log('Rain Home wet-state QA gate PASS');
