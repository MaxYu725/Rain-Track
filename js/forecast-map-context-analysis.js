import { RAIN_AREA_PRODUCT_ZONES } from './forecast-map-spatial.js';

const MIN_MOTION_FRAMES = 3;
const SHARE_DELTA = 0.08;
const ACTIVE_SHARE = 0.12;
const TREND_NOISE = 0.02;
const TREND_RATIO = 0.7;

const SCOPE_META = Object.freeze({
  'hong-kong':Object.freeze({ parent:'hongKong', label:'香港' }),
  shenzhen:Object.freeze({ parent:'shenzhen', label:'深圳' }),
  'south-sea':Object.freeze({ parent:'southSea', label:'南面海域' })
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function percentage(value) {
  return `${Math.round(Math.max(0, Math.min(1, finite(value))) * 100)}%`;
}

function pointOnSegment(x, y, ax, ay, bx, by) {
  const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
  if (Math.abs(cross) > 1e-9) return false;
  return (x - ax) * (x - bx) + (y - ay) * (y - by) <= 1e-9;
}

function pointInPolygon(lat, lon, polygon) {
  const x = lon;
  const y = lat;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (pointOnSegment(x, y, xi, yi, xj, yj)) return true;
    const intersects = ((yi > y) !== (yj > y))
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function selectedProductZone(selected) {
  const lat = Number(selected?.lat);
  const lon = Number(selected?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return Object.values(RAIN_AREA_PRODUCT_ZONES)
    .find(zone => pointInPolygon(lat, lon, zone.polygon)) || null;
}

function scopeZones(summary, scope, selected) {
  const productZones = summary?.productZones || {};
  if (scope === 'location') {
    const zone = selectedProductZone(selected);
    return zone && productZones[zone.key] ? [productZones[zone.key]] : [];
  }
  const meta = SCOPE_META[scope];
  if (!meta) return [];
  return Object.values(productZones).filter(zone => zone?.parent === meta.parent);
}

function rankedWetZones(zones) {
  return zones
    .filter(zone => finite(zone?.wetCellCount) > 0 && finite(zone?.sumMm) > 0)
    .sort((a, b) => finite(b.sumMm) - finite(a.sumMm));
}

function scopedName(scope, selected) {
  if (scope === 'location') {
    const name = String(selected?.name || '').trim();
    return name ? `${name}附近` : '定位附近';
  }
  return SCOPE_META[scope]?.label || '所選範圍';
}

function scopedMetric(summary, scope, selected) {
  const zones = scopeZones(summary, scope, selected);
  const wetZones = rankedWetZones(zones);
  return {
    zones,
    wetZones,
    activity:zones.reduce((sum, zone) => sum + Math.max(0, finite(zone?.sumMm)), 0),
    wetCells:zones.reduce((sum, zone) => sum + Math.max(0, finite(zone?.wetCellCount)), 0),
    zoneShares:Object.fromEntries(zones.map(zone => [zone.key, finite(zone?.wetShare)]))
  };
}

export function summarizeForecastRainContext(summary, { scope = 'regional', selected } = {}) {
  if (!summary) return null;
  if (scope === 'regional') {
    return {
      scope,
      status:summary.status || '',
      label:summary.regionalLabel || summary.label || '正在分析雨區…',
      detail:summary.regionalDetail || summary.detail || ''
    };
  }

  const name = scopedName(scope, selected);
  const metric = scopedMetric(summary, scope, selected);
  const ranked = metric.wetZones;

  if (scope === 'location') {
    const zone = metric.zones[0];
    if (!zone || !ranked.length) {
      return { scope, status:'scope-dry', label:`${name}暫未見明顯雨區`, detail:zone ? `${zone.label} ${percentage(zone.wetShare)}` : '' };
    }
    const label = finite(zone.wetShare) >= 0.45
      ? `${name}雨區較明顯`
      : `${name}有局部雨區`;
    return { scope, status:'scope-wet', label, detail:`${zone.label} ${percentage(zone.wetShare)}` };
  }

  const meta = SCOPE_META[scope];
  const macro = summary?.zones?.[meta?.parent];
  if (!ranked.length || finite(macro?.wetCellCount) <= 0) {
    return { scope, status:'scope-dry', label:`${name}暫未見明顯雨區`, detail:'' };
  }
  if (scope === 'hong-kong' && finite(macro?.wetShare) >= 0.78) {
    return {
      scope,
      status:'scope-widespread',
      label:'香港大部分地區有雨',
      detail:ranked.slice(0, 3).map(zone => `${zone.label} ${percentage(zone.wetShare)}`).join(' · ')
    };
  }

  const first = ranked[0];
  const second = ranked[1];
  const combine = Boolean(second)
    && finite(second.wetShare) >= 0.08
    && finite(second.sumMm) >= finite(first.sumMm) * 0.58;
  const label = combine
    ? `${name}雨區主要在${first.label}及${second.label}`
    : `${name}雨區較集中在${first.label}`;
  const detail = ranked.slice(0, 3).map(zone => `${zone.label} ${percentage(zone.wetShare)}`).join(' · ');
  return { scope, status:'scope-wet', label, detail };
}

function trendIsContinuous(points, direction) {
  if (points.length < 4) return false;
  let meaningful = 0;
  let aligned = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].index - points[i - 1].index > 2) return false;
    const delta = points[i].share - points[i - 1].share;
    if (Math.abs(delta) <= TREND_NOISE) continue;
    meaningful += 1;
    if ((direction === 'increasing' && delta > 0) || (direction === 'decreasing' && delta < 0)) aligned += 1;
  }
  return meaningful >= 2 && aligned / meaningful >= TREND_RATIO;
}

function scopedDevelopment(frames, scope, selected) {
  const keys = new Set();
  frames.forEach(frame => scopeZones(frame.spatialSummary, scope, selected).forEach(zone => keys.add(zone.key)));
  const candidates = [];
  keys.forEach(key => {
    const points = frames.map(frame => {
      const zone = frame.spatialSummary?.productZones?.[key];
      return zone ? { index:frame.index, share:finite(zone.wetShare), label:zone.label } : null;
    }).filter(Boolean);
    if (points.length < 3) return;
    const groupSize = Math.min(3, Math.max(1, Math.floor(points.length / 3)));
    const early = points.slice(0, groupSize).reduce((sum, point) => sum + point.share, 0) / groupSize;
    const late = points.slice(-groupSize).reduce((sum, point) => sum + point.share, 0) / groupSize;
    const delta = late - early;
    const direction = delta >= SHARE_DELTA && late >= ACTIVE_SHARE
      ? 'increasing'
      : delta <= -SHARE_DELTA && early >= ACTIVE_SHARE
        ? 'decreasing'
        : null;
    if (!direction) return;
    candidates.push({ key, label:points[0].label, delta, direction, points });
  });
  candidates.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const strongest = candidates[0];
  if (!strongest) return null;
  const continuous = trendIsContinuous(strongest.points, strongest.direction);
  const verb = strongest.direction === 'increasing' ? '增多' : '減少';
  return {
    ...strongest,
    continuous,
    text:`${strongest.label}雨區${continuous ? '逐步' : '較早段'}${verb}`
  };
}

export function summarizeForecastRainContextMotion(frameSummaries, { frameCount, scope = 'regional', selected } = {}) {
  const frames = (Array.isArray(frameSummaries) ? frameSummaries : [])
    .filter(frame => frame?.loaded && frame?.spatialSummary)
    .sort((a, b) => finite(a.index) - finite(b.index));
  const totalFrameCount = Math.max(0, Math.round(finite(frameCount, frameSummaries?.length || 0)));
  const complete = Boolean(totalFrameCount && frames.length >= totalFrameCount);
  const base = { loadedFrameCount:frames.length, frameCount:totalFrameCount, complete };
  if (scope === 'regional') return { ...base, ready:false, status:'regional-delegated', label:'' };
  if (frames.length < MIN_MOTION_FRAMES) return { ...base, ready:false, status:'observing', label:'正在觀察雨區變化' };

  const metrics = frames.map(frame => ({ index:frame.index, ...scopedMetric(frame.spatialSummary, scope, selected) }));
  const groupSize = Math.min(3, Math.max(1, Math.floor(metrics.length / 3)));
  const early = metrics.slice(0, groupSize);
  const late = metrics.slice(-groupSize);
  const avg = (items, key) => items.reduce((sum, item) => sum + finite(item[key]), 0) / Math.max(1, items.length);
  const earlyActivity = avg(early, 'activity');
  const lateActivity = avg(late, 'activity');
  const earlyWetCells = avg(early, 'wetCells');
  const lateWetCells = avg(late, 'wetCells');
  const activityRatio = earlyActivity > 0 ? lateActivity / earlyActivity : (lateActivity > 0 ? Infinity : 1);
  const wetCellRatio = earlyWetCells > 0 ? lateWetCells / earlyWetCells : (lateWetCells > 0 ? Infinity : 1);
  const name = scopedName(scope, selected);
  const development = scopedDevelopment(frames, scope, selected);

  if (earlyActivity > 0 && activityRatio <= 0.55 && wetCellRatio <= 0.72) {
    return { ...base, ready:true, status:'weakening', label:development?.direction === 'decreasing' ? development.text : `${name}雨區逐步減弱`, development };
  }
  if ((earlyActivity <= 0 && lateActivity > 0) || (Number.isFinite(activityRatio) && activityRatio >= 1.7 && wetCellRatio >= 1.3)) {
    return { ...base, ready:true, status:'strengthening', label:development?.direction === 'increasing' ? development.text : `${name}雨區逐步增強`, development };
  }
  if (development) return { ...base, ready:true, status:'developing', label:development.text, development };
  return { ...base, ready:true, status:'steady', label:`${name}雨區變化不大`, development:null };
}
