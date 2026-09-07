import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyRainHomeWetForecast,
  rainHomeWetBand,
  wetDecisionDetail,
  wetDecisionHeadline,
  wetDecisionNextCopy
} from '../js/rain-home-wet-decision.js';

const nowMs = Date.parse('2026-09-07T06:00:00Z'); // 14:00 HKT
const buildPoints = values => values.map((amountMm, index) => {
  const leadMinutes = 30 + index * 6;
  const validTime = new Date(nowMs + leadMinutes * 60_000).toISOString();
  return {
    frameIndex:index,
    leadMinutes,
    validTime,
    windowStart:new Date(Date.parse(validTime) - 30 * 60_000).toISOString(),
    windowEnd:validTime,
    amountMm
  };
});

assert.equal(rainHomeWetBand(0).key, 'dry');
assert.equal(rainHomeWetBand(0.01).key, 'light');
assert.equal(rainHomeWetBand(0.49).key, 'light');
assert.equal(rainHomeWetBand(0.5).key, 'weak');
assert.equal(rainHomeWetBand(2).key, 'moderate');
assert.equal(rainHomeWetBand(5).key, 'strong');
assert.equal(rainHomeWetBand(10).key, 'very-strong');

const dry = classifyRainHomeWetForecast(buildPoints(new Array(16).fill(0)), { nowMs });
assert.equal(dry.state, 'dry');
assert.equal(wetDecisionHeadline(dry), '');

const light = classifyRainHomeWetForecast(buildPoints([0,0,0.01,0.03,0.08,0.12,0.1,0.04,0,0,0,0,0,0,0,0]), { nowMs });
assert.equal(light.band.key, 'light');
assert.equal(wetDecisionHeadline(light), '接下來有小雨');
assert.equal(wetDecisionNextCopy(light), 'SWIRLS 接下來有小雨');

const strongRising = classifyRainHomeWetForecast(buildPoints([0,0,0,0.1,0.2,0.5,1.1,2,3.1,4,4.7,5.1,5.1,5.3,5.9,7]), { nowMs });
assert.equal(strongRising.band.key, 'strong');
assert.equal(strongRising.risingAtEnd, true);
assert.equal(wetDecisionHeadline(strongRising), '稍後雨勢明顯增強');
assert.match(wetDecisionNextCopy(strongRising), /^SWIRLS 約 \d{2}:\d{2} 後雨勢明顯增強$/);
assert.match(wetDecisionDetail(strongRising), /7 mm \/ 30 min/);
assert.match(wetDecisionDetail(strongRising), /預報末段仍在增強/);
assert.equal(wetDecisionHeadline(strongRising, { currentEcho:true }), '目前附近有雨，稍後雨勢仍較強');

const moderate = classifyRainHomeWetForecast(buildPoints([0,0,0.2,0.5,1,2.2,3.2,2.5,1.5,0.8,0.4,0.2,0.1,0,0,0]), { nowMs });
assert.equal(moderate.band.key, 'moderate');
assert.equal(wetDecisionHeadline(moderate), '稍後有中等雨勢');
assert.match(wetDecisionNextCopy(moderate), /有中等雨勢$/);

const severe = classifyRainHomeWetForecast(buildPoints([0,0.2,0.8,1.5,3,5,8,10.5,12,11,9,7,5,3,2,1]), { nowMs });
assert.equal(severe.band.key, 'very-strong');
assert.equal(wetDecisionHeadline(severe), '稍後有強降雨');
assert.match(wetDecisionNextCopy(severe), /有強降雨$/);

const source = readFileSync('js/rain-home-wet-decision.js', 'utf8');
const smoke = readFileSync('js/forecast-map-smoke.js', 'utf8');
assert.ok(source.includes('data-rain-home-wet-annotations'), 'wet chart must expose annotation layer');
assert.ok(source.includes('開始有雨'), 'wet chart must label onset');
assert.ok(source.includes('rain-home-wet-peak-label'), 'wet chart must label peak rainfall');
assert.ok(smoke.includes("'./rain-home-wet-decision.js'"), 'wet-state decision must load as optional Rain Home enhancement');
assert.ok(smoke.includes('Promise.allSettled(OPTIONAL_MAP_MODULES.map(path => import(path)))'), 'wet-state enhancement must remain fail-soft');

console.log('Rain Home wet-state decision + onset/peak annotation gate PASS');
