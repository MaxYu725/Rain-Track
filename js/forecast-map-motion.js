const HK_REFERENCE = Object.freeze({ lat:22.35, lon:114.16 });
const MIN_MOTION_FRAMES = 3;
const APPROACH_KM = 12;
const AWAY_KM = 15;
const MOVE_KM = 15;
const STEADY_KM = 10;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function totalWetMm(summary) {
  if (Number.isFinite(Number(summary?.totalWetMm))) return Number(summary.totalWetMm);
  return Object.values(summary?.zones || {}).reduce((sum, zone) => sum + finite(zone?.sumMm), 0);
}

function dominantZone(summary) {
  return ['hongKong', 'shenzhen', 'southSea']
    .map(key => summary?.zones?.[key])
    .filter(Boolean)
    .sort((a, b) => finite(b?.score) - finite(a?.score))[0]?.key || null;
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

  summaries.forEach(summary => {
    const frameActivity = Math.max(0, totalWetMm(summary));
    activity += frameActivity;
    wetCells += Math.max(0, finite(summary?.totalWetCellCount));
    hkShare += Math.max(0, finite(summary?.zones?.hongKong?.wetShare));
    Object.keys(zoneScores).forEach(key => { zoneScores[key] += Math.max(0, finite(summary?.zones?.[key]?.score)); });

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

  return {
    activity:activity / count,
    wetCells:wetCells / count,
    hkShare:hkShare / count,
    centroid,
    dominant
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

export function summarizeForecastRainMotion(frameSummaries, { frameCount } = {}) {
  const frames = (Array.isArray(frameSummaries) ? frameSummaries : [])
    .filter(frame => frame?.loaded && frame?.spatialSummary)
    .sort((a, b) => finite(a.index) - finite(b.index));
  const totalFrameCount = Math.max(0, Math.round(finite(frameCount, frameSummaries?.length || 0)));
  const base = resultBase(frames, totalFrameCount);

  if (frames.length < MIN_MOTION_FRAMES) {
    return { ...base, ready:false, status:'observing', label:'正在觀察雨區移動' };
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
      activityRatio:0
    };
  }

  const groupSize = Math.min(3, Math.max(1, Math.floor(frames.length / 3)));
  const early = groupSummary(frames.slice(0, groupSize));
  const late = groupSummary(frames.slice(-groupSize));
  if (!early || !late) return { ...base, ready:false, status:'observing', label:'正在觀察雨區移動' };

  const activityRatio = early.activity > 0 ? late.activity / early.activity : (late.activity > 0 ? Infinity : 1);
  const wetCellRatio = early.wetCells > 0 ? late.wetCells / early.wetCells : (late.wetCells > 0 ? Infinity : 1);
  const hkShareDelta = late.hkShare - early.hkShare;

  if (early.activity > 0 && activityRatio <= 0.55 && wetCellRatio <= 0.7) {
    return {
      ...base,
      ready:true,
      status:'weakening',
      label:early.hkShare >= 0.08 ? '香港附近雨區逐步減弱' : '雨區整體逐步減弱',
      activityRatio,
      wetCellRatio
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

    if (distanceChange >= APPROACH_KM) {
      const label = early.dominant === 'southSea'
        ? '雨帶正由南面海域向香港靠近'
        : early.dominant === 'shenzhen'
          ? '深圳方向雨區正向香港靠近'
          : '雨區正向香港靠近';
      return {
        ...base,
        ready:true,
        status:'approaching-hong-kong',
        label,
        displacementKm,
        distanceToHongKongChangeKm:distanceChange,
        activityRatio,
        wetCellRatio,
        hkShareDelta
      };
    }

    if (-distanceChange >= AWAY_KM) {
      return {
        ...base,
        ready:true,
        status:'moving-away',
        label:'雨區逐步遠離香港',
        displacementKm,
        distanceToHongKongChangeKm:distanceChange,
        activityRatio,
        wetCellRatio,
        hkShareDelta
      };
    }

    if (displacementKm >= MOVE_KM) {
      return {
        ...base,
        ready:true,
        status:'moving',
        label:`雨區主要向${directionLabel(dxKm, dyKm)}移動`,
        displacementKm,
        distanceToHongKongChangeKm:distanceChange,
        activityRatio,
        wetCellRatio,
        hkShareDelta
      };
    }

    if (displacementKm <= STEADY_KM && activityRatio >= 0.6 && activityRatio <= 1.6) {
      return {
        ...base,
        ready:true,
        status:'steady',
        label:'雨區位置變化不大',
        displacementKm,
        distanceToHongKongChangeKm:distanceChange,
        activityRatio,
        wetCellRatio,
        hkShareDelta
      };
    }
  }

  if ((early.activity <= 0 && late.activity > 0) || (Number.isFinite(activityRatio) && activityRatio >= 1.7 && wetCellRatio >= 1.3)) {
    return {
      ...base,
      ready:true,
      status:'strengthening',
      label:'雨區整體逐步增強',
      activityRatio,
      wetCellRatio,
      hkShareDelta
    };
  }

  return {
    ...base,
    ready:true,
    status:'variable',
    label:'雨區位置有變化，移動方向未明顯',
    activityRatio,
    wetCellRatio,
    hkShareDelta
  };
}
