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

function clamp01(value) {
  return Math.max(0, Math.min(1, finite(value)));
}

function percentage(value) {
  return `${Math.round(clamp01(value) * 100)}%`;
}

function scopeZones(summary, scope) {
  if (scope === 'location') return summary?.nearby ? [summary.nearby] : [];
  const productZones = summary?.productZones || {};
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

function scopedMetric(summary, scope) {
  const zones = scopeZones(summary, scope);
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
  const metric = scopedMetric(summary, scope);
  const ranked = metric.wetZones;

  if (scope === 'location') {
    const nearby = metric.zones[0];
    if (!nearby) return { scope, status:'scope-unavailable', label:`${name}資料暫不可用`, detail:'' };
    if (!ranked.length) {
      return {
        scope,
        status:'scope-dry',
        label:`${name}暫未見明顯雨區`,
        detail:`附近雨區覆蓋 ${percentage(nearby.wetShare)}`
      };
    }
    const label = finite(nearby.wetShare) >= 0.45
      ? `${name}雨區較明顯`
      : `${name}有局部雨區`;
    return {
      scope,
      status:'scope-wet',
      label,
      detail:`附近雨區覆蓋 ${percentage(nearby.wetShare)}`
    };
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

function developmentForKey(frames, scope, key) {
  const points = frames.map(frame => {
    const zone = scope === 'location'
      ? frame.spatialSummary?.nearby
      : frame.spatialSummary?.productZones?.[key];
    return zone ? { index:frame.index, share:finite(zone.wetShare), label:zone.label || '附近' } : null;
  }).filter(Boolean);
  if (points.length < MIN_MOTION_FRAMES) return null;

  const groupSize = Math.min(3, Math.max(1, Math.floor(points.length / 3)));
  const early = points.slice(0, groupSize).reduce((sum, point) => sum + point.share, 0) / groupSize;
  const late = points.slice(-groupSize).reduce((sum, point) => sum + point.share, 0) / groupSize;
  const delta = late - early;
  const direction = delta >= SHARE_DELTA && late >= ACTIVE_SHARE
    ? 'increasing'
    : delta <= -SHARE_DELTA && early >= ACTIVE_SHARE
      ? 'decreasing'
      : null;
  if (!direction) return null;

  const continuous = trendIsContinuous(points, direction);
  const verb = direction === 'increasing' ? '增多' : '減少';
  const magnitude = Math.min(1, Math.abs(delta) / 0.30);
  const sampleScore = Math.min(1, points.length / 8);
  const confidence = clamp01(0.35 + magnitude * 0.30 + sampleScore * 0.15 + (continuous ? 0.20 : 0.08));
  return {
    key,
    label:points[0].label,
    delta,
    direction,
    points,
    continuous,
    confidence,
    text:`${points[0].label}雨區${continuous ? '逐步' : '較早段'}${verb}`
  };
}

function scopedDevelopment(frames, scope, currentSummary) {
  const keys = new Set();
  frames.forEach(frame => scopeZones(frame.spatialSummary, scope).forEach(zone => zone?.key && keys.add(zone.key)));
  const currentMetric = scopedMetric(currentSummary || frames.at(-1)?.spatialSummary, scope);
  const primaryZone = currentMetric.wetZones[0] || currentMetric.zones[0] || null;
  const candidates = [...keys]
    .map(key => developmentForKey(frames, scope, key))
    .filter(Boolean)
    .map(candidate => {
      const currentZone = currentMetric.zones.find(zone => zone?.key === candidate.key);
      const relevance = Math.max(clamp01(currentZone?.wetShare), Math.min(1, finite(currentZone?.sumMm) / Math.max(1, currentMetric.activity)));
      return { ...candidate, relevance, score:candidate.confidence * (0.65 + relevance * 0.35) };
    })
    .sort((a, b) => b.score - a.score || Math.abs(b.delta) - Math.abs(a.delta));

  const primaryDevelopment = primaryZone ? candidates.find(candidate => candidate.key === primaryZone.key) || null : null;
  const selectedDevelopment = primaryDevelopment || candidates[0] || null;
  if (!selectedDevelopment) return { primaryZone, selected:null, primaryDevelopment:null };

  const isPrimary = Boolean(primaryZone && selectedDevelopment.key === primaryZone.key);
  const contextText = isPrimary || !primaryZone || finite(primaryZone.wetShare) < ACTIVE_SHARE
    ? selectedDevelopment.text
    : `${primaryZone.label}目前較明顯，${selectedDevelopment.text}`;
  return {
    primaryZone,
    primaryDevelopment,
    selected:{ ...selectedDevelopment, isPrimary, contextText }
  };
}

function motionConfidence(activityRatio, wetCellRatio, development) {
  const ratioEvidence = Math.max(
    activityRatio > 0 ? Math.min(1, Math.abs(Math.log(activityRatio)) / Math.log(2.5)) : 1,
    wetCellRatio > 0 ? Math.min(1, Math.abs(Math.log(wetCellRatio)) / Math.log(2.5)) : 1
  );
  return clamp01(0.45 + ratioEvidence * 0.35 + finite(development?.confidence) * 0.20);
}

export function summarizeForecastRainContextMotion(frameSummaries, { frameCount, scope = 'regional', selected, currentSummary } = {}) {
  const frames = (Array.isArray(frameSummaries) ? frameSummaries : [])
    .filter(frame => frame?.loaded && frame?.spatialSummary)
    .sort((a, b) => finite(a.index) - finite(b.index));
  const totalFrameCount = Math.max(0, Math.round(finite(frameCount, frameSummaries?.length || 0)));
  const complete = Boolean(totalFrameCount && frames.length >= totalFrameCount);
  const base = { loadedFrameCount:frames.length, frameCount:totalFrameCount, complete };
  if (scope === 'regional') return { ...base, ready:false, status:'regional-delegated', label:'' };
  if (frames.length < MIN_MOTION_FRAMES) return { ...base, ready:false, status:'observing', label:'正在觀察雨區變化', confidence:0 };

  const metrics = frames.map(frame => ({ index:frame.index, ...scopedMetric(frame.spatialSummary, scope) }));
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
  const developmentState = scopedDevelopment(frames, scope, currentSummary);
  const primaryDevelopment = developmentState.primaryDevelopment;
  const selectedDevelopment = developmentState.selected;

  if (earlyActivity > 0 && activityRatio <= 0.55 && wetCellRatio <= 0.72) {
    const label = primaryDevelopment?.direction === 'decreasing'
      ? primaryDevelopment.text
      : `${name}雨區逐步減弱`;
    return {
      ...base,
      ready:true,
      status:'weakening',
      label,
      confidence:motionConfidence(activityRatio, wetCellRatio, primaryDevelopment),
      focus:primaryDevelopment ? 'primary-zone' : 'scope-total',
      development:primaryDevelopment || selectedDevelopment
    };
  }

  if ((earlyActivity <= 0 && lateActivity > 0) || (Number.isFinite(activityRatio) && activityRatio >= 1.7 && wetCellRatio >= 1.3)) {
    const label = primaryDevelopment?.direction === 'increasing'
      ? primaryDevelopment.text
      : `${name}雨區逐步增強`;
    return {
      ...base,
      ready:true,
      status:'strengthening',
      label,
      confidence:motionConfidence(activityRatio, wetCellRatio, primaryDevelopment),
      focus:primaryDevelopment ? 'primary-zone' : 'scope-total',
      development:primaryDevelopment || selectedDevelopment
    };
  }

  if (selectedDevelopment) {
    return {
      ...base,
      ready:true,
      status:'developing',
      label:selectedDevelopment.contextText,
      confidence:selectedDevelopment.confidence,
      focus:selectedDevelopment.isPrimary ? 'primary-zone' : 'secondary-zone',
      development:selectedDevelopment
    };
  }

  return {
    ...base,
    ready:true,
    status:'steady',
    label:`${name}雨區變化不大`,
    confidence:0.55,
    focus:'scope-total',
    development:null
  };
}
