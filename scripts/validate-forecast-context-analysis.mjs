import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeForecastRainContext, summarizeForecastRainContextMotion } from '../js/forecast-map-context-analysis.js';
import { summarizeForecastRainArea } from '../js/forecast-map-spatial.js';
import { getForecastAnalysisScope, resetForecastAnalysisScope, setForecastAnalysisScope } from '../js/forecast-map-analysis-scope.js';

function zone(key, label, parent, wetShare, sumMm, wetCellCount = 4) {
  return { key, label, parent, wetShare, sumMm, wetCellCount };
}

function summary({ ntNorth = 0.7, kowloon = 0.3, seaWest = 0.4, nearbyShare = 0.5, nearbySum = 4, nearbyWetCells = 2 } = {}) {
  return {
    status:'scattered',
    label:'雨區在香港周邊較分散',
    regionalLabel:'雨區較集中在西南海域',
    regionalDetail:`西南海域 ${Math.round(seaWest * 100)}% · 新界北 ${Math.round(ntNorth * 100)}% · 九龍 ${Math.round(kowloon * 100)}%`,
    zones:{
      hongKong:{ wetCellCount:8, wetShare:0.35 },
      shenzhen:{ wetCellCount:0, wetShare:0 },
      southSea:{ wetCellCount:8, wetShare:0.4 }
    },
    productZones:{
      hkNtNorth:zone('hkNtNorth','新界北','hongKong',ntNorth,20 * ntNorth),
      hkKowloon:zone('hkKowloon','九龍','hongKong',kowloon,18 * kowloon),
      hkNtEast:zone('hkNtEast','新界東','hongKong',0.1,2),
      seaWest:zone('seaWest','西南海域','southSea',seaWest,80 * seaWest,8),
      seaSouth:zone('seaSouth','正南海域','southSea',0.1,6,2),
      seaEast:zone('seaEast','東南海域','southSea',0.15,8,2),
      szWest:zone('szWest','深圳西部','shenzhen',0,0,0),
      szCentral:zone('szCentral','深圳中部','shenzhen',0,0,0),
      szEast:zone('szEast','深圳東部','shenzhen',0,0,0)
    },
    nearby:{
      key:'nearby', label:'附近', parent:null, cellCount:4,
      wetCellCount:nearbyWetCells, wetShare:nearbyShare, sumMm:nearbySum,
      meanWetMm:nearbyWetCells ? nearbySum / nearbyWetCells : 0,
      maxMm:nearbyWetCells ? nearbySum / nearbyWetCells : 0,
      score:nearbyShare,
      radiusKm:2,
      center:{ lat:22.50, lon:114.18 }
    }
  };
}

const selected = { lat:22.50, lon:114.18, name:'粉嶺' };
const regional = summarizeForecastRainContext(summary(), { scope:'regional', selected });
assert.equal(regional.label, '雨區較集中在西南海域');

const hongKong = summarizeForecastRainContext(summary(), { scope:'hong-kong', selected });
assert.match(hongKong.label, /^香港雨區/);
assert.match(hongKong.label, /新界北/);
assert.ok(!hongKong.label.includes('西南海域'), 'Hong Kong scope must not reuse the regional headline');
assert.match(hongKong.detail, /新界北 70%/);

const shenzhen = summarizeForecastRainContext(summary(), { scope:'shenzhen', selected });
assert.equal(shenzhen.label, '深圳暫未見明顯雨區');

const southSea = summarizeForecastRainContext(summary(), { scope:'south-sea', selected });
assert.match(southSea.label, /^南面海域雨區/);
assert.match(southSea.label, /西南海域/);

const nearby = summarizeForecastRainContext(summary({ nearbyShare:0.5, nearbySum:4, nearbyWetCells:2 }), { scope:'location', selected });
assert.equal(nearby.label, '粉嶺附近雨區較明顯');
assert.equal(nearby.detail, '附近雨區覆蓋 50%');
assert.ok(!nearby.detail.includes('新界北'), 'Nearby must not reuse the containing product-zone percentage');

const nearbyDry = summarizeForecastRainContext(summary({ nearbyShare:0, nearbySum:0, nearbyWetCells:0 }), { scope:'location', selected });
assert.equal(nearbyDry.label, '粉嶺附近暫未見明顯雨區');
assert.equal(nearbyDry.detail, '附近雨區覆蓋 0%');

// True-radius fixture: two wet cells remain inside the broader New Territories
// North product zone, but are far enough from the selected point to stay out of
// the 2 km nearby sample. Nearby must therefore stay dry instead of borrowing
// the product-zone result.
const radiusGrid = { latitudes:[22.50], longitudes:[114.18,114.23,114.28] };
const radiusSpatial = summarizeForecastRainArea({ values:[0,1,1] }, radiusGrid, {
  nearby:{ lat:22.50, lon:114.18, radiusKm:2 }
});
assert.equal(radiusSpatial.productZones.hkNtNorth.wetCellCount, 2);
assert.equal(radiusSpatial.nearby.cellCount, 1);
assert.equal(radiusSpatial.nearby.wetCellCount, 0);
assert.equal(radiusSpatial.nearby.wetShare, 0);
const radiusContext = summarizeForecastRainContext(radiusSpatial, { scope:'location', selected });
assert.equal(radiusContext.label, '粉嶺附近暫未見明顯雨區');
assert.equal(radiusContext.detail, '附近雨區覆蓋 0%');

function frames(items, frameCount = 16) {
  return Array.from({ length:frameCount }, (_, index) => ({
    index,
    loaded:Boolean(items[index]),
    spatialSummary:items[index] || null
  }));
}

const hkMotion = summarizeForecastRainContextMotion(frames([
  summary({ ntNorth:0.7, kowloon:0.3 }),
  summary({ ntNorth:0.62, kowloon:0.29 }),
  summary({ ntNorth:0.52, kowloon:0.28 }),
  summary({ ntNorth:0.42, kowloon:0.27 }),
  summary({ ntNorth:0.30, kowloon:0.26 })
]), { frameCount:16, scope:'hong-kong', selected });
assert.equal(hkMotion.ready, true);
assert.match(hkMotion.label, /新界北雨區逐步減少|香港雨區逐步減弱/);
assert.ok(!hkMotion.label.includes('西南海域'));

const nearbyMotion = summarizeForecastRainContextMotion(frames([
  summary({ nearbyShare:0.65, nearbySum:7, nearbyWetCells:4 }),
  summary({ nearbyShare:0.55, nearbySum:6, nearbyWetCells:4 }),
  summary({ nearbyShare:0.42, nearbySum:4.5, nearbyWetCells:3 }),
  summary({ nearbyShare:0.28, nearbySum:2.5, nearbyWetCells:2 }),
  summary({ nearbyShare:0.12, nearbySum:1, nearbyWetCells:1 })
]), { frameCount:16, scope:'location', selected });
assert.equal(nearbyMotion.ready, true);
assert.match(nearbyMotion.label, /附近雨區逐步減少|粉嶺附近雨區逐步減弱/);
assert.ok(!nearbyMotion.label.includes('新界北'));

// Scope store is the single source of truth. A later frame-change render must
// read this store rather than a stale local variable/event snapshot.
resetForecastAnalysisScope({ notify:false });
setForecastAnalysisScope('hong-kong', { notify:false });
assert.equal(getForecastAnalysisScope(), 'hong-kong');
resetForecastAnalysisScope({ notify:false });

const quick = readFileSync('js/rain-map-quickviews.js', 'utf8');
const ui = readFileSync('js/rain-map-area-summary.js', 'utf8');
const runtime = readFileSync('js/forecast-map-runtime.js', 'utf8');
const map = readFileSync('js/map.js', 'utf8');
const scopeStore = readFileSync('js/forecast-map-analysis-scope.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

for (const marker of [
  "from './forecast-map-analysis-scope.js'",
  "setForecastAnalysisScope('location', { forceNotify:true })",
  'setForecastAnalysisScope(id, { forceNotify:true })',
  'getForecastAnalysisScope()'
]) assert.ok(quick.includes(marker), `quick-view shared scope marker missing: ${marker}`);
assert.ok(!quick.includes('let activeScope'), 'quick views must not own a second analysis-scope state');
assert.ok(!quick.includes("state.map.on?.('movestart'"), 'manual map pan must not clear the selected analysis scope');
assert.ok(!quick.includes("state.map.on?.('zoomstart'"), 'manual map zoom must not clear the selected analysis scope');

for (const marker of [
  "from './forecast-map-analysis-scope.js'",
  'const analysisScope = getForecastAnalysisScope()',
  "rain:forecast-analysis-scope-change",
  'refreshForecastMapSpatialAnalysis()',
  "rain:radius-change"
]) assert.ok(ui.includes(marker), `race-safe area summary marker missing: ${marker}`);
assert.ok(!ui.includes('let analysisScope'), 'summary must not keep a stale local analysis scope');

for (const marker of [
  'let activeScope = \'regional\'',
  'getForecastAnalysisScope',
  'setForecastAnalysisScope',
  "rain:forecast-analysis-scope-change"
]) assert.ok(scopeStore.includes(marker), `analysis scope store marker missing: ${marker}`);

for (const marker of [
  'nearbyOptions()',
  'nearby:nearbyOptions()',
  'refreshForecastMapSpatialAnalysis',
  'frame.spatialSummary = summarizeFrameSpatial(frame)'
]) assert.ok(runtime.includes(marker), `nearby runtime marker missing: ${marker}`);
assert.ok(map.includes("new CustomEvent('rain:radius-change'"), 'radius changes must refresh Nearby analysis');

assert.ok(sw.includes("'./js/forecast-map-context-analysis.js'"), 'context analyzer missing from PWA dependency inventory');
assert.ok(sw.includes("'./js/forecast-map-analysis-scope.js'"), 'shared analysis scope store missing from PWA dependency inventory');
const shellVersion = sw.match(/const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa(\d+)'/);
assert.ok(shellVersion && Number(shellVersion[1]) >= 47, 'race-safe Nearby v2 requires PWA generation at least pwa47');

console.log('Forecast Map race-safe context analysis + true Nearby radius validation passed');
