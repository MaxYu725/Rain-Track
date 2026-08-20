import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeForecastRainMotion } from '../js/forecast-map-motion.js';

const PRODUCT_META = {
  seaEast:{ key:'seaEast', label:'東南海域', parent:'southSea' },
  seaSouth:{ key:'seaSouth', label:'正南海域', parent:'southSea' },
  hkSaiKungEast:{ key:'hkSaiKungEast', label:'西貢及香港東面', parent:'hongKong' },
  hkNtEast:{ key:'hkNtEast', label:'新界東', parent:'hongKong' }
};

function spatial({
  lat,
  lon,
  wet = 100,
  totalWetMm = 100,
  hk = 0.1,
  shenzhen = 0.1,
  sea = 0.1,
  dominant = 'hongKong',
  product = {}
}) {
  const scores = { hongKong:0.1, shenzhen:0.1, southSea:0.1 };
  scores[dominant] = 1;
  const productZones = Object.fromEntries(Object.entries(product).map(([key, wetShare]) => {
    const meta = PRODUCT_META[key] || { key, label:key, parent:null };
    return [key, { ...meta, wetShare, score:wetShare, sumMm:totalWetMm * wetShare }];
  }));
  return {
    totalWetCellCount:wet,
    totalWetMm,
    centroid:lat == null || lon == null ? null : { lat, lon },
    zones:{
      hongKong:{ key:'hongKong', wetShare:hk, score:scores.hongKong, sumMm:totalWetMm * 0.3 },
      shenzhen:{ key:'shenzhen', wetShare:shenzhen, score:scores.shenzhen, sumMm:totalWetMm * 0.2 },
      southSea:{ key:'southSea', wetShare:sea, score:scores.southSea, sumMm:totalWetMm * 0.5 }
    },
    productZones
  };
}

function frames(items, frameCount = 16) {
  return Array.from({ length:frameCount }, (_, index) => {
    const summary = items[index];
    return {
      index,
      loaded:Boolean(summary),
      spatialSummary:summary || null
    };
  });
}

const observing = summarizeForecastRainMotion(frames([
  spatial({ lat:21.8, lon:114.15, dominant:'southSea' }),
  spatial({ lat:21.9, lon:114.15, dominant:'southSea' })
]));
assert.equal(observing.ready, false);
assert.equal(observing.status, 'observing');
assert.equal(observing.label, '正在觀察雨區移動');

const approaching = summarizeForecastRainMotion(frames([
  spatial({ lat:21.72, lon:114.16, sea:0.4, dominant:'southSea' }),
  spatial({ lat:21.88, lon:114.16, sea:0.36, dominant:'southSea' }),
  spatial({ lat:22.02, lon:114.16, sea:0.3, dominant:'southSea' }),
  spatial({ lat:22.16, lon:114.16, hk:0.16, sea:0.22, dominant:'southSea' }),
  spatial({ lat:22.28, lon:114.16, hk:0.25, sea:0.12, dominant:'hongKong' })
]));
assert.equal(approaching.ready, true);
assert.equal(approaching.status, 'approaching-hong-kong');
assert.equal(approaching.label, '雨帶正由南面海域向香港靠近');
assert.ok(approaching.distanceToHongKongChangeKm >= 12);
assert.equal(approaching.complete, false);

const regionalApproaching = summarizeForecastRainMotion(frames([
  spatial({ lat:21.72, lon:114.65, sea:0.4, dominant:'southSea', product:{ seaEast:0.35 } }),
  spatial({ lat:21.95, lon:114.50, sea:0.3, dominant:'southSea', product:{ seaEast:0.30 } }),
  spatial({ lat:22.20, lon:114.30, hk:0.2, sea:0.18, dominant:'hongKong', product:{ hkSaiKungEast:0.22 } })
]));
assert.equal(regionalApproaching.status, 'approaching-hong-kong');
assert.match(regionalApproaching.label, /東南海域雨區正向香港靠近/);

const weakening = summarizeForecastRainMotion(frames([
  spatial({ lat:22.35, lon:114.12, wet:120, totalWetMm:180, hk:0.42 }),
  spatial({ lat:22.35, lon:114.13, wet:90, totalWetMm:120, hk:0.35 }),
  spatial({ lat:22.35, lon:114.14, wet:60, totalWetMm:70, hk:0.24 }),
  spatial({ lat:22.35, lon:114.14, wet:35, totalWetMm:35, hk:0.13 }),
  spatial({ lat:22.35, lon:114.14, wet:20, totalWetMm:20, hk:0.07 })
]));
assert.equal(weakening.status, 'weakening');
assert.equal(weakening.label, '香港附近雨區逐步減弱');

const eastward = summarizeForecastRainMotion(frames([
  spatial({ lat:22.35, lon:114.00 }),
  spatial({ lat:22.35, lon:114.08 }),
  spatial({ lat:22.35, lon:114.16 }),
  spatial({ lat:22.35, lon:114.24 }),
  spatial({ lat:22.35, lon:114.32 })
]));
assert.equal(eastward.status, 'moving');
assert.equal(eastward.label, '雨區主要向東移動');

const steady = summarizeForecastRainMotion(frames([
  spatial({ lat:22.1, lon:114.0, totalWetMm:100 }),
  spatial({ lat:22.11, lon:114.01, totalWetMm:105 }),
  spatial({ lat:22.1, lon:114.0, totalWetMm:95 }),
  spatial({ lat:22.11, lon:114.0, totalWetMm:102 }),
  spatial({ lat:22.1, lon:114.01, totalWetMm:98 })
]));
assert.equal(steady.status, 'steady');
assert.equal(steady.label, '雨區位置變化不大');

const regionalGrowth = summarizeForecastRainMotion(frames([
  spatial({ lat:22.1, lon:114.1, totalWetMm:100, sea:0.22, product:{ seaEast:0.12 } }),
  spatial({ lat:22.1, lon:114.1, totalWetMm:102, sea:0.24, product:{ seaEast:0.18 } }),
  spatial({ lat:22.1, lon:114.1, totalWetMm:104, sea:0.27, product:{ seaEast:0.24 } }),
  spatial({ lat:22.1, lon:114.1, totalWetMm:106, sea:0.30, product:{ seaEast:0.30 } }),
  spatial({ lat:22.1, lon:114.1, totalWetMm:108, sea:0.34, product:{ seaEast:0.35 } })
]));
assert.equal(regionalGrowth.status, 'steady');
assert.equal(regionalGrowth.label, '雨區位置變化不大，東南海域雨區逐步增多');
assert.equal(regionalGrowth.development?.key, 'seaEast');
assert.equal(regionalGrowth.development?.direction, 'increasing');

const regionalDecrease = summarizeForecastRainMotion(frames([
  spatial({ lat:22.38, lon:114.18, totalWetMm:100, hk:0.3, product:{ hkNtEast:0.32 } }),
  spatial({ lat:22.38, lon:114.18, totalWetMm:95, hk:0.26, product:{ hkNtEast:0.24 } }),
  spatial({ lat:22.38, lon:114.18, totalWetMm:90, hk:0.22, product:{ hkNtEast:0.20 } }),
  spatial({ lat:22.38, lon:114.18, totalWetMm:85, hk:0.18, product:{ hkNtEast:0.15 } }),
  spatial({ lat:22.38, lon:114.18, totalWetMm:80, hk:0.14, product:{ hkNtEast:0.10 } })
]));
assert.match(regionalDecrease.label, /新界東雨區逐步減少/);

const completeFrames = Array.from({ length:16 }, (_, index) => spatial({ lat:22.1, lon:114.0 + index * 0.001 }));
const complete = summarizeForecastRainMotion(frames(completeFrames));
assert.equal(complete.complete, true);
assert.equal(complete.loadedFrameCount, 16);

const spatialSource = readFileSync('js/forecast-map-spatial.js', 'utf8');
const runtime = readFileSync('js/forecast-map-runtime.js', 'utf8');
const ui = readFileSync('js/rain-map-area-summary.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

for (const marker of ['totalWetMm', 'weightedLat', 'weightedLon', 'centroid', 'RAIN_AREA_PRODUCT_ZONES', 'productZones']) {
  assert.ok(spatialSource.includes(marker), `spatial regional marker missing: ${marker}`);
}
for (const marker of ['spatialSummary:frame.spatialSummary || null', 'frame.spatialSummary = spatialSummary']) {
  assert.ok(runtime.includes(marker), `runtime motion cache marker missing: ${marker}`);
}
for (const marker of [
  "from './forecast-map-motion.js'",
  'data-rain-area-motion',
  'summarizeForecastRainMotion(getForecastMapFrameSummaries()',
  "text:motion.complete ? motion.label : `初步：${motion.label}`",
  '正在觀察雨區移動',
  'summary.regionalLabel || summary.label',
  'summary.regionalDetail || summary.detail'
]) assert.ok(ui.includes(marker), `motion UI marker missing: ${marker}`);

assert.ok(!ui.includes('/api/'), 'motion UI must not create its own network path');
assert.ok(sw.includes("'./js/forecast-map-motion.js'"), 'motion analyzer missing from PWA app shell inventory');
const shellVersion = sw.match(/const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa(\d+)'/);
assert.ok(shellVersion && Number(shellVersion[1]) >= 44, 'Forecast Map regional motion insight requires PWA generation at least pwa44');

console.log('Forecast Map regional v2 motion insight validation passed');
