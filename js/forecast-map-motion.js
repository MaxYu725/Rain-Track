const HK_REFERENCE = Object.freeze({ lat:22.35, lon:114.16 });
const MIN_MOTION_FRAMES = 3;
const APPROACH_KM = 12;
const AWAY_KM = 15;
const MOVE_KM = 15;
const STEADY_KM = 10;
const REGIONAL_SHARE_DELTA = 0.08;
const REGIONAL_ACTIVE_SHARE = 0.12;
const REGIONAL_TREND_MIN_POINTS = 4;
const REGIONAL_TREND_MAX_INDEX_GAP = 2;
const REGIONAL_TREND_CONSISTENCY = 0.7;
const REGIONAL_TREND_NOISE = 0.02;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finite(value)));
}

function totalWetMm(summary) {
  if (Number.isFinite(Number(summary?.totalWetMm))) return Number(summary.totalWetMm);
  return Object.values(summary?.zones || {}).reduce((sum, zone) => sum + finite(zone?.sumMm), 0);
}

function haversineKm(a, b) {
  if (!a || !b) return null;
  const lat1 = finite(a.lat, NaN);
  const lon1 = finite(a.lon, NaN);
  const lat2 = finite(b.lat, NaN);
  const lon2 = finite(b.lon, NaN);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}

function groupSummary(frames) {
  const summaries = frames.map(frame => frame.spatialSummary).filter(Boolean);
  if (!summaries.length) return null;

  let activity = 0;
  let wetCells = 0;
  let hkShare = 0;
  let centroidWeight = 0;
  let weightedLat = 0;
  let weightedLon = 0;
  const zoneScores = { hongKong:0, shenzhen:0, southSea:0 };
  const productAggregate = {};

  summaries.forEach(summary => {
    const frameActivity = Math.max(0, totalWetMm(summary));
    activity += frameActivity;
    wetCells += Math.max(0, finite(summary?.totalWetCellCount));
    hkShare += Math.max(0, finite(summary?.zones?.hongKong?.wetShare));
    Object.keys(zoneScores).forEach(key => { zoneScores[key] += Math.max(0, finite(summary?.zones?.[key]?.score)); });

    Object.values(summary?.productZones || {}).forEach(zone => {
      if (!zone?.key) return;
      if (!productAggregate[zone.key]) {
        productAggregate[zone.key] = {
          key:zone.key,
          label:zone.label,
          parent:zone.parent,
          wetShare:0,
          score:0,
          contributionShare:0
        };
      }
      productAggregate[zone.key].wetShare += Math.max(0, finite(zone.wetShare));
      productAggregate[zone.key].score += Math.max(0, finite(zone.score));
      productAggregate[zone.key].contributionShare += Math.max(0, finite(zone.contributionShare));
    });

    const lat = Number(summary?.centroid?.lat);
    const lon = Number(summary?.centroid?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const weight = Math.max(frameActivity, 1);
      centroidWeight += weight;
      weightedLat += lat * weight;
      weightedLon += lon * weight;
    }
  });

  const count = summaries.length;
  const centroid = centroidWeight > 0
    ? { lat:weightedLat / centroidWeight, lon:weightedLon / centroidWeight }
    : null;
  const dominant = Object.entries(zoneScores).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const productZones = Object.fromEntries(Object.entries(productAggregate).map(([key, zone]) => [key, {
    ...zone,
    wetShare:zone.wetShare / count,
    score:zone.score / count,
    contributionShare:zone.contributionShare / count
  }]));
  const dominantProduct = Object.values(productZones)
    .sort((a, b) => b.contributionShare - a.contributionShare || b.score - a.score)[0] || null;

  return {
    activity:activity / count,
    wetCells:wetCells / count,
    hkShare:hkShare / count,
    centroid,
    dominant,
    dominantProduct,
    productZones
  };
}

function trendIsContinuous(frames, key, direction) {
  const series = frames
    .map(frame => ({
      index:finite(frame?.index, NaN),
      value:finite(frame?.spatialSummary?.productZones?.[key]?.wetShare, NaN)
    }))
    .filter(point => Number.isFinite(point.index) && Number.isFinite(point.value));
  if (series.length < REGIONAL_TREND_MIN_POINTS) return false;

  let consistent = 0;
  let pairs = 0;
  for (let i = 1; i < series.length; i += 1) {
    const previous = series[i - 1];
    const current = series[i];
    if (current.index - previous.index > REGIONAL_TREND_MAX_INDEX_GAP) return false;
    const delta = current.value - previous.value;
    pairs += 1;
    if (direction === 'increasing' ? delta >= -REGIONAL_TREND_NOISE : delta <= REGIONAL_TREND_NOISE) consistent += 1;
  }
  return pairs > 0 && consistent / pairs >= REGIONAL_TREND_CONSISTENCY;
}

function currentPrimaryProduct(summary, fallback) {
  const ranked = Object.values(summary?.productZones || {})
    .filter(zone => finite(zone?.wetCellCount) > 0 && finite(zone?.sumMm) > 0)
    .sort((a, b) => finite(b.contributionShare) - finite(a.contributionShare) || finite(b.sumMm) - finite(a.sumMm));
  return ranked[0] || fallback || null;
}

function regionalDevelopment(frames, early, late, currentSummary) {
  const keys = new Set([...Object.keys(early?.productZones || {}), ...Object.keys(late?.productZones || {})]);
  const candidates = [...keys].map(key => {
    const earlyZone = early?.productZones?.[key];
    const lateZone = late?.productZones?.[key];
    const earlyShare = finite(earlyZone?.wetShare);
    const lateShare = finite(lateZone?.wetShare);
    const delta = lateShare - earlyShare;
    const label = lateZone?.label || earlyZone?.label || key;
    const parent = lateZone?.parent || earlyZone?.parent || null;
    const direction = delta >= REGIONAL_SHARE_DELTA && lateShare >= REGIONAL_ACTIVE_SHARE
      ? 'increasing'
      : delta <= -REGIONAL_SHARE_DELTA && earlyShare >= REGIONAL_ACTIVE_SHARE
        ? 'decreasing'
        : null;
    if (!direction) return null;
    const continuous = trendIsContinuous(frames, key, direction);
    const magnitude = Math.min(1, Math.abs(delta) / 0.30);
    const confidence = clamp01(0.45 + magnitude * 0.35 + (continuous ? 0.20 : 0.08));
    return {
      key,
      label,
      parent,
      earlyShare,
      lateShare,
      delta,
      direction,
      continuous,
      confidence,
      text:`${label}雨區${continuous ? '逐步' : '較早段'}${direction === 'increasing' ? '增多' : '減少'}`
    };
  }).filter(Boolean);

  const primaryProduct = currentPrimaryProduct(currentSummary, late?.dominantProduct);
  candidates.forEach(candidate => {
    const currentZone = currentSummary?.productZones?.[candidate.key];
    const relevance = Math.max(clamp01(currentZone?.wetShare), clamp01(currentZone?.contributionShare));
    candidate.score = candidate.confidence * (0.65 + relevance * 0.35);
  });
  candidates.sort((a, b) => b.score - a.score || Math.abs(b.delta) - Math.abs(a.delta));
  const primaryDevelopment = primaryProduct ? candidates.find(candidate => candidate.key === primaryProduct.key) || null : null;
  const selected = primaryDevelopment || candidates[0] || null;
  if (!selected) return { primaryProduct, primaryDevelopment:null, selected:null };
  const isPrimary = Boolean(primaryProduct && selected.key === primaryProduct.key);
  const contextText = isPrimary || !primaryProduct
    ? selected.text
    : `${primaryProduct.label}目前較明顯，${selected.text}`;
  return {
    primaryProduct,
    primaryDevelopment,
    selected:{ ...selected, isPrimary, contextText }
  };
}

function directionLabel(dxKm, dyKm) {
  const angle = (Math.atan2(dyKm, dxKm) * 180 / Math.PI + 360) % 360;
  if (angle < 22.5 || angle >= 337.5) return '東';
  if (angle < 67.5) return '東北';
  if (angle < 112.5) return '北';
  if (angle < 157.5) return '西北';
  if (angle < 202.5) return '西';
  if (angle < 247.5) return '西南';
  if (angle < 292.5) return '南';
  return '東南';
}

function resultBase(frames, frameCount) {
  const loadedFrameCount = frames.length;
  return {
    loadedFrameCount,
    frameCount,
    complete:Boolean(frameCount && loadedFrameCount >= frameCount),
    firstIndex:loadedFrameCount ? frames[0].index : null,
    lastIndex:loadedFrameCount ? frames[loadedFrameCount - 1].index : null
  };
}

function withDevelopment(label, developmentText) {
  return developmentText ? `${label}，${developmentText}` : label;
}

function sourceApproachLabel(early) {
  const product = early?.dominantProduct;
  if (product?.parent === 'southSea') return `${product.label}雨區正向香港靠近`;
  if (product?.parent === 'shenzhen') return `${product.label}雨區正向香港靠近`;
  if (early?.dominant === 'southSea') return '雨帶正由南面海域向香港靠近';
  if (early?.dominant === 'shenzhen') return '深圳方向雨區正向香港靠近';
  return '雨區正向香港靠近';
}

export function summarizeForecastRainMotion(frameSummaries, { frameCount, currentSummary } = {}) {
  const frames = (Array.isArray(frameSummaries) ? frameSummaries : [])
    .filter(frame => frame?.loaded && frame?.spatialSummary)
    .sort((a, b) => finite(a.index) - finite(b.index));
  const totalFrameCount = Math.max(0, Math.round(finite(frameCount, frameSummaries?.length || 0)));
  const base = resultBase(frames, totalFrameCount);

  if (frames.length < MIN_MOTION_FRAMES) {
    return { ...base, ready:false, status:'observing', label:'正在觀察雨區移動', confidence:0 };
  }

  const activeFrames = frames.filter(frame => finite(frame?.spatialSummary?.totalWetCellCount) > 0);
  if (!activeFrames.length) {
    return {
      ...base,
      ready:true,
      status:'steady-dry',
      label:base.complete ? '未來兩小時雨區變化不明顯' : '暫未見明顯雨區移動',
      displacementKm:0,
      distanceToHongKongChangeKm:0,
      activityRatio:0,
      development:null,
      confidence:0.8,
      focus:'regional-total'
    };
  }

  const groupSize = Math.min(3, Math.max(1, Math.floor(frames.length / 3)));
  const early = groupSummary(frames.slice(0, groupSize));
  const late = groupSummary(frames.slice(-groupSize));
  if (!early || !late) return { ...base, ready:false, status:'observing', label:'正在觀察雨區移動', confidence:0 };

  const activityRatio = early.activity > 0 ? late.activity / early.activity : (late.activity > 0 ? Infinity : 1);
  const wetCellRatio = early.wetCells > 0 ? late.wetCells / early.wetCells : (late.wetCells > 0 ? Infinity : 1);
  const hkShareDelta = late.hkShare - early.hkShare;
  const developmentState = regionalDevelopment(frames, early, late, currentSummary);
  const primaryDevelopment = developmentState.primaryDevelopment;
  const selectedDevelopment = developmentState.selected;

  if (early.activity > 0 && activityRatio <= 0.55 && wetCellRatio <= 0.7) {
    const specific = primaryDevelopment?.direction === 'decreasing' ? primaryDevelopment.text : null;
    return {
      ...base,
      ready:true,
      status:'weakening',
      label:specific || (early.hkShare >= 0.08 ? '香港附近雨區逐步減弱' : '雨區整體逐步減弱'),
      activityRatio,
      wetCellRatio,
      development:primaryDevelopment || selectedDevelopment,
      confidence:0.85,
      focus:primaryDevelopment ? 'primary-zone' : 'regional-total'
    };
  }

  const earlyCentroid = early.centroid;
  const lateCentroid = late.centroid;
  if (earlyCentroid && lateCentroid) {
    const meanLat = (earlyCentroid.lat + lateCentroid.lat) / 2;
    const dxKm = (lateCentroid.lon - earlyCentroid.lon) * 111.32 * Math.cos(meanLat * Math.PI / 180);
    const dyKm = (lateCentroid.lat - earlyCentroid.lat) * 111.32;
    const displacementKm = Math.hypot(dxKm, dyKm);
    const earlyDistance = haversineKm(earlyCentroid, HK_REFERENCE);
    const lateDistance = haversineKm(lateCentroid, HK_REFERENCE);
    const distanceChange = Number.isFinite(earlyDistance) && Number.isFinite(lateDistance)
      ? earlyDistance - lateDistance
      : 0;
    const primaryText = primaryDevelopment?.text || '';

    if (distanceChange >= APPROACH_KM) {
      return {
        ...base,
        ready:true,
        status:'approaching-hong-kong',
        label:withDevelopment(sourceApproachLabel(early), primaryText),
        displacementKm,
        distanceToHongKongChangeKm:distanceChange,
        activityRatio,
        wetCellRatio,
        hkShareDelta,
        development:primaryDevelopment || selectedDevelopment,
        confidence:0.9,
        focus:primaryDevelopment ? 'primary-zone' : 'regional-motion'
      };
    }

    if (-distanceChange >= AWAY_KM) {
      return {
        ...base,
        ready:true,
        status:'moving-away',
        label:withDevelopment('雨區逐步遠離香港', primaryText),
        displacementKm,
        distanceToHongKongChangeKm:distanceChange,
        activityRatio,
        wetCellRatio,
        hkShareDelta,
        development:primaryDevelopment || selectedDevelopment,
        confidence:0.9,
        focus:primaryDevelopment ? 'primary-zone' : 'regional-motion'
      };
    }

    if (displacementKm >= MOVE_KM) {
      return {
        ...base,
        ready:true,
        status:'moving',
        label:withDevelopment(`雨區主要向${directionLabel(dxKm, dyKm)}移動`, primaryText),
        displacementKm,
        distanceToHongKongChangeKm:distanceChange,
        activityRatio,
        wetCellRatio,
        hkShareDelta,
        development:primaryDevelopment || selectedDevelopment,
        confidence:0.82,
        focus:primaryDevelopment ? 'primary-zone' : 'regional-motion'
      };
    }

    if (displacementKm <= STEADY_KM && activityRatio >= 0.6 && activityRatio <= 1.6) {
      const developmentText = selectedDevelopment?.contextText || '';
      return {
        ...base,
        ready:true,
        status:'steady',
        label:withDevelopment('雨區位置變化不大', developmentText),
        displacementKm,
        distanceToHongKongChangeKm:distanceChange,
        activityRatio,
        wetCellRatio,
        hkShareDelta,
        development:selectedDevelopment,
        confidence:selectedDevelopment?.confidence || 0.7,
        focus:selectedDevelopment?.isPrimary ? 'primary-zone' : selectedDevelopment ? 'secondary-zone' : 'regional-total'
      };
    }
  }

  if ((early.activity <= 0 && late.activity > 0) || (Number.isFinite(activityRatio) && activityRatio >= 1.7 && wetCellRatio >= 1.3)) {
    const specific = primaryDevelopment?.direction === 'increasing' ? primaryDevelopment.text : null;
    return {
      ...base,
      ready:true,
      status:'strengthening',
      label:specific || '雨區整體逐步增強',
      activityRatio,
      wetCellRatio,
      hkShareDelta,
      development:primaryDevelopment || selectedDevelopment,
      confidence:0.85,
      focus:primaryDevelopment ? 'primary-zone' : 'regional-total'
    };
  }

  return {
    ...base,
    ready:true,
    status:'variable',
    label:withDevelopment('雨區位置有變化，移動方向未明顯', primaryDevelopment?.text || ''),
    activityRatio,
    wetCellRatio,
    hkShareDelta,
    development:primaryDevelopment || selectedDevelopment,
    confidence:primaryDevelopment?.confidence || 0.55,
    focus:primaryDevelopment ? 'primary-zone' : 'regional-total'
  };
}
