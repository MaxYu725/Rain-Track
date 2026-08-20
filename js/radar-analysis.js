const EARTH_RADIUS_KM = 6371.0088;
const MIN_ALPHA = 28;
const MIN_CHROMA = 34;
const MAX_PALETTE_DISTANCE = 175;

export const RADAR_ANALYSIS_SAMPLE_MAX_DIMENSION = 320;

const RADAR_PALETTE = Object.freeze([
  { rgb:[0,76,214], strength:1.0 },
  { rgb:[0,185,223], strength:1.2 },
  { rgb:[0,201,107], strength:2.0 },
  { rgb:[214,214,0], strength:3.0 },
  { rgb:[242,139,32], strength:4.0 },
  { rgb:[215,53,69], strength:5.0 },
  { rgb:[190,45,160], strength:5.0 }
]);

const HK_POLYGONS = Object.freeze([
  [[113.82,22.16],[113.82,22.31],[113.96,22.34],[114.07,22.31],[114.07,22.18],[113.98,22.15]],
  [[114.08,22.20],[114.12,22.29],[114.24,22.30],[114.30,22.25],[114.27,22.20]],
  [[114.10,22.29],[114.10,22.36],[114.25,22.36],[114.27,22.30]],
  [[113.84,22.34],[113.84,22.56],[114.05,22.56],[114.11,22.45],[114.10,22.34]],
  [[114.10,22.36],[114.10,22.46],[114.22,22.44],[114.28,22.46],[114.28,22.36]],
  [[114.05,22.46],[114.05,22.56],[114.30,22.56],[114.30,22.47],[114.22,22.44],[114.10,22.46]],
  [[114.28,22.22],[114.28,22.48],[114.40,22.50],[114.50,22.42],[114.50,22.24],[114.40,22.20]]
]);

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function toRadians(value) {
  return Number(value) * Math.PI / 180;
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
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

function isHongKong(lat, lon) {
  return HK_POLYGONS.some(polygon => pointInPolygon(lat, lon, polygon));
}

function blankAccumulator() {
  return {
    sampleCount:0,
    echoCount:0,
    strengthSum:0,
    maxStrength:0,
    weightedLat:0,
    weightedLon:0,
    weightSum:0
  };
}

function addSample(stats, { echo, strength, lat, lon }) {
  stats.sampleCount += 1;
  if (!echo) return;
  stats.echoCount += 1;
  stats.strengthSum += strength;
  stats.maxStrength = Math.max(stats.maxStrength, strength);
  const weight = Math.max(0.6, strength);
  stats.weightedLat += lat * weight;
  stats.weightedLon += lon * weight;
  stats.weightSum += weight;
}

function finalizeStats(stats) {
  const coverage = stats.sampleCount ? stats.echoCount / stats.sampleCount : 0;
  return {
    sampleCount:stats.sampleCount,
    echoCount:stats.echoCount,
    coverage:round(coverage, 4),
    meanStrength:stats.echoCount ? round(stats.strengthSum / stats.echoCount, 3) : 0,
    maxStrength:round(stats.maxStrength, 3),
    centroid:stats.weightSum ? {
      lat:round(stats.weightedLat / stats.weightSum, 5),
      lon:round(stats.weightedLon / stats.weightSum, 5)
    } : null
  };
}

function paletteDistance(r, g, b, palette) {
  return Math.hypot(r - palette.rgb[0], g - palette.rgb[1], b - palette.rgb[2]);
}

export function classifyRadarPixel(r, g, b, a = 255) {
  if (Number(a) < MIN_ALPHA) return null;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 52 || max - min < MIN_CHROMA) return null;

  let nearest = null;
  let nearestDistance = Infinity;
  for (const palette of RADAR_PALETTE) {
    const distance = paletteDistance(r, g, b, palette);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = palette;
    }
  }
  if (!nearest || nearestDistance > MAX_PALETTE_DISTANCE) return null;
  return {
    strength:nearest.strength,
    paletteDistance:round(nearestDistance, 2)
  };
}

function normalizeLocation(location, radiusKm) {
  const lat = Number(location?.lat);
  const lon = Number(location?.lon);
  const radius = Number(radiusKm);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius) || radius <= 0) return null;
  return { lat, lon, radiusKm:radius };
}

function framePointFromPixel(x, y, width, height, bounds) {
  const xRatio = width > 1 ? x / (width - 1) : 0.5;
  const yRatio = height > 1 ? y / (height - 1) : 0.5;
  return {
    lat:bounds.north - yRatio * (bounds.north - bounds.south),
    lon:bounds.west + xRatio * (bounds.east - bounds.west)
  };
}

export function analyzeRadarPixels(imageData, frame, { location = null, radiusKm = 2, rangeKm = null, heightKm = null } = {}) {
  const data = imageData?.data;
  const width = Number(imageData?.width);
  const height = Number(imageData?.height);
  const bounds = frame?.bounds;
  if (!data || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Radar analysis image data is invalid');
  }
  if (!bounds || ![bounds.north,bounds.south,bounds.east,bounds.west].every(Number.isFinite)) {
    throw new Error('Radar analysis frame bounds are invalid');
  }

  const normalizedLocation = normalizeLocation(location, radiusKm);
  const hk = blankAccumulator();
  const nearby = blankAccumulator();

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const classified = classifyRadarPixel(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
      const point = framePointFromPixel(x, y, width, height, bounds);
      const sample = {
        echo:Boolean(classified),
        strength:classified?.strength || 0,
        lat:point.lat,
        lon:point.lon
      };

      if (isHongKong(point.lat, point.lon)) addSample(hk, sample);
      if (normalizedLocation) {
        const distanceToLocationKm = distanceKm(point.lat, point.lon, normalizedLocation.lat, normalizedLocation.lon);
        if (distanceToLocationKm <= normalizedLocation.radiusKm) addSample(nearby, sample);
      }
    }
  }

  return {
    time:frame?.time || null,
    frameId:frame?.id || null,
    rangeKm:Number(rangeKm) || null,
    heightKm:Number(heightKm) || null,
    sampleSize:{ width, height },
    hongKong:finalizeStats(hk),
    nearby:finalizeStats(nearby)
  };
}

export function radarCoverageLabel(coverage) {
  const value = Number(coverage) || 0;
  if (value < 0.018) return '暫未見明顯';
  if (value < 0.08) return '零星';
  if (value < 0.28) return '局部';
  return '較廣泛';
}

export function radarStrengthLabel(meanStrength, maxStrength = meanStrength) {
  const mean = Number(meanStrength) || 0;
  const max = Number(maxStrength) || 0;
  if (max >= 4.4 && mean >= 2.4) return '有較強回波';
  if (mean >= 3.2) return '回波中等至較強';
  if (mean >= 2.1) return '回波中等';
  return '回波偏弱';
}

export function hongKongEchoLocationLabel(centroid) {
  if (!centroid) return '香港';
  const lat = Number(centroid.lat);
  const lon = Number(centroid.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '香港';
  const dy = lat - 22.35;
  const dx = (lon - 114.16) * Math.cos(toRadians(22.35));
  const xStrong = Math.abs(dx) >= 0.055;
  const yStrong = Math.abs(dy) >= 0.055;
  if (xStrong && yStrong) return `香港${dy > 0 ? '北' : '南'}${dx > 0 ? '東' : '西'}部`;
  if (Math.abs(dx) > Math.abs(dy) * 1.15 && xStrong) return `香港${dx > 0 ? '東' : '西'}部`;
  if (yStrong) return `香港${dy > 0 ? '北' : '南'}部`;
  return '香港中部';
}

export function describeRadarAnalysis(current, { locationName = '所在地' } = {}) {
  if (!current) return {
    hongKongText:'正在分析香港目前回波',
    nearbyText:`正在分析${locationName}附近目前回波`
  };

  const hk = current.hongKong;
  const nearby = current.nearby;
  const hkCoverage = radarCoverageLabel(hk?.coverage);
  const hkPlace = hongKongEchoLocationLabel(hk?.centroid);
  const hongKongText = hkCoverage === '暫未見明顯'
    ? '香港大部分地區暫未見明顯回波'
    : `${hkPlace}回波較明顯 · ${hkCoverage} · ${radarStrengthLabel(hk?.meanStrength, hk?.maxStrength)}`;

  let nearbyText = `${locationName}附近資料不足`;
  if (nearby?.sampleCount >= 3) {
    const nearbyCoverage = radarCoverageLabel(nearby.coverage);
    nearbyText = nearbyCoverage === '暫未見明顯'
      ? `${locationName}附近暫未見明顯回波`
      : `${locationName}附近有${nearbyCoverage}回波 · ${radarStrengthLabel(nearby.meanStrength, nearby.maxStrength)}`;
  }

  return { hongKongText, nearbyText };
}
