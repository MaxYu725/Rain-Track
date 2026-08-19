export const RAIN_AREA_THRESHOLD_MM = 0.2;

export const RAIN_AREA_ZONES = Object.freeze({
  hongKong: Object.freeze({ key:'hongKong', label:'香港' }),
  shenzhen: Object.freeze({ key:'shenzhen', label:'深圳' }),
  southSea: Object.freeze({ key:'southSea', label:'南面海域' }),
  other: Object.freeze({ key:'other', label:'其他範圍' })
});

function blankStats(zone) {
  return {
    key:zone.key,
    label:zone.label,
    cellCount:0,
    wetCellCount:0,
    wetShare:0,
    sumMm:0,
    meanWetMm:0,
    maxMm:0,
    score:0
  };
}

function zoneFor(lat, lon) {
  // HK takes priority in the narrow border overlap with Shenzhen so the
  // territory is not double counted. These are intentionally coarse product
  // regions for orientation, not administrative-boundary claims.
  if (lat >= 22.15 && lat <= 22.56 && lon >= 113.82 && lon <= 114.50) return RAIN_AREA_ZONES.hongKong;
  if (lat >= 22.52 && lat <= 22.90 && lon >= 113.72 && lon <= 114.65) return RAIN_AREA_ZONES.shenzhen;
  if (lat >= 21.328 && lat < 22.15 && lon >= 112.956 && lon <= 115.291) return RAIN_AREA_ZONES.southSea;
  return RAIN_AREA_ZONES.other;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function finalizeStats(stats) {
  const wetShare = stats.cellCount ? stats.wetCellCount / stats.cellCount : 0;
  const meanWetMm = stats.wetCellCount ? stats.sumMm / stats.wetCellCount : 0;
  // Coverage share is the main signal. Mean wet-cell intensity gives a small
  // boost without allowing one isolated extreme cell to dominate the label.
  const score = wetShare * (1 + Math.log1p(meanWetMm));
  return {
    ...stats,
    wetShare:round(wetShare, 4),
    sumMm:round(stats.sumMm),
    meanWetMm:round(meanWetMm),
    maxMm:round(stats.maxMm),
    score:round(score, 4)
  };
}

function percentage(value) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
}

function dominantRegion(zones) {
  return [zones.hongKong, zones.shenzhen, zones.southSea]
    .filter(zone => zone.wetCellCount > 0)
    .sort((a, b) => b.score - a.score)[0] || null;
}

function makeLabel(zones, totalWetCellCount) {
  if (!totalWetCellCount) return { status:'dry', label:'附近雨區不明顯' };

  const hk = zones.hongKong;
  const sz = zones.shenzhen;
  const sea = zones.southSea;
  if (hk.wetShare >= 0.78) return { status:'hong-kong-widespread', label:'香港大部分地區有雨' };
  if (hk.wetShare >= 0.28) return { status:'hong-kong-local', label:'香港以局部雨區為主' };

  const dominant = dominantRegion(zones);
  if (dominant?.key === 'southSea' && sea.wetShare >= 0.06 && sea.score >= Math.max(hk.score, sz.score) * 1.15) {
    return { status:'south-sea', label:'雨區較集中在香港以南海域' };
  }
  if (dominant?.key === 'shenzhen' && sz.wetShare >= 0.06 && sz.score >= Math.max(hk.score, sea.score) * 1.15) {
    return { status:'shenzhen', label:'深圳附近雨區較明顯' };
  }
  if (hk.wetShare >= 0.08) return { status:'hong-kong-scattered', label:'香港有局部降雨訊號' };
  return { status:'scattered', label:'雨區在香港周邊較分散' };
}

export function summarizeForecastRainArea(frame, grid, { thresholdMm = RAIN_AREA_THRESHOLD_MM } = {}) {
  const latitudes = grid?.latitudes;
  const longitudes = grid?.longitudes;
  const values = frame?.values;
  const threshold = Number(thresholdMm);
  if (!Array.isArray(latitudes) || !latitudes.length || !Array.isArray(longitudes) || !longitudes.length) return null;
  if (!Array.isArray(values) || values.length !== latitudes.length * longitudes.length) return null;
  if (!Number.isFinite(threshold) || threshold < 0) return null;

  const mutable = {
    hongKong:blankStats(RAIN_AREA_ZONES.hongKong),
    shenzhen:blankStats(RAIN_AREA_ZONES.shenzhen),
    southSea:blankStats(RAIN_AREA_ZONES.southSea),
    other:blankStats(RAIN_AREA_ZONES.other)
  };
  let totalWetCellCount = 0;
  let maxMm = 0;

  for (let row = 0; row < latitudes.length; row += 1) {
    const lat = Number(latitudes[row]);
    if (!Number.isFinite(lat)) return null;
    for (let col = 0; col < longitudes.length; col += 1) {
      const lon = Number(longitudes[col]);
      const value = Number(values[row * longitudes.length + col]);
      if (!Number.isFinite(lon) || !Number.isFinite(value) || value < 0) return null;
      const zone = zoneFor(lat, lon);
      const stats = mutable[zone.key];
      stats.cellCount += 1;
      maxMm = Math.max(maxMm, value);
      if (value < threshold) continue;
      stats.wetCellCount += 1;
      stats.sumMm += value;
      stats.maxMm = Math.max(stats.maxMm, value);
      totalWetCellCount += 1;
    }
  }

  const zones = Object.fromEntries(Object.entries(mutable).map(([key, stats]) => [key, finalizeStats(stats)]));
  const headline = makeLabel(zones, totalWetCellCount);
  const detail = `香港 ${percentage(zones.hongKong.wetShare)} · 深圳 ${percentage(zones.shenzhen.wetShare)} · 南面海域 ${percentage(zones.southSea.wetShare)}`;

  return {
    ...headline,
    detail,
    thresholdMm:threshold,
    totalWetCellCount,
    maxMm:round(maxMm),
    zones
  };
}
