/**
 * Hong Kong Point Rainfall Forecast Worker v2.4.0
 * Cloudflare Worker (module syntax)
 *
 * Routes:
 *   GET /health
 *   GET /api/rain/point?lat=22.3023&lon=114.1746&radiusKm=2
 *   GET /api/rain/nowcast
 *   GET /probe/rain
 *   GET /api/capabilities
 *   GET /api/radar/frames?range=64|256&mode=live|test
 *   GET /api/radar/image?id=<base64url>
 *   GET /api/radar/test-image?range=64|256&frame=0..11
 *   GET /probe/radar?range=64|256&mode=live|test
 */

const VERSION = '2.4.0';
const HKO_NOWCAST = 'https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast_tc.csv';
const CACHE_TTL_SECONDS = 600;
const RADAR_CACHE_TTL_SECONDS = 180;
const RADAR_IMAGE_CACHE_TTL_SECONDS = 86400;
const RADAR_CADENCE_MINUTES = 6;
const RADAR_MAX_FRAMES = 30;

const RADAR = Object.freeze({
  64: {
    root: 'https://www.hko.gov.hk/wxinfo/radars/radar_064_kml/Radar_064.kml',
    fallbackBounds: { north: 22.89, south: 21.72, east: 114.82, west: 113.53 }
  },
  256: {
    root: 'https://www.hko.gov.hk/wxinfo/radars/radar_256_kml/Radar_256.kml',
    fallbackBounds: { north: 24.61, south: 19.99, east: 116.67, west: 111.68 }
  }
});

const RADAR_CONTRACT = Object.freeze({
  version: '1.0',
  enabled: true,
  endpoint: '/api/radar/frames?range=64|256&mode=live|test',
  imageEndpoint: '/api/radar/image?id=...',
  testImageEndpoint: '/api/radar/test-image?range=64|256&frame=0..11',
  rangesKm: [64, 256],
  modes: ['live', 'test'],
  cadenceMinutes: RADAR_CADENCE_MINUTES,
  maxFrames: RADAR_MAX_FRAMES,
  response: {
    contractVersion: '1.0',
    rangeKm: '64|256',
    mode: 'live|test',
    issueTime: 'ISO-8601|null',
    frames: [{ id: 'string', time: 'ISO-8601', imageUrl: 'string', bounds: { north: 'number', south: 'number', east: 'number', west: 'number' } }]
  }
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

const jsonHeaders = {
  ...corsHeaders,
  'Content-Type': 'application/json; charset=utf-8'
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') {
        return json({
          ok: true,
          service: 'hong-kong-point-rainfall-forecast',
          version: VERSION,
          routes: [
            '/api/rain/point?lat=22.3023&lon=114.1746&radiusKm=2',
            '/api/rain/nowcast',
            '/probe/rain',
            '/api/capabilities',
            '/api/radar/frames?range=64&mode=live',
            '/api/radar/image?id=...',
            '/api/radar/test-image?range=64&frame=0',
            '/probe/radar?range=64&mode=live'
          ],
          capabilities: {
            pointForecast: true,
            nowcastGrid: true,
            radarFrames: true,
            radar: RADAR_CONTRACT
          },
          radarContract: RADAR_CONTRACT,
          time: new Date().toISOString()
        });
      }

      if (url.pathname === '/api/capabilities') return json({
        ok: true,
        version: VERSION,
        capabilities: { pointForecast: true, nowcastGrid: true, radarFrames: true, radar: RADAR_CONTRACT },
        radarContract: RADAR_CONTRACT
      }, 200, { 'Cache-Control': 'public, max-age=300' });

      if (url.pathname === '/api/rain/point') return await handlePointForecast(url);
      if (url.pathname === '/api/rain/nowcast') return await handleNowcast(false);
      if (url.pathname === '/probe/rain') return await handleNowcast(true);

      if (url.pathname === '/api/radar/frames') {
        return await handleRadarFrames(normalizeRange(url.searchParams.get('range')), normalizeRadarMode(url.searchParams.get('mode')), false);
      }
      if (url.pathname === '/probe/radar') {
        return await handleRadarFrames(normalizeRange(url.searchParams.get('range')), normalizeRadarMode(url.searchParams.get('mode')), true);
      }
      if (url.pathname === '/api/radar/image') return await handleRadarImage(url.searchParams.get('id'));
      if (url.pathname === '/api/radar/test-image') return handleRadarTestImage(url);

      return json({ ok: false, error: 'Not found', version: VERSION }, 404);
    } catch (error) {
      return json({ ok: false, version: VERSION, error: safeError(error) }, 500);
    }
  }
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...jsonHeaders, ...extraHeaders }
  });
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeRange(value) {
  return String(value) === '256' ? 256 : 64;
}

function normalizeRadarMode(value) {
  return String(value).toLowerCase() === 'test' ? 'test' : 'live';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HK-Point-Rain-Worker/2.4)',
        Accept: '*/*',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCached(url, ttl, accept = '*/*') {
  const cache = caches.default;
  const cacheKey = new Request(url, { headers: { Accept: accept } });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = await fetchWithTimeout(url, {
    headers: { Accept: accept },
    cf: { cacheEverything: true, cacheTtl: ttl }
  });
  if (!upstream.ok) throw new Error(`Upstream HTTP ${upstream.status}: ${new URL(url).hostname}`);

  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', `public, max-age=${ttl}`);
  const response = new Response(upstream.body, { status: upstream.status, headers });
  await cache.put(cacheKey, response.clone());
  return response;
}

async function loadNowcast() {
  const response = await fetchCached(HKO_NOWCAST, CACHE_TTL_SECONDS, 'text/csv,*/*');
  const text = await response.text();
  const parsed = parseNowcastCSV(text);
  return {
    parsed,
    sourceBytes: text.length,
    sourceUpdatedAt: response.headers.get('last-modified')
  };
}

async function handleNowcast(probe) {
  const { parsed, sourceBytes, sourceUpdatedAt } = await loadNowcast();
  const { axes, ...publicData } = parsed;

  if (probe) {
    return json({
      ok: parsed.frames.length > 0,
      version: VERSION,
      source: HKO_NOWCAST,
      sourceBytes,
      sourceUpdatedAt,
      frameCount: parsed.frames.length,
      pointCounts: parsed.frames.map(frame => frame.points.length),
      times: parsed.frames.map(frame => frame.time),
      grid: parsed.grid,
      axisCounts: { lat: axes.lats.length, lon: axes.lons.length },
      parser: parsed.parser
    }, 200, { 'Cache-Control': 'no-store' });
  }

  return json({
    ok: true,
    version: VERSION,
    source: 'HKO gridded rainfall nowcast',
    sourceUpdatedAt,
    generatedAt: new Date().toISOString(),
    ...publicData
  }, 200, { 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` });
}

async function handlePointForecast(url) {
  const lat = numberOrNull(url.searchParams.get('lat'));
  const lon = numberOrNull(url.searchParams.get('lon'));
  const radiusKm = clamp(numberOrNull(url.searchParams.get('radiusKm')) ?? 2, 0.5, 5);

  if (lat === null || lon === null) {
    return json({ ok: false, error: 'Missing or invalid lat/lon' }, 400);
  }
  if (lat < 20 || lat > 25 || lon < 111 || lon > 117) {
    return json({ ok: false, error: 'Coordinates are outside the supported region' }, 422);
  }

  const { parsed, sourceUpdatedAt } = await loadNowcast();
  const coverage = parsed.grid;
  if (!insideCoverage(lat, lon, coverage)) {
    return json({
      ok: false,
      error: 'Selected point is outside the official forecast grid',
      coverage
    }, 422);
  }

  const prepared = parsed.frames.map(frame => ({
    frame,
    index: buildPointIndex(frame.points)
  }));

  const sampleLocations = makeNearbySamples(lat, lon, radiusKm);
  const periods = [];

  for (const item of prepared) {
    const center = interpolateGrid(item.index, parsed.axes, lat, lon);
    if (!center) continue;

    const nearby = sampleLocations
      .map(point => interpolateGrid(item.index, parsed.axes, point.lat, point.lon))
      .filter(Boolean)
      .map(result => result.value);

    const nearbyMax = nearby.length ? Math.max(...nearby) : center.value;
    const nearbyMean = nearby.length ? nearby.reduce((sum, value) => sum + value, 0) / nearby.length : center.value;

    periods.push({
      time: item.frame.time,
      leadMinutes: item.frame.leadMinutes,
      amountMm: round(center.value, 2),
      nearbyMaxMm: round(nearbyMax, 2),
      nearbyMeanMm: round(nearbyMean, 2),
      nearestGridKm: round(center.nearestGridKm, 2),
      spatialSpreadMm: round(center.spatialSpreadMm, 2),
      level: rainLevel(center.value)
    });
  }

  if (!periods.length) {
    return json({ ok: false, error: 'No point forecast could be calculated' }, 502);
  }

  const summary = summarisePeriods(periods);
  const issueTime = parsed.issueTime || parsed.baseTime;
  const sourceAgeMinutes = issueTime ? Math.max(0, Math.round((Date.now() - Date.parse(issueTime)) / 60000)) : null;
  const nearbyDeltaMax = Math.max(...periods.map(period => Math.max(0, period.nearbyMaxMm - period.amountMm)));
  const quality = assessDataQuality(sourceAgeMinutes, nearbyDeltaMax, periods);

  return json({
    ok: true,
    version: VERSION,
    source: 'Hong Kong Observatory gridded rainfall nowcast',
    sourceUpdatedAt,
    generatedAt: new Date().toISOString(),
    issueTime,
    unit: 'mm / 30 min',
    location: { lat, lon },
    nearbyRadiusKm: radiusKm,
    interpolation: 'bilinear-four-grid-points',
    grid: parsed.grid,
    summary,
    dataQuality: {
      ...quality,
      sourceAgeMinutes,
      nearbyDeltaMaxMm: round(nearbyDeltaMax, 2)
    },
    periods
  }, 200, { 'Cache-Control': 'public, max-age=300' });
}

function buildPointIndex(points) {
  const index = new Map();
  for (const point of points || []) index.set(coordKey(point[0], point[1]), Number(point[2]));
  return index;
}

function coordKey(lat, lon) {
  return `${Number(lat).toFixed(6)}|${Number(lon).toFixed(6)}`;
}

function interpolateGrid(index, axes, lat, lon) {
  const latPair = bracket(axes.lats, lat);
  const lonPair = bracket(axes.lons, lon);
  if (!latPair || !lonPair) return null;

  const [lat0, lat1] = latPair;
  const [lon0, lon1] = lonPair;
  const corners = [
    { lat: lat0, lon: lon0, value: index.get(coordKey(lat0, lon0)) },
    { lat: lat0, lon: lon1, value: index.get(coordKey(lat0, lon1)) },
    { lat: lat1, lon: lon0, value: index.get(coordKey(lat1, lon0)) },
    { lat: lat1, lon: lon1, value: index.get(coordKey(lat1, lon1)) }
  ].filter(corner => Number.isFinite(corner.value));

  if (!corners.length) return null;

  let value;
  if (corners.length === 4 && lat1 !== lat0 && lon1 !== lon0) {
    const tx = clamp((lon - lon0) / (lon1 - lon0), 0, 1);
    const ty = clamp((lat - lat0) / (lat1 - lat0), 0, 1);
    const q00 = index.get(coordKey(lat0, lon0));
    const q01 = index.get(coordKey(lat0, lon1));
    const q10 = index.get(coordKey(lat1, lon0));
    const q11 = index.get(coordKey(lat1, lon1));
    const lower = q00 * (1 - tx) + q01 * tx;
    const upper = q10 * (1 - tx) + q11 * tx;
    value = lower * (1 - ty) + upper * ty;
  } else {
    const weighted = corners.map(corner => {
      const distance = Math.max(0.02, haversine(lat, lon, corner.lat, corner.lon));
      return { ...corner, weight: 1 / (distance * distance) };
    });
    value = weighted.reduce((sum, corner) => sum + corner.value * corner.weight, 0)
      / weighted.reduce((sum, corner) => sum + corner.weight, 0);
  }

  const values = corners.map(corner => corner.value);
  const nearestGridKm = Math.min(...corners.map(corner => haversine(lat, lon, corner.lat, corner.lon)));
  return {
    value: Math.max(0, value),
    nearestGridKm,
    spatialSpreadMm: Math.max(...values) - Math.min(...values)
  };
}

function bracket(sortedValues, target) {
  if (!sortedValues.length || target < sortedValues[0] || target > sortedValues[sortedValues.length - 1]) return null;
  let low = 0;
  let high = sortedValues.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = sortedValues[mid];
    if (Math.abs(value - target) < 1e-9) return [value, value];
    if (value < target) low = mid + 1;
    else high = mid - 1;
  }
  return [sortedValues[Math.max(0, high)], sortedValues[Math.min(sortedValues.length - 1, low)]];
}

function makeNearbySamples(lat, lon, radiusKm) {
  const points = [{ lat, lon }];
  const latKm = 110.574;
  const lonKm = Math.max(1, 111.320 * Math.cos(lat * Math.PI / 180));
  for (let bearing = 0; bearing < 360; bearing += 45) {
    const angle = bearing * Math.PI / 180;
    points.push({
      lat: lat + (Math.cos(angle) * radiusKm) / latKm,
      lon: lon + (Math.sin(angle) * radiusKm) / lonKm
    });
  }
  return points;
}

function summarisePeriods(periods) {
  const wetThreshold = 0.2;
  const totalMm = round(periods.reduce((sum, period) => sum + period.amountMm, 0), 2);
  const wet = periods.filter(period => period.amountMm >= wetThreshold);
  const peak = periods.reduce((best, period) => period.amountMm > best.amountMm ? period : best, periods[0]);
  const nearbyWet = periods.some(period => period.nearbyMaxMm >= wetThreshold);
  const firstWet = wet[0] || null;
  const lastWet = wet[wet.length - 1] || null;

  let text;
  if (!wet.length) {
    text = nearbyWet
      ? '定點未來兩小時暫未見明顯降雨，但附近地區可能有雨。'
      : '未來兩小時暫未預測有明顯降雨。';
  } else {
    text = `可能於 ${formatHkWindow(firstWet.time)} 期間開始有雨，較強時段約為 ${formatHkWindow(peak.time)}。`;
  }

  return {
    text,
    totalMm,
    peakMm: round(peak.amountMm, 2),
    peakTime: peak.time,
    peakWindowStart: subtractMinutesIso(peak.time, 30),
    peakWindowEnd: peak.time,
    rainStartTime: firstWet?.time || null,
    rainStartWindowStart: firstWet ? subtractMinutesIso(firstWet.time, 30) : null,
    rainStartWindowEnd: firstWet?.time || null,
    rainStartLeadMinutes: firstWet?.leadMinutes ?? null,
    rainEndTime: lastWet?.time || null,
    rainEndWindowStart: lastWet ? subtractMinutesIso(lastWet.time, 30) : null,
    rainEndWindowEnd: lastWet?.time || null,
    wetPeriodCount: wet.length
  };
}

function assessDataQuality(sourceAgeMinutes, nearbyDeltaMax, periods) {
  const maxSpread = Math.max(...periods.map(period => period.spatialSpreadMm));
  let freshness;
  if (sourceAgeMinutes !== null && sourceAgeMinutes > 60) {
    freshness = { status: 'expired', label: '資料已過期', note: '官方網格資料基準已超過60分鐘，結果只供參考，請稍後重新整理。', sourceAgeMinutes };
  } else if (sourceAgeMinutes !== null && sourceAgeMinutes > 30) {
    freshness = { status: 'stale', label: '資料可能過期', note: '官方網格資料基準已超過30分鐘，可能仍在等待上游更新。', sourceAgeMinutes };
  } else if (sourceAgeMinutes !== null && sourceAgeMinutes > 18) {
    freshness = { status: 'delayed', label: '更新稍有延遲', note: '官方網格資料基準已超過18分鐘，但仍可作短時參考。', sourceAgeMinutes };
  } else {
    freshness = { status: 'normal', label: '資料更新正常', note: '官方網格資料更新時間正常。', sourceAgeMinutes };
  }

  const sensitive = nearbyDeltaMax >= 2 || maxSpread >= 3;
  const spatial = sensitive
    ? { status: 'sensitive', label: '雨區邊界接近', note: '附近網格雨量差異較大，小幅移動位置可能改變結果。', nearbyDeltaMaxMm: round(nearbyDeltaMax, 2), maxSpatialSpreadMm: round(maxSpread, 2) }
    : { status: 'stable', label: '附近差異小', note: '定點與附近網格的預報變化相對平順。', nearbyDeltaMaxMm: round(nearbyDeltaMax, 2), maxSpatialSpreadMm: round(maxSpread, 2) };

  const legacyStatus = freshness.status !== 'normal' ? freshness.status : (sensitive ? 'location-sensitive' : 'normal');
  return {
    status: legacyStatus,
    label: freshness.status !== 'normal' ? freshness.label : spatial.label,
    note: freshness.status !== 'normal' ? freshness.note : spatial.note,
    freshness,
    spatial
  };
}

function subtractMinutesIso(value, minutes) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() - minutes * 60000).toISOString();
}

function formatHkWindow(endValue) {
  const end = new Date(endValue);
  if (Number.isNaN(end.getTime())) return '時間不詳';
  const start = new Date(end.getTime() - 30 * 60000);
  return `${formatHkTime(start)}–${formatHkTime(end)}`;
}

function rainLevel(value) {
  if (value >= 10) return 'very-heavy';
  if (value >= 2) return 'heavy';
  if (value >= 0.5) return 'moderate';
  if (value >= 0.2) return 'light';
  return 'dry';
}

function leadLabel(minutes) {
  if (!Number.isFinite(minutes)) return '稍後';
  if (minutes <= 30) return '半小時內';
  if (minutes <= 60) return '一小時內';
  return `${minutes}分鐘內`;
}

function formatHkTime(value) {
  if (!value) return '時間不詳';
  return new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value));
}

function insideCoverage(lat, lon, grid) {
  return Number.isFinite(grid.minLat) && Number.isFinite(grid.maxLat)
    && Number.isFinite(grid.minLon) && Number.isFinite(grid.maxLon)
    && lat >= grid.minLat && lat <= grid.maxLat
    && lon >= grid.minLon && lon <= grid.maxLon;
}

// ---------------------------------------------------------------------------
// Radar KML, image proxy and deterministic test frames
// ---------------------------------------------------------------------------

async function handleRadarFrames(range, mode, probe) {
  if (mode === 'test') return handleTestRadarFrames(range, probe);

  const source = RADAR[range];
  const diagnostics = {
    attempts: [], documents: [], errors: [], rejected: [],
    policy: 'KML-only; reject stale or unverifiable images',
    mode: 'live'
  };
  let frames = [];
  try {
    frames = await collectKmlFrames(source.root, range, diagnostics);
  } catch (error) {
    diagnostics.errors.push(safeError(error));
  }

  frames = validateRadarFrames(dedupeFrames(frames), diagnostics);
  frames = normalizeRadarFrameTimes(frames, diagnostics).slice(-RADAR_MAX_FRAMES);
  const issueTime = frames.at(-1)?.time || null;
  const payload = {
    ok: frames.length > 0,
    version: VERSION,
    contractVersion: RADAR_CONTRACT.version,
    rangeKm: range,
    mode: 'live',
    source: 'Hong Kong Observatory radar KML',
    root: source.root,
    generatedAt: new Date().toISOString(),
    issueTime,
    cadenceMinutes: RADAR_CADENCE_MINUTES,
    frameCount: frames.length,
    error: frames.length ? null : 'No fresh, verifiable HKO radar frames were found',
    frames: frames.map((frame, index) => ({
      id: encodeUrl(frame.href),
      index,
      time: frame.time,
      name: frame.name || `Radar ${index + 1}`,
      bounds: frame.bounds || source.fallbackBounds,
      source: frame.source,
      timeSource: frame.timeSource || null,
      rawTime: probe ? (frame.rawTime || null) : undefined,
      imageUrl: `/api/radar/image?id=${encodeURIComponent(encodeUrl(frame.href))}`
    }))
  };

  if (probe) {
    payload.diagnostics = diagnostics;
    payload.frames = payload.frames.slice(-10);
    return json(payload, 200, { 'Cache-Control': 'no-store' });
  }

  return json(payload, frames.length ? 200 : 502, { 'Cache-Control': `public, max-age=${RADAR_CACHE_TTL_SECONDS}` });
}

function handleTestRadarFrames(range, probe) {
  const bounds = RADAR[range].fallbackBounds;
  const count = 12;
  const cadenceMs = RADAR_CADENCE_MINUTES * 60 * 1000;
  const latestMs = Math.floor(Date.now() / cadenceMs) * cadenceMs;
  const frames = Array.from({ length: count }, (_, index) => {
    const time = new Date(latestMs - (count - 1 - index) * cadenceMs).toISOString();
    return {
      id: `test-${range}-${index}`,
      index,
      time,
      name: `TEST ${String(index + 1).padStart(2, '0')}`,
      bounds,
      source: 'synthetic-test',
      timeSource: 'generated',
      imageUrl: `/api/radar/test-image?range=${range}&frame=${index}&t=${encodeURIComponent(time)}`
    };
  });
  const payload = {
    ok: true,
    version: VERSION,
    contractVersion: RADAR_CONTRACT.version,
    rangeKm: range,
    mode: 'test',
    source: 'Synthetic radar test sequence',
    generatedAt: new Date().toISOString(),
    issueTime: frames.at(-1).time,
    cadenceMinutes: RADAR_CADENCE_MINUTES,
    frameCount: frames.length,
    frames
  };
  if (probe) payload.diagnostics = { mode: 'test', note: 'Synthetic deterministic frames for UI/animation testing during dry weather.' };
  return json(payload, 200, { 'Cache-Control': 'no-store' });
}

function handleRadarTestImage(url) {
  const range = normalizeRange(url.searchParams.get('range'));
  const frame = clamp(Math.round(numberOrNull(url.searchParams.get('frame')) ?? 0), 0, 30);
  const size = range === 256 ? 1024 : 800;
  const progress = frame / 11;
  const shift = Math.round(progress * size * 0.34);
  const scale = range === 256 ? 1.12 : 1;
  const x1 = Math.round(size * 0.18 + shift);
  const y1 = Math.round(size * 0.46 - Math.sin(progress * Math.PI * 1.4) * size * 0.08);
  const x2 = Math.round(size * 0.05 + shift * 0.78);
  const y2 = Math.round(size * 0.68 + Math.cos(progress * Math.PI) * size * 0.05);
  const x3 = Math.round(size * 0.32 + shift * 0.55);
  const y3 = Math.round(size * 0.28 + Math.sin(progress * Math.PI * 2) * size * 0.04);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="100%" height="100%" fill="none"/>
    <g opacity="0.78" filter="url(#soft)">
      <ellipse cx="${x1}" cy="${y1}" rx="${Math.round(115 * scale)}" ry="${Math.round(82 * scale)}" fill="#0aa7ff" opacity=".48"/>
      <ellipse cx="${x1 + 22}" cy="${y1 - 8}" rx="${Math.round(82 * scale)}" ry="${Math.round(58 * scale)}" fill="#35d35a" opacity=".62"/>
      <ellipse cx="${x1 + 42}" cy="${y1 - 12}" rx="${Math.round(50 * scale)}" ry="${Math.round(36 * scale)}" fill="#ffd83d" opacity=".74"/>
      <ellipse cx="${x1 + 57}" cy="${y1 - 18}" rx="${Math.round(27 * scale)}" ry="${Math.round(22 * scale)}" fill="#ff6d32" opacity=".85"/>
      <ellipse cx="${x2}" cy="${y2}" rx="${Math.round(92 * scale)}" ry="${Math.round(52 * scale)}" fill="#0aa7ff" opacity=".38"/>
      <ellipse cx="${x2 + 30}" cy="${y2 - 4}" rx="${Math.round(55 * scale)}" ry="${Math.round(34 * scale)}" fill="#35d35a" opacity=".52"/>
      <ellipse cx="${x3}" cy="${y3}" rx="${Math.round(66 * scale)}" ry="${Math.round(40 * scale)}" fill="#0aa7ff" opacity=".34"/>
    </g>
    <text x="${Math.round(size * 0.035)}" y="${Math.round(size * 0.065)}" fill="#ffffff" opacity=".42" font-size="${Math.round(size * 0.028)}" font-family="Arial,sans-serif">TEST RADAR · ${range} km · frame ${frame + 1}</text>
    <defs><filter id="soft"><feGaussianBlur stdDeviation="7"/></filter></defs>
  </svg>`;

  return new Response(svg, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function collectKmlFrames(rootUrl, range, diagnostics) {
  const visited = new Set();
  const frames = [];

  async function visit(url, depth) {
    if (depth > 3 || visited.has(url) || visited.size > 20) return;
    visited.add(url);
    const response = await fetchCached(url, RADAR_CACHE_TTL_SECONDS, 'application/vnd.google-earth.kml+xml,application/xml,text/xml,*/*');
    const text = await response.text();
    const lastModified = response.headers.get('last-modified');
    const dateHeader = response.headers.get('date');
    diagnostics.attempts.push({ url, status: response.status, bytes: text.length, lastModified, date: dateHeader });
    if (depth === 0) diagnostics.referenceTime = parseHttpDate(lastModified) || parseHttpDate(dateHeader) || new Date().toISOString();

    const overlays = extractBlocks(text, 'GroundOverlay');
    const links = extractBlocks(text, 'NetworkLink');
    diagnostics.documents.push({ url, depth, overlays: overlays.length, networkLinks: links.length });

    for (const block of overlays) {
      const hrefRaw = tagText(block, 'href');
      if (!hrefRaw) continue;
      const href = resolveUrl(decodeXml(hrefRaw), url);
      if (!isAllowedRadarImage(href)) continue;
      const bounds = parseBounds(block) || RADAR[range].fallbackBounds;
      const name = decodeXml(tagText(block, 'name') || '');
      const kmlTime = parseKmlTime(block);
      const textTime = parseTimeFromText(`${name} ${href}`);
      const time = kmlTime || textTime;
      frames.push({ href, bounds, name, time, rawTime: time, timeSource: kmlTime ? 'kml' : (textTime ? 'text' : null), source: 'kml' });
    }

    for (const block of links) {
      const hrefRaw = tagText(block, 'href');
      if (!hrefRaw) continue;
      const href = resolveUrl(decodeXml(hrefRaw), url);
      if (isAllowedHkoUrl(href) && /\.km[lz](?:$|\?)/i.test(href)) await visit(href, depth + 1);
    }
  }

  await visit(rootUrl, 0);
  return frames;
}

async function handleRadarImage(id) {
  if (!id) return json({ ok: false, error: 'Missing id' }, 400);
  let imageUrl;
  try { imageUrl = decodeUrl(id); } catch { return json({ ok: false, error: 'Invalid id' }, 400); }
  if (!isAllowedRadarImage(imageUrl)) return json({ ok: false, error: 'Image URL not allowed' }, 403);

  const response = await fetchCached(imageUrl, RADAR_IMAGE_CACHE_TTL_SECONDS, 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*');
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', `public, max-age=${RADAR_IMAGE_CACHE_TTL_SECONDS}, immutable`);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
}

function extractBlocks(xml, tag) {
  const pattern = new RegExp(`<(?:(?:[\\w-]+):)?${tag}\\b[^>]*>[\\s\\S]*?<\\/(?:(?:[\\w-]+):)?${tag}>`, 'gi');
  return xml.match(pattern) || [];
}

function tagText(xml, tag) {
  const pattern = new RegExp(`<(?:(?:[\\w-]+):)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w-]+):)?${tag}>`, 'i');
  const match = xml.match(pattern);
  return match ? match[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim() : null;
}

function parseBounds(block) {
  const north = numberOrNull(tagText(block, 'north'));
  const south = numberOrNull(tagText(block, 'south'));
  const east = numberOrNull(tagText(block, 'east'));
  const west = numberOrNull(tagText(block, 'west'));
  if ([north, south, east, west].every(value => value !== null)) return { north, south, east, west };

  const coordinates = tagText(block, 'coordinates');
  if (coordinates) {
    const pairs = coordinates.trim().split(/\s+/).map(pair => pair.split(',').map(Number)).filter(pair => pair.length >= 2 && pair.every(Number.isFinite));
    if (pairs.length >= 4) {
      return {
        north: Math.max(...pairs.map(pair => pair[1])),
        south: Math.min(...pairs.map(pair => pair[1])),
        east: Math.max(...pairs.map(pair => pair[0])),
        west: Math.min(...pairs.map(pair => pair[0]))
      };
    }
  }
  return null;
}

function parseKmlTime(block) {
  const when = tagText(block, 'when');
  const end = tagText(block, 'end');
  const begin = tagText(block, 'begin');
  for (const value of [when, end, begin]) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

function parseTimeFromText(text) {
  const value = String(text || '');
  const match = value.match(/(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)[-_T]?([0-2]\d)[-_:]?([0-5]\d)(?:[-_:]?([0-5]\d))?/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00'] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseHttpDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validateRadarFrames(frames, diagnostics) {
  const referenceMs = Date.parse(diagnostics.referenceTime || '') || Date.now();
  const maxPastMs = 36 * 60 * 60 * 1000;
  const maxFutureMs = 60 * 60 * 1000;
  const accepted = [];

  for (const frame of frames) {
    if (frame.source !== 'kml') {
      diagnostics.rejected.push({ href: frame.href, reason: 'non-kml-source' });
      continue;
    }
    const explicitMs = Date.parse(frame.time || '');
    if (Number.isFinite(explicitMs)) {
      if (explicitMs < referenceMs - maxPastMs || explicitMs > referenceMs + maxFutureMs) {
        diagnostics.rejected.push({ href: frame.href, rawTime: frame.time, reason: 'stale-or-future-explicit-time' });
        continue;
      }
    }
    accepted.push(frame);
  }

  diagnostics.validation = {
    inputCount: frames.length,
    acceptedCount: accepted.length,
    rejectedCount: diagnostics.rejected.length,
    referenceTime: new Date(referenceMs).toISOString(),
    freshnessWindowHours: 36
  };
  return accepted;
}

function normalizeRadarFrameTimes(frames, diagnostics) {
  if (!frames.length) return frames;
  const referenceMs = Date.parse(diagnostics.referenceTime || '') || Date.now();
  const ordered = [...frames].sort((a, b) => {
    const at = Date.parse(a.time || '');
    const bt = Date.parse(b.time || '');
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
    return a.href.localeCompare(b.href, undefined, { numeric: true });
  });

  const missing = ordered.filter(frame => !Number.isFinite(Date.parse(frame.time || '')));
  if (!missing.length) {
    diagnostics.timeRepair = { applied: false, reason: 'all-kml-times-valid' };
    return ordered;
  }

  const cadenceMs = RADAR_CADENCE_MINUTES * 60 * 1000;
  const latestMs = Math.floor(referenceMs / cadenceMs) * cadenceMs;
  ordered.forEach((frame, index) => {
    if (!Number.isFinite(Date.parse(frame.time || ''))) {
      frame.rawTime = frame.rawTime || null;
      frame.time = new Date(latestMs - (ordered.length - 1 - index) * cadenceMs).toISOString();
      frame.timeSource = 'missing-time-from-kml-document';
    }
  });
  diagnostics.timeRepair = {
    applied: true,
    reason: 'missing-times-only',
    repairedCount: missing.length,
    frameCount: ordered.length,
    referenceTime: new Date(referenceMs).toISOString(),
    cadenceMinutes: RADAR_CADENCE_MINUTES
  };
  return ordered;
}

function dedupeFrames(frames) {
  const map = new Map();
  for (const frame of frames) map.set(frame.href, frame);
  return [...map.values()].sort((a, b) => {
    const at = a.time ? Date.parse(a.time) : 0;
    const bt = b.time ? Date.parse(b.time) : 0;
    return at - bt || a.href.localeCompare(b.href);
  });
}

function resolveUrl(value, base) {
  return new URL(value.trim(), base).toString();
}

function isAllowedHkoUrl(value) {
  try {
    const url = new URL(value);
    return ['www.weather.gov.hk', 'www.hko.gov.hk', 'data.weather.gov.hk'].includes(url.hostname);
  } catch { return false; }
}

function isAllowedRadarImage(value) {
  try {
    const url = new URL(value);
    return isAllowedHkoUrl(value)
      && /\/wxinfo\/radars\//i.test(url.pathname)
      && /\.(?:png|gif|jpe?g|webp)$/i.test(url.pathname);
  } catch { return false; }
}

function decodeXml(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function encodeUrl(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeUrl(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// Nowcast CSV parsing and shared helpers
// ---------------------------------------------------------------------------

function parseNowcastCSV(text) {
  const rows = parseCSV(text.replace(/^\uFEFF/, ''))
    .map(row => row.map(cell => cell.trim()))
    .filter(row => row.some(Boolean));
  if (!rows.length) throw new Error('Nowcast CSV is empty');

  const official = parseOfficialNowcastRows(rows);
  if (official) return official;

  const frameMap = new Map();
  let issueTime = null;
  for (const row of rows) {
    const dateCells = row
      .map((cell, index) => ({ index, time: parseDateCell(cell) }))
      .filter(item => item.time);
    if (!dateCells.length) continue;

    const validDate = dateCells.length >= 2 ? dateCells[1] : dateCells[0];
    issueTime ||= dateCells[0].time;
    const coord = detectCoordinates(row);
    if (!coord) continue;

    const excluded = new Set([coord.latIndex, coord.lonIndex, ...dateCells.map(item => item.index)]);
    const numbers = row
      .map((cell, index) => ({ index, value: numberOrNull(cell) }))
      .filter(item => item.value !== null && !excluded.has(item.index));
    if (!numbers.length) continue;

    const rainfall = numbers[numbers.length - 1].value;
    if (rainfall < 0 || rainfall > 1000) continue;
    if (!frameMap.has(validDate.time)) frameMap.set(validDate.time, []);
    frameMap.get(validDate.time).push([coord.lat, coord.lon, rainfall]);
  }

  const frames = [...frameMap.entries()].map(([time, points]) => ({ time, points }));
  if (frames.length && frames.some(frame => frame.points.length > 20)) {
    return finalizeNowcast(frames, 'generic-long-rows', issueTime);
  }
  throw new Error('Unable to identify nowcast CSV structure');
}

function parseOfficialNowcastRows(rows) {
  const frameMap = new Map();
  const issueTimes = new Map();
  let validRows = 0;

  for (const row of rows) {
    if (row.length < 5) continue;
    const issue = parseDateCell(row[0]);
    const valid = parseDateCell(row[1]);
    const lat = numberOrNull(row[2]);
    const lon = numberOrNull(row[3]);
    const rainfall = numberOrNull(row[4]);
    if (!issue || !valid || lat === null || lon === null || rainfall === null) continue;
    if (lat < 18 || lat > 26 || lon < 110 || lon > 118 || rainfall < 0 || rainfall > 1000) continue;

    validRows++;
    issueTimes.set(issue, (issueTimes.get(issue) || 0) + 1);
    if (!frameMap.has(valid)) frameMap.set(valid, []);
    frameMap.get(valid).push([lat, lon, rainfall]);
  }

  if (validRows < 100 || frameMap.size < 2) return null;
  const issueTime = [...issueTimes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const frames = [...frameMap.entries()].map(([time, points]) => ({ time, points }));
  return finalizeNowcast(frames, 'hko-official-long-5-column', issueTime);
}

function finalizeNowcast(frames, parser, issueTime = null) {
  frames.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const baseTime = issueTime || frames[0]?.time || null;
  for (const frame of frames) {
    frame.leadMinutes = baseTime ? Math.round((Date.parse(frame.time) - Date.parse(baseTime)) / 60000) : null;
  }

  const sample = frames.find(frame => frame.points.length)?.points || [];
  const lats = [...new Set(sample.map(point => point[0]))].sort((a, b) => a - b);
  const lons = [...new Set(sample.map(point => point[1]))].sort((a, b) => a - b);
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const frame of frames) {
    for (const point of frame.points) {
      if (point[0] < minLat) minLat = point[0];
      if (point[0] > maxLat) maxLat = point[0];
      if (point[1] < minLon) minLon = point[1];
      if (point[1] > maxLon) maxLon = point[1];
    }
  }

  return {
    parser,
    issueTime: baseTime,
    baseTime,
    unit: 'mm / 30 min',
    grid: {
      stepLat: minimumPositiveStep(lats),
      stepLon: minimumPositiveStep(lons),
      minLat: Number.isFinite(minLat) ? minLat : null,
      maxLat: Number.isFinite(maxLat) ? maxLat : null,
      minLon: Number.isFinite(minLon) ? minLon : null,
      maxLon: Number.isFinite(maxLon) ? maxLon : null
    },
    axes: { lats, lons },
    frames
  };
}

function minimumPositiveStep(values) {
  let min = Infinity;
  for (let i = 1; i < values.length; i++) {
    const diff = Math.abs(values[i] - values[i - 1]);
    if (diff > 1e-7 && diff < min) min = diff;
  }
  return Number.isFinite(min) ? Number(min.toFixed(6)) : null;
}

function detectCoordinates(row) {
  const numeric = row
    .map((cell, index) => ({ index, value: numberOrNull(cell) }))
    .filter(item => item.value !== null);
  const lat = numeric.find(item => item.value >= 20 && item.value <= 24);
  const lon = numeric.find(item => item.value >= 112 && item.value <= 116);
  if (!lat || !lon || lat.index === lon.index) return null;
  return { lat: lat.value, lon: lon.value, latIndex: lat.index, lonIndex: lon.index };
}

function parseDateCell(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const match = digits.match(/(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00'] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const cleaned = String(value).replace(/[^0-9+\-.eE]/g, '');
  if (!cleaned || !/[0-9]/.test(cleaned)) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function haversine(lat1, lon1, lat2, lon2) {
  const radius = 6371;
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const q = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(q));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
