import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeForecastRainContext, summarizeForecastRainContextMotion } from '../js/forecast-map-context-analysis.js';

function zone(key, label, parent, wetShare, sumMm, wetCellCount = 4) {
  return { key, label, parent, wetShare, sumMm, wetCellCount };
}

function summary({ ntNorth = 0.7, kowloon = 0.3, seaWest = 0.4 } = {}) {
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

const nearby = summarizeForecastRainContext(summary(), { scope:'location', selected });
assert.equal(nearby.label, '粉嶺附近雨區較明顯');
assert.match(nearby.detail, /新界北 70%/);

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

const quick = readFileSync('js/rain-map-quickviews.js', 'utf8');
const ui = readFileSync('js/rain-map-area-summary.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

for (const marker of [
  "rain:forecast-analysis-scope-change",
  "notifyAnalysisScope('location')",
  'notifyAnalysisScope(id)',
  "activeScope = 'regional'"
]) assert.ok(quick.includes(marker), `quick-view analysis scope marker missing: ${marker}`);
assert.ok(!quick.includes("state.map.on?.('movestart'"), 'manual map pan must not clear the selected analysis scope');
assert.ok(!quick.includes("state.map.on?.('zoomstart'"), 'manual map zoom must not clear the selected analysis scope');

for (const marker of [
  "from './forecast-map-context-analysis.js'",
  "analysisScope = 'regional'",
  "rain:forecast-analysis-scope-change",
  'summarizeForecastRainContext(summary',
  'summarizeForecastRainContextMotion(getForecastMapFrameSummaries()'
]) assert.ok(ui.includes(marker), `scope-aware area summary marker missing: ${marker}`);

assert.ok(sw.includes("'./js/forecast-map-context-analysis.js'"), 'context analyzer missing from PWA dependency inventory');
const shellVersion = sw.match(/const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa(\d+)'/);
assert.ok(shellVersion && Number(shellVersion[1]) >= 46, 'context-aware Forecast Map requires PWA generation at least pwa46');

console.log('Forecast Map context-aware regional analysis validation passed');
