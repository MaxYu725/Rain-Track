import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RAIN_HOME_CADENCE_MINUTES,
  RAIN_HOME_FIRST_LEAD_MINUTES,
  RAIN_HOME_HORIZON_MINUTES,
  expectedRainHomeLeadMinutes,
  findFirstWetSignalTransition,
  rainHomeLeadRatio
} from '../js/rain-home-time.js';

assert.equal(RAIN_HOME_FIRST_LEAD_MINUTES, 30);
assert.equal(RAIN_HOME_CADENCE_MINUTES, 6);
assert.equal(RAIN_HOME_HORIZON_MINUTES, 120);
assert.equal(expectedRainHomeLeadMinutes(0), 30);
assert.equal(expectedRainHomeLeadMinutes(15), 120);
assert.equal(rainHomeLeadRatio(0), 0);
assert.equal(rainHomeLeadRatio(30), 0.25, 'first SWIRLS sample must sit 25% across a true 0..120 minute axis');
assert.equal(rainHomeLeadRatio(60), 0.5);
assert.equal(rainHomeLeadRatio(120), 1);
assert.equal(rainHomeLeadRatio(-6), 0);
assert.equal(rainHomeLeadRatio(126), 1);

const run = Date.parse('2026-08-19T14:00:00.000Z');
const points = Array.from({ length:16 }, (_, frameIndex) => {
  const leadMinutes = expectedRainHomeLeadMinutes(frameIndex);
  return {
    frameIndex,
    leadMinutes,
    validTime:new Date(run + leadMinutes * 60_000).toISOString(),
    amountMm:frameIndex === 3 ? 0.2 : 0
  };
});
const transition = findFirstWetSignalTransition(points);
assert.equal(transition.index, 3);
assert.equal(transition.previous.frameIndex, 2);
assert.equal(transition.first.frameIndex, 3);
assert.equal(transition.transitionStartValidTime, '2026-08-19T14:42:00.000Z');
assert.equal(transition.transitionEndValidTime, '2026-08-19T14:48:00.000Z');
assert.equal(
  (Date.parse(transition.transitionEndValidTime) - Date.parse(transition.transitionStartValidTime)) / 60_000,
  6,
  'onset wording must use the adjacent valid-time transition, not a rolling 30-minute accumulation window'
);

const firstWet = findFirstWetSignalTransition(points.map((point, index) => ({ ...point, amountMm:index === 0 ? 0.2 : 0 })));
assert.equal(firstWet.index, 0);
assert.equal(firstWet.transitionStartValidTime, null);
assert.equal(firstWet.transitionEndValidTime, '2026-08-19T14:30:00.000Z');
assert.equal(findFirstWetSignalTransition(points.map(point => ({ ...point, amountMm:0 }))), null);

const home = readFileSync('js/rain-home.js', 'utf8');
assert.ok(home.includes("from './rain-home-time.js'"));
assert.ok(home.includes('const xLeads = [0,30,60,90,120]'));
assert.ok(home.includes('xLead(point.leadMinutes)'));
assert.ok(home.includes('首個 SWIRLS 點：+30 分鐘'));
assert.ok(home.includes('預報基準 +0 → +120 分鐘'));
assert.ok(home.includes('formatClock(firstWet.transitionStartValidTime)'));
assert.ok(home.includes('formatClock(firstWet.transitionEndValidTime)'));
assert.ok(home.includes('Number(point.leadMinutes) !== expectedLead'));
assert.ok(!home.includes('index / Math.max(1, points.length - 1)'), 'chart must not space samples by array index');
assert.ok(!home.includes('firstWindowStart'), 'onset wording must not reuse the 30-minute rolling accumulation window');

console.log('Rain Home true time-axis + onset transition gate PASS');
