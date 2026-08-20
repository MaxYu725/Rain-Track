export const RAIN_AREA_THRESHOLD_MM = 0.2;

export const RAIN_AREA_ZONES = Object.freeze({
  hongKong: Object.freeze({ key:'hongKong', label:'香港' }),
  shenzhen: Object.freeze({ key:'shenzhen', label:'深圳' }),
  southSea: Object.freeze({ key:'southSea', label:'南面海域' }),
  other: Object.freeze({ key:'other', label:'其他範圍' })
});

export const RAIN_AREA_PRODUCT_ZONES = Object.freeze({
  hkLantauIslands:Object.freeze({ key:'hkLantauIslands', parent:'hongKong', label:'大嶼山及離島', polygon:[[113.82,22.15],[114.08,22.15],[114.08,22.34],[113.82,22.34]] }),
  hkIsland:Object.freeze({ key:'hkIsland', parent:'hongKong', label:'香港島', polygon:[[114.08,22.15],[114.28,22.15],[114.28,22.29],[114.08,22.29]] }),
  hkKowloon:Object.freeze({ key:'hkKowloon', parent:'hongKong', label:'九龍', polygon:[[114.08,22.29],[114.28,22.29],[114.28,22.36],[114.08,22.36]] }),
  hkNtWest:Object.freeze({ key:'hkNtWest', parent:'hongKong', label:'新界西', polygon:[[113.82,22.34],[114.10,22.34],[114.10,22.56],[113.82,22.56]] }),
  hkNtEast:Object.freeze({ key:'hkNtEast', parent:'hongKong', label:'新界東', polygon:[[114.10,22.36],[114.28,22.36],[114.28,22.46],[114.10,22.46]] }),
  hkNtNorth:Object.freeze({ key:'hkNtNorth', parent:'hongKong', label:'新界北', polygon:[[114.10,22.46],[114.28,22.46],[114.28,22.56],[114.10,22.56]] }),
  hkSaiKungEast:Object.freeze({ key:'hkSaiKungEast', parent:'hongKong', label:'西貢及香港東面', polygon:[[114.28,22.15],[114.50,22.15],[114.50,22.56],[114.28,22.56]] }),
  szWest:Object.freeze({ key:'szWest', parent:'shenzhen', label:'深圳西部', polygon:[[113.72,22.52],[114.02,22.52],[114.02,22.90],[113.72,22.90]] }),
  szCentral:Object.freeze({ key:'szCentral', parent:'shenzhen', label:'深圳中部', polygon:[[114.02,22.52],[114.35,22.52],[114.35,22.90],[114.02,22.90]] }),
  szEast:Object.freeze({ key:'szEast', parent:'shenzhen', label:'深圳東部', polygon:[[114.35,22.52],[114.65,22.52],[114.65,22.90],[114.35,22.90]] }),
  seaWest:Object.freeze({ key:'seaWest', parent:'southSea', label:'西南海域', polygon:[[112.956,21.328],[113.75,21.328],[113.75,22.15],[112.956,22.15]] }),
  seaSouth:Object.freeze({ key:'seaSouth', parent:'southSea', label:'正南海域', polygon:[[113.75,21.328],[114.50,21.328],[114.50,22.15],[113.75,22.15]] }),
  seaEast:Object.freeze({ key:'seaEast', parent:'southSea', label:'東南海域', polygon:[[114.50,21.328],[115.291,21.328],[115.291,22.15],[114.50,22.15]] })
});

const PRODUCT_ZONE_LIST = Object.freeze(Object.values(RAIN_AREA_PRODUCT_ZONES));

function blankStats(zone) {
  return {
    key:zone.key,
    parent:zone.parent || null,
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
  // territory is not double counted. These are deliberately coarse product
  // regions for weather orientation, not administrative-boundary claims.
  if (lat >= 22.15 && lat <= 22.56 && lon >= 113.82 && lon <= 114.50) return RAIN_AREA_ZONES.hongKong;
  if (lat >= 22.52 && lat <= 22.90 && lon >= 113.72 && lon <= 114.65) return RAIN_AREA_ZONES.shenzhen;
  if (lat >= 21.328 && lat < 22.15 && lon >= 112.956 && lon <= 115.291) return RAIN_AREA_ZONES.southSea;
  return RAIN_AREA_ZONES.other;
}

function pointOnSegment(x, y, ax, ay, bx, by) {
  const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
  if (Math.abs(cross) > 1e-9) return false;
  const dot = (x - ax) * (x - bx) + (y - ay) * (y - by);
  return dot <= 1e-9;
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

function productZoneFor(lat, lon, parentZone) {
  if (!parentZone || parentZone.key === 'other') return null;
  return PRODUCT_ZONE_LIST.find(zone => zone.parent === parentZone.key && pointInPolygon(lat, lon, zone.polygon)) || null;
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

function dominantProductZones(productZones) {
  return Object.values(productZones)
    .filter(zone => zone.wetCellCount >= 2 && zone.wetShare >= 0.04)
    .sort((a, b) => b.score - a.score);
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

function makeRegionalPresentation(headline, productZones) {
  const ranked = dominantProductZones(productZones);
  if (!ranked.length) return { regionalLabel:headline.label, regionalDetail:'' };
  if (headline.status === 'hong-kong-widespread') {
    return {
      regionalLabel:headline.label,
      regionalDetail:ranked.slice(0, 3).map(zone => `${zone.label} ${percentage(zone.wetShare)}`).join(' · ')
    };
  }

  const first = ranked[0];
  const second = ranked[1];
  const combine = second
    && second.wetShare >= 0.08
    && second.score >= first.score * 0.72;
  const regionalLabel = combine
    ? `雨區主要在${first.label}及${second.label}`
    : `雨區較集中在${first.label}`;
  const regionalDetail = ranked.slice(0, 3).map(zone => `${zone.label} ${percentage(zone.wetShare)}`).join(' · ');
  return { regionalLabel, regionalDetail };
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
  const mutableProduct = Object.fromEntries(PRODUCT_ZONE_LIST.map(zone => [zone.key, blankStats(zone)]));
  let totalWetCellCount = 0;
  let totalWetMm = 0;
  let weightedLat = 0;
  let weightedLon = 0;
  let centroidWeight = 0;
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
      const productZone = productZoneFor(lat, lon, zone);
      const productStats = productZone ? mutableProduct[productZone.key] : null;
      stats.cellCount += 1;
      if (productStats) productStats.cellCount += 1;
      maxMm = Math.max(maxMm, value);
      if (value < threshold) continue;
      stats.wetCellCount += 1;
      stats.sumMm += value;
      stats.maxMm = Math.max(stats.maxMm, value);
      if (productStats) {
        productStats.wetCellCount += 1;
        productStats.sumMm += value;
        productStats.maxMm = Math.max(productStats.maxMm, value);
      }
      totalWetCellCount += 1;
      totalWetMm += value;
      centroidWeight += value;
      weightedLat += lat * value;
      weightedLon += lon * value;
    }
  }

  const zones = Object.fromEntries(Object.entries(mutable).map(([key, stats]) => [key, finalizeStats(stats)]));
  const productZones = Object.fromEntries(Object.entries(mutableProduct).map(([key, stats]) => [key, finalizeStats(stats)]));
  const headline = makeLabel(zones, totalWetCellCount);
  const regional = makeRegionalPresentation(headline, productZones);
  const detail = `香港 ${percentage(zones.hongKong.wetShare)} · 深圳 ${percentage(zones.shenzhen.wetShare)} · 南面海域 ${percentage(zones.southSea.wetShare)}`;
  const centroid = centroidWeight > 0
    ? { lat:round(weightedLat / centroidWeight, 4), lon:round(weightedLon / centroidWeight, 4) }
    : null;

  return {
    ...headline,
    ...regional,
    detail,
    thresholdMm:threshold,
    totalWetCellCount,
    totalWetMm:round(totalWetMm),
    centroid,
    maxMm:round(maxMm),
    zones,
    productZones
  };
}
