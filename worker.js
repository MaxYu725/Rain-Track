/**
 * Hong Kong Point Rainfall Forecast Worker v2.5.0
 * Cloudflare Worker (module syntax)
 *
 * Routes:
 *   GET /health
 *   GET /api/rain/point?lat=22.3023&lon=114.1746&radiusKm=2
 *   GET /api/rain/nowcast
 *   GET /probe/rain
 *   GET /probe/swirls
 *   GET /api/rain/swirls/frame?frame=0..15
 *   GET /api/capabilities
 *   GET /api/radar/frames?range=64|256&height=2|3&mode=live|test
 *   GET /api/radar/image?id=<base64url>
 *   GET /api/radar/test-image?range=64|256&frame=0..11
 *   GET /probe/radar?range=64|256&height=2|3&mode=live|test
 */

const VERSION = '2.5.0';
const HKO_NOWCAST = 'https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast_tc.csv';
const CACHE_TTL_SECONDS = 600;
const RADAR_CACHE_TTL_SECONDS = 60;
const RADAR_IMAGE_CACHE_TTL_SECONDS = 86400;
const RADAR_CADENCE_MINUTES = 6;
const RADAR_MAX_FRAMES = 30;
const RADAR_LIVE_MAX_AGE_MINUTES = 30;
const RADAR_LIVE_MAX_FUTURE_MINUTES = 10;
const RADAR_LIVE_HISTORY_MINUTES = 150;

const RADAR = Object.freeze({
  64: {
    kmlRoot: 'https://www.hko.gov.hk/wxinfo/radars/R4_GIS_rad_064/R4_GIS_server_Radar_064.kml',
    product: '64 km range, 3 km height, GIS overlay',
    fallbackBounds: { north: 22.87770, south: 21.72659, east: 114.79378, west: 113.54956 }
  },
  256: {
    kmlRoot: 'https://www.hko.gov.hk/wxinfo/radars/R4_GIS_rad_256/R4_GIS_server_Radar_256.kml',
    product: '256 km range, 3 km height, GIS overlay',
    fallbackBounds: { north: 24.58614, south: 19.98259, east: 116.66013, west: 111.68321 }
  }
});

const RADAR_2KM_64 = Object.freeze({
  kmlRoot: 'https://www.hko.gov.hk/wxinfo/radars/radar_064_kml/Radar_064k.kml',
  product: '64 km range, 2 km height, GIS overlay',
  fallbackBounds: { north: 22.87890, south: 21.72777, east: 114.79378, west: 113.54956 }
});

const RADAR_CONTRACT = Object.freeze({
  version: '1.0',
  enabled: true,
  endpoint: '/api/radar/frames?range=64|256&height=2|3&mode=live|test',
  imageEndpoint: '/api/radar/image?id=...',
  testImageEndpoint: '/api/radar/test-image?range=64|256&frame=0..11',
  rangesKm: [64, 256],
  heightsKmByRange: { 64: [2, 3], 256: [3] },
  defaultHeightKm: 3,
  modes: ['live', 'test'],
  cadenceMinutes: RADAR_CADENCE_MINUTES,
  maxFrames: RADAR_MAX_FRAMES,
  response: {
    contractVersion: '1.0',
    rangeKm: '64|256',
    heightKm: '2|3',
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
            '/probe/swirls',
            '/api/rain/swirls/frame?frame=0',
            '/api/capabilities',
            '/api/radar/frames?range=64&height=3&mode=live',
            '/api/radar/image?id=...',
            '/api/radar/test-image?range=64&frame=0',
            '/probe/radar?range=64&height=3&mode=live'
          ],
          capabilities: {
            pointForecast: true,
            nowcastGrid: true,
            swirlsFrames: true,
            swirls: SWIRLS_PUBLIC_CONTRACT,
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
        capabilities: {
          pointForecast: true,
          nowcastGrid: true,
          swirlsFrames: true,
          swirls: SWIRLS_PUBLIC_CONTRACT,
          radarFrames: true,
          radar: RADAR_CONTRACT
        },
        swirlsContract: SWIRLS_PUBLIC_CONTRACT,
        radarContract: RADAR_CONTRACT
      }, 200, { 'Cache-Control': 'public, max-age=300' });

      if (url.pathname === '/api/rain/point') return await handlePointForecast(url);
      if (url.pathname === '/api/rain/nowcast') return await handleNowcast(false);
      if (url.pathname === '/probe/rain') return await handleNowcast(true);
      if (url.pathname === '/probe/swirls') return await handleSwirlsProbe();
      if (url.pathname === '/api/rain/swirls/frame') return await handleSwirlsFrame(url);

      if (url.pathname === '/api/radar/frames') {
        const range = normalizeRange(url.searchParams.get('range'));
        const height = normalizeRadarHeight(url.searchParams.get('height'), range);
        return await handleRadarFrames(range, height, normalizeRadarMode(url.searchParams.get('mode')), false);
      }
      if (url.pathname === '/probe/radar') {
        const range = normalizeRange(url.searchParams.get('range'));
        const height = normalizeRadarHeight(url.searchParams.get('height'), range);
        return await handleRadarFrames(range, height, normalizeRadarMode(url.searchParams.get('mode')), true);
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

function normalizeRadarHeight(value, range) {
  return range === 64 && String(value) === '2' ? 2 : 3;
}

function radarSource(range, height = 3) {
  return range === 64 && height === 2 ? RADAR_2KM_64 : RADAR[range];
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
        'User-Agent': 'Mozilla/5.0 (compatible; HK-Point-Rain-Worker/' + VERSION + ')',
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
// Current HKO R4 GIS radar KML, image proxy and deterministic test frames
// ---------------------------------------------------------------------------

async function handleRadarFrames(range, height, mode, probe) {
  if (mode === 'test') return handleTestRadarFrames(range, height, probe);

  const source = radarSource(range, height);
  const diagnostics = {
    attempts: [], documents: [], errors: [], rejected: [],
    policy: `Current HKO R4 GIS KML; latest frame <= ${RADAR_LIVE_MAX_AGE_MINUTES} min old; history <= ${RADAR_LIVE_HISTORY_MINUTES} min`,
    mode: 'live',
    rangeKm: range,
    heightKm: height,
    product: source.product,
    transparentOverlay: true
  };
  let frames = [];
  try {
    frames = await collectKmlFrames(source.kmlRoot, source, diagnostics);
  } catch (error) {
    diagnostics.errors.push(safeError(error));
  }

  frames = validateCurrentRadarFrames(dedupeFrames(frames), diagnostics).slice(-RADAR_MAX_FRAMES);
  const issueTime = frames.at(-1)?.time || null;
  const payload = {
    ok: frames.length > 0,
    version: VERSION,
    contractVersion: RADAR_CONTRACT.version,
    rangeKm: range,
    heightKm: height,
    mode: 'live',
    source: 'Hong Kong Observatory current GIS radar KML',
    root: source.kmlRoot,
    product: source.product,
    renderMode: 'transparent-georeferenced-overlay',
    generatedAt: new Date().toISOString(),
    issueTime,
    cadenceMinutes: RADAR_CADENCE_MINUTES,
    frameCount: frames.length,
    error: frames.length ? null : 'HKO live GIS radar source is stale or unavailable',
    frames: frames.map((frame, index) => ({
      id: encodeUrl(frame.href),
      index,
      time: frame.time,
      name: frame.name || `Radar ${index + 1}`,
      bounds: frame.bounds || source.fallbackBounds,
      source: 'hko-current-gis-kml',
      timeSource: frame.timeSource || null,
      rawTime: probe ? (frame.rawTime || null) : undefined,
      imageUrl: `/api/radar/image?id=${encodeURIComponent(encodeUrl(frame.href))}`
    }))
  };

  if (probe) {
    payload.diagnostics = diagnostics;
    return json(payload, 200, { 'Cache-Control': 'no-store' });
  }

  return json(payload, frames.length ? 200 : 502, { 'Cache-Control': `public, max-age=${RADAR_CACHE_TTL_SECONDS}` });
}

function validateCurrentRadarFrames(frames, diagnostics) {
  const nowMs = Date.now();
  const maxLatestPastMs = RADAR_LIVE_MAX_AGE_MINUTES * 60 * 1000;
  const maxHistoryMs = RADAR_LIVE_HISTORY_MINUTES * 60 * 1000;
  const maxFutureMs = RADAR_LIVE_MAX_FUTURE_MINUTES * 60 * 1000;
  const timed = frames
    .map(frame => ({ frame, ms: Date.parse(frame.time || '') }))
    .filter(item => Number.isFinite(item.ms))
    .sort((a, b) => a.ms - b.ms);

  const latestMs = timed.at(-1)?.ms;
  const latestFresh = Number.isFinite(latestMs)
    && latestMs >= nowMs - maxLatestPastMs
    && latestMs <= nowMs + maxFutureMs;

  diagnostics.sourceFreshness = {
    latestFrameTime: Number.isFinite(latestMs) ? new Date(latestMs).toISOString() : null,
    latestAgeMinutes: Number.isFinite(latestMs) ? Math.round((nowMs - latestMs) / 60000) : null,
    latestFresh,
    liveMaxAgeMinutes: RADAR_LIVE_MAX_AGE_MINUTES,
    historyMaxAgeMinutes: RADAR_LIVE_HISTORY_MINUTES,
    liveMaxFutureMinutes: RADAR_LIVE_MAX_FUTURE_MINUTES
  };

  if (!latestFresh) {
    for (const { frame, ms } of timed) {
      diagnostics.rejected.push({
        href: frame.href,
        rawTime: frame.time,
        ageMinutes: Math.round((nowMs - ms) / 60000),
        reason: 'stale-live-feed-latest-frame'
      });
    }
    diagnostics.validation = {
      inputCount: frames.length,
      acceptedCount: 0,
      rejectedCount: diagnostics.rejected.length,
      referenceTime: new Date(nowMs).toISOString(),
      latestFrameTime: Number.isFinite(latestMs) ? new Date(latestMs).toISOString() : null
    };
    return [];
  }

  const accepted = [];
  for (const { frame, ms } of timed) {
    if (ms < nowMs - maxHistoryMs || ms > nowMs + maxFutureMs) {
      diagnostics.rejected.push({
        href: frame.href,
        rawTime: frame.time,
        ageMinutes: Math.round((nowMs - ms) / 60000),
        reason: 'outside-live-animation-window'
      });
      continue;
    }
    accepted.push(frame);
  }

  diagnostics.validation = {
    inputCount: frames.length,
    acceptedCount: accepted.length,
    rejectedCount: diagnostics.rejected.length,
    referenceTime: new Date(nowMs).toISOString(),
    latestFrameTime: new Date(latestMs).toISOString(),
    freshnessWindowMinutes: RADAR_LIVE_MAX_AGE_MINUTES,
    historyWindowMinutes: RADAR_LIVE_HISTORY_MINUTES
  };
  return accepted;
}

function handleTestRadarFrames(range, height, probe) {
  const bounds = radarSource(range, height).fallbackBounds;
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
    heightKm: height,
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

async function collectKmlFrames(rootUrl, source, diagnostics) {
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
      const bounds = parseBounds(block) || source.fallbackBounds;
      const name = decodeXml(tagText(block, 'name') || '');
      const kmlTime = parseKmlTime(block);
      const textTime = parseTimeFromText(`${name} ${href}`);
      // R4 GIS KML labels its timestamps as HKT while the <when> value ends in Z.
      // The filename/name carries the unambiguous Hong Kong local radar time.
      const time = textTime || kmlTime;
      frames.push({ href, bounds, name, time, rawTime: time, timeSource: textTime ? 'filename-hkt' : (kmlTime ? 'kml' : null), source: 'kml' });
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
  const nowMs = Date.now();
  const sourceReferenceMs = Date.parse(diagnostics.referenceTime || '');
  const maxPastMs = RADAR_LIVE_MAX_AGE_MINUTES * 60 * 1000;
  const maxFutureMs = RADAR_LIVE_MAX_FUTURE_MINUTES * 60 * 1000;
  const sourceReferenceFresh = Number.isFinite(sourceReferenceMs)
    && sourceReferenceMs >= nowMs - maxPastMs
    && sourceReferenceMs <= nowMs + maxFutureMs;
  const accepted = [];

  for (const frame of frames) {
    if (frame.source !== 'kml') {
      diagnostics.rejected.push({ href: frame.href, reason: 'non-kml-source' });
      continue;
    }

    const explicitMs = Date.parse(frame.time || '');
    if (Number.isFinite(explicitMs)) {
      if (explicitMs < nowMs - maxPastMs || explicitMs > nowMs + maxFutureMs) {
        diagnostics.rejected.push({
          href: frame.href,
          rawTime: frame.time,
          ageMinutes: Math.round((nowMs - explicitMs) / 60000),
          reason: 'stale-or-future-live-frame'
        });
        continue;
      }
    } else if (!sourceReferenceFresh) {
      diagnostics.rejected.push({
        href: frame.href,
        rawTime: frame.time || null,
        reason: 'missing-frame-time-with-stale-source-document'
      });
      continue;
    }

    accepted.push(frame);
  }

  diagnostics.sourceFreshness = {
    sourceReferenceTime: Number.isFinite(sourceReferenceMs) ? new Date(sourceReferenceMs).toISOString() : null,
    sourceReferenceAgeMinutes: Number.isFinite(sourceReferenceMs)
      ? Math.round((nowMs - sourceReferenceMs) / 60000)
      : null,
    sourceReferenceFresh,
    liveMaxAgeMinutes: RADAR_LIVE_MAX_AGE_MINUTES,
    liveMaxFutureMinutes: RADAR_LIVE_MAX_FUTURE_MINUTES
  };
  diagnostics.validation = {
    inputCount: frames.length,
    acceptedCount: accepted.length,
    rejectedCount: diagnostics.rejected.length,
    referenceTime: new Date(nowMs).toISOString(),
    sourceReferenceTime: Number.isFinite(sourceReferenceMs) ? new Date(sourceReferenceMs).toISOString() : null,
    freshnessWindowMinutes: RADAR_LIVE_MAX_AGE_MINUTES
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

/* RAIN_TRACK_SWIRLS_INLINE_BEGIN
 * Phase 3B2 production inline adapter. Keep worker.js directly deployable.
 * Contract source of truth remains swirls-data.js / swirls-worker-runtime.js.
 */
const SWIRLS_RAW_CONTRACT = Object.freeze({
  version: '1.0',
  indexUrl: 'https://maps.weather.gov.hk/ocf/dat/nc/nc.rf.index.2.txt',
  assetBaseUrl: 'https://maps.weather.gov.hk/ocf/dat/nc/',
  frameCount: 16,
  cadenceMinutes: 6,
  accumulationMinutes: 30,
  firstLeadMinutes: 30,
  lastLeadMinutes: 120,
  rows: 121,
  cols: 121,
  cellCount: 121 * 121,
  unit: 'mm / 30 min',
  orientation: 'row-major-north-to-south-west-to-east',
  coverage: {
    minLat: 21.328,
    maxLat: 23.487,
    minLon: 112.956,
    maxLon: 115.291
  }
});

const CADENCE_MINUTE_RE = '(?:00|06|12|18|24|30|36|42|48|54)';
const INDEX_PNG = new RegExp(`^ncrf_minute(${CADENCE_MINUTE_RE})_(\\d+)\\.png$`);
const INDEX_MDL = new RegExp(`^ncrf_minute(${CADENCE_MINUTE_RE})_(\\d+)\\.af\\.mdl$`);
const HEADER_RE = /SL-RF\s+DMO\s+(20\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})/;
const EPSILON = 1e-6;

function parseSwirlsIndex(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (!lines.length) throw new Error('SWIRLS index is empty');

  const frames = lines.map((line, lineIndex) => {
    const parts = line.split(',').map(part => part.trim());
    if (parts.length !== 3) throw new Error(`SWIRLS index line ${lineIndex + 1} is malformed`);

    const [validToken, pngFile, mdlFile] = parts;
    const validTime = parseHktCompact(validToken);
    if (!validTime) throw new Error(`SWIRLS index line ${lineIndex + 1} has invalid valid time`);

    const pngMatch = pngFile.match(INDEX_PNG);
    const mdlMatch = mdlFile.match(INDEX_MDL);
    if (!pngMatch || !mdlMatch) throw new Error(`SWIRLS index line ${lineIndex + 1} has unexpected asset names`);

    const pngMinute = pngMatch[1];
    const mdlMinute = mdlMatch[1];
    const pngIndex = Number(pngMatch[2]);
    const mdlIndex = Number(mdlMatch[2]);
    if (pngMinute !== mdlMinute) throw new Error(`SWIRLS index line ${lineIndex + 1} asset minutes disagree`);
    if (pngIndex !== mdlIndex) throw new Error(`SWIRLS index line ${lineIndex + 1} asset indices disagree`);

    return {
      frameIndex: mdlIndex,
      assetMinute: mdlMinute,
      validTime,
      pngFile,
      mdlFile,
      pngUrl: new URL(pngFile, SWIRLS_RAW_CONTRACT.assetBaseUrl).toString(),
      mdlUrl: new URL(mdlFile, SWIRLS_RAW_CONTRACT.assetBaseUrl).toString()
    };
  }).sort((a, b) => a.frameIndex - b.frameIndex);

  validateIndexFrames(frames);

  const firstValidMs = Date.parse(frames[0].validTime);
  const inferredRunTime = new Date(firstValidMs - SWIRLS_RAW_CONTRACT.accumulationMinutes * 60_000).toISOString();
  const inferredRunMinute = String(new Date(inferredRunTime).getUTCMinutes()).padStart(2, '0');
  const assetMinute = frames[0].assetMinute;
  if (assetMinute !== inferredRunMinute) {
    throw new Error(`SWIRLS index asset minute ${assetMinute} does not match inferred run minute ${inferredRunMinute}`);
  }

  return {
    contractVersion: SWIRLS_RAW_CONTRACT.version,
    parser: 'hko-swirls-index-v1',
    source: SWIRLS_RAW_CONTRACT.indexUrl,
    cadenceMinutes: SWIRLS_RAW_CONTRACT.cadenceMinutes,
    accumulationMinutes: SWIRLS_RAW_CONTRACT.accumulationMinutes,
    unit: SWIRLS_RAW_CONTRACT.unit,
    assetMinute,
    inferredRunTime,
    frameCount: frames.length,
    frames: frames.map(frame => ({
      ...frame,
      leadMinutes: Math.round((Date.parse(frame.validTime) - Date.parse(inferredRunTime)) / 60_000),
      windowStart: swirlsSubtractMinutesIso(frame.validTime, SWIRLS_RAW_CONTRACT.accumulationMinutes),
      windowEnd: frame.validTime
    }))
  };
}

function parseSwirlsMdl(text) {
  const source = unwrapBrowserSavedHtml(String(text || '')).replace(/\r/g, '');
  const header = source.match(HEADER_RE);
  if (!header) throw new Error('SWIRLS MDL header is missing or invalid');

  const runTime = parseHktParts(header[1], header[2], header[3], header[4], header[5]);
  if (!runTime) throw new Error('SWIRLS MDL run time is invalid');

  const points = [];
  let invalidPointCount = 0;
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.includes('SL-RF')) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 3) continue;

    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    const rainfall = Number(parts[2]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(rainfall)) {
      invalidPointCount += 1;
      continue;
    }
    if (lat < 18 || lat > 26 || lon < 110 || lon > 118 || rainfall < 0 || rainfall > 1000) {
      invalidPointCount += 1;
      continue;
    }
    points.push({ lat, lon, rainfall });
  }

  if (invalidPointCount) throw new Error(`SWIRLS MDL contains ${invalidPointCount} invalid grid point(s)`);
  if (!points.length) throw new Error('SWIRLS MDL contains no grid points');

  const latAsc = uniqueSorted(points.map(point => point.lat));
  const lonAsc = uniqueSorted(points.map(point => point.lon));
  const latDesc = [...latAsc].reverse();
  const expectedCellCount = latAsc.length * lonAsc.length;
  const coordSet = new Set();
  let duplicatePointCount = 0;

  for (const point of points) {
    const key = swirlsCoordKey(point.lat, point.lon);
    if (coordSet.has(key)) duplicatePointCount += 1;
    coordSet.add(key);
  }

  const completeGrid = latAsc.length === SWIRLS_RAW_CONTRACT.rows
    && lonAsc.length === SWIRLS_RAW_CONTRACT.cols
    && points.length === SWIRLS_RAW_CONTRACT.cellCount
    && expectedCellCount === SWIRLS_RAW_CONTRACT.cellCount
    && coordSet.size === SWIRLS_RAW_CONTRACT.cellCount
    && duplicatePointCount === 0;

  if (!completeGrid) {
    throw new Error(`SWIRLS MDL grid incomplete: ${latAsc.length}x${lonAsc.length}, ${points.length} points, ${duplicatePointCount} duplicate(s)`);
  }

  const orientationValid = validateSourceOrientation(points, latDesc, lonAsc);
  if (!orientationValid) throw new Error('SWIRLS MDL grid orientation is unexpected');

  const latEdges = axisEdgeBounds(latAsc);
  const lonEdges = axisEdgeBounds(lonAsc);
  const values = points.map(point => point.rainfall);

  return {
    contractVersion: SWIRLS_RAW_CONTRACT.version,
    parser: 'hko-swirls-af-mdl-v1',
    runTime,
    unit: SWIRLS_RAW_CONTRACT.unit,
    grid: {
      rows: latDesc.length,
      cols: lonAsc.length,
      cellCount: points.length,
      orientation: SWIRLS_RAW_CONTRACT.orientation,
      latitudes: latDesc,
      longitudes: lonAsc,
      stepLat: averageAxisStep(latAsc),
      stepLon: averageAxisStep(lonAsc),
      bounds: {
        south: latEdges.min,
        north: latEdges.max,
        west: lonEdges.min,
        east: lonEdges.max
      }
    },
    values,
    validation: {
      expectedCellCount: SWIRLS_RAW_CONTRACT.cellCount,
      actualCellCount: points.length,
      uniqueCellCount: coordSet.size,
      duplicatePointCount,
      completeGrid,
      orientationValid,
      ready: completeGrid && orientationValid
    }
  };
}

function bindSwirlsMdlFrame(indexData, frameIndex, mdlText) {
  if (!indexData || !Array.isArray(indexData.frames)) throw new Error('SWIRLS index data is required');
  const frame = indexData.frames.find(item => item.frameIndex === Number(frameIndex));
  if (!frame) throw new Error(`SWIRLS frame ${frameIndex} is not present in the index`);

  const mdl = parseSwirlsMdl(mdlText);
  if (mdl.runTime !== indexData.inferredRunTime) {
    throw new Error(`SWIRLS run time mismatch: index infers ${indexData.inferredRunTime}, MDL reports ${mdl.runTime}`);
  }

  return {
    contractVersion: SWIRLS_RAW_CONTRACT.version,
    frameIndex: frame.frameIndex,
    runTime: mdl.runTime,
    validTime: frame.validTime,
    leadMinutes: frame.leadMinutes,
    windowStart: frame.windowStart,
    windowEnd: frame.windowEnd,
    unit: mdl.unit,
    source: {
      indexUrl: indexData.source,
      mdlUrl: frame.mdlUrl,
      pngUrl: frame.pngUrl
    },
    grid: mdl.grid,
    values: mdl.values,
    validation: {
      ...mdl.validation,
      runTimeMatchesIndex: true
    }
  };
}

function validateIndexFrames(frames) {
  if (frames.length !== SWIRLS_RAW_CONTRACT.frameCount) {
    throw new Error(`SWIRLS index expected ${SWIRLS_RAW_CONTRACT.frameCount} frames, received ${frames.length}`);
  }

  const seen = new Set();
  const assetMinute = frames[0]?.assetMinute || null;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame.frameIndex !== index) throw new Error(`SWIRLS index is missing or reorders frame ${index}`);
    if (frame.assetMinute !== assetMinute) throw new Error(`SWIRLS index asset minute changes at frame ${index}`);
    if (seen.has(frame.validTime)) throw new Error('SWIRLS index contains duplicate valid times');
    seen.add(frame.validTime);

    if (index > 0) {
      const gap = Math.round((Date.parse(frame.validTime) - Date.parse(frames[index - 1].validTime)) / 60_000);
      if (gap !== SWIRLS_RAW_CONTRACT.cadenceMinutes) {
        throw new Error(`SWIRLS index cadence mismatch at frame ${index}: ${gap} minutes`);
      }
    }
  }

  const horizon = Math.round((Date.parse(frames.at(-1).validTime) - Date.parse(frames[0].validTime)) / 60_000)
    + SWIRLS_RAW_CONTRACT.firstLeadMinutes;
  if (horizon !== SWIRLS_RAW_CONTRACT.lastLeadMinutes) {
    throw new Error(`SWIRLS index horizon mismatch: ${horizon} minutes`);
  }
}

function validateSourceOrientation(points, latDesc, lonAsc) {
  if (points.length !== latDesc.length * lonAsc.length) return false;
  let offset = 0;
  for (const lat of latDesc) {
    for (const lon of lonAsc) {
      const point = points[offset++];
      if (Math.abs(point.lat - lat) > EPSILON || Math.abs(point.lon - lon) > EPSILON) return false;
    }
  }
  return true;
}

function uniqueSorted(values) {
  return [...new Set(values.map(value => Number(value.toFixed(6))))].sort((a, b) => a - b);
}

function averageAxisStep(axis) {
  if (!Array.isArray(axis) || axis.length < 2) return null;
  return Number(((axis.at(-1) - axis[0]) / (axis.length - 1)).toFixed(6));
}

function axisEdgeBounds(axis) {
  if (!Array.isArray(axis) || !axis.length) return { min: null, max: null };
  if (axis.length === 1) return { min: axis[0], max: axis[0] };
  const firstGap = axis[1] - axis[0];
  const lastGap = axis.at(-1) - axis.at(-2);
  return {
    min: Number((axis[0] - firstGap / 2).toFixed(6)),
    max: Number((axis.at(-1) + lastGap / 2).toFixed(6))
  };
}

function swirlsCoordKey(lat, lon) {
  return `${Number(lat).toFixed(6)}|${Number(lon).toFixed(6)}`;
}

function parseHktCompact(value) {
  const match = String(value || '').match(/^(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  return parseHktParts(match[1], match[2], match[3], match[4], match[5]);
}

function parseHktParts(year, month, day, hour, minute) {
  const iso = `${year}-${month}-${day}T${hour}:${minute}:00+08:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function swirlsSubtractMinutesIso(value, minutes) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time - minutes * 60_000).toISOString();
}

function unwrapBrowserSavedHtml(value) {
  if (!/<html|<body|<!--\s*saved from url=/i.test(value)) return value;
  return value
    .replace(/<!--[^]*?-->/g, '\n')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const SWIRLS_FETCH_POLICY = Object.freeze({
  indexTtlSeconds: 45,
  mdlTtlSeconds: 45,
  timeoutMs: 12_000,
  retryOnRollover: true
});

function createSwirlsRuntime({
  fetchText,
  policy = SWIRLS_FETCH_POLICY
} = {}) {
  if (typeof fetchText !== 'function') {
    throw new Error('SWIRLS runtime requires a fetchText function');
  }

  async function loadIndex({ bypassCache = false } = {}) {
    const result = await fetchText(SWIRLS_RAW_CONTRACT.indexUrl, {
      kind: 'index',
      ttlSeconds: policy.indexTtlSeconds,
      timeoutMs: policy.timeoutMs,
      bypassCache
    });
    const text = normalizeFetchResult(result, 'SWIRLS index');
    const parsed = parseSwirlsIndex(text.body);
    return {
      ...parsed,
      sourceBytes: text.bytes,
      sourceUpdatedAt: text.updatedAt,
      cacheStatus: text.cacheStatus
    };
  }

  async function loadFrame(frameIndex, { bypassCache = false } = {}) {
    const normalizedIndex = normalizeFrameIndex(frameIndex);
    let indexData = await loadIndex({ bypassCache });

    try {
      return await loadBoundFrame(indexData, normalizedIndex, { bypassCache });
    } catch (error) {
      if (!policy.retryOnRollover || bypassCache || !isRolloverMismatch(error)) throw error;

      // HKO reuses the same asset filenames for every SWIRLS run. Around an
      // upstream publication rollover, index and MDL can briefly belong to
      // different runs. Refresh both once, then fail closed if still mixed.
      indexData = await loadIndex({ bypassCache: true });
      return await loadBoundFrame(indexData, normalizedIndex, { bypassCache: true });
    }
  }

  async function loadBoundFrame(indexData, frameIndex, { bypassCache = false } = {}) {
    const descriptor = indexData.frames.find(frame => frame.frameIndex === frameIndex);
    if (!descriptor) throw new Error(`SWIRLS frame ${frameIndex} is not present in the current index`);

    const result = await fetchText(descriptor.mdlUrl, {
      kind: 'mdl',
      frameIndex,
      runTime: indexData.inferredRunTime,
      ttlSeconds: policy.mdlTtlSeconds,
      timeoutMs: policy.timeoutMs,
      bypassCache
    });
    const text = normalizeFetchResult(result, `SWIRLS frame ${frameIndex}`);
    const frame = bindSwirlsMdlFrame(indexData, frameIndex, text.body);

    return {
      ...frame,
      sourceBytes: text.bytes,
      sourceUpdatedAt: text.updatedAt,
      cacheStatus: text.cacheStatus,
      index: summarizeIndex(indexData)
    };
  }

  async function probe({ frameIndex = 0, includeLastFrame = false, bypassCache = false } = {}) {
    const first = await loadFrame(frameIndex, { bypassCache });
    const last = includeLastFrame && frameIndex !== SWIRLS_RAW_CONTRACT.frameCount - 1
      ? await loadFrame(SWIRLS_RAW_CONTRACT.frameCount - 1, { bypassCache })
      : null;

    return {
      ok: true,
      contractVersion: SWIRLS_RAW_CONTRACT.version,
      source: SWIRLS_RAW_CONTRACT.indexUrl,
      runTime: first.runTime,
      frameCount: first.index.frameCount,
      cadenceMinutes: first.index.cadenceMinutes,
      accumulationMinutes: SWIRLS_RAW_CONTRACT.accumulationMinutes,
      unit: first.unit,
      firstValidTime: first.index.firstValidTime,
      lastValidTime: first.index.lastValidTime,
      sampledFrames: [first, last].filter(Boolean).map(summarizeFrame),
      generatedAt: new Date().toISOString()
    };
  }

  return Object.freeze({ loadIndex, loadFrame, probe });
}

function createNetworkFetchText({
  fetchImpl = globalThis.fetch,
  userAgent = 'Rain-Track-SWIRLS/1.0'
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');

  return async function fetchText(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), Number(options.timeoutMs) || SWIRLS_FETCH_POLICY.timeoutMs);
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        cache: options.bypassCache ? 'no-store' : 'no-cache',
        headers: {
          Accept: 'text/plain,*/*',
          'User-Agent': userAgent
        },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`SWIRLS upstream HTTP ${response.status}`);
      const body = await response.text();
      return {
        body,
        bytes: new TextEncoder().encode(body).byteLength,
        updatedAt: response.headers.get('last-modified'),
        cacheStatus: response.headers.get('cf-cache-status') || null
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

function summarizeIndex(indexData) {
  const frames = Array.isArray(indexData?.frames) ? indexData.frames : [];
  return {
    contractVersion: indexData?.contractVersion || SWIRLS_RAW_CONTRACT.version,
    runTime: indexData?.inferredRunTime || null,
    frameCount: frames.length,
    cadenceMinutes: indexData?.cadenceMinutes ?? SWIRLS_RAW_CONTRACT.cadenceMinutes,
    accumulationMinutes: indexData?.accumulationMinutes ?? SWIRLS_RAW_CONTRACT.accumulationMinutes,
    firstValidTime: frames[0]?.validTime || null,
    lastValidTime: frames.at(-1)?.validTime || null,
    sourceBytes: Number.isFinite(indexData?.sourceBytes) ? indexData.sourceBytes : null,
    sourceUpdatedAt: indexData?.sourceUpdatedAt || null,
    cacheStatus: indexData?.cacheStatus || null
  };
}

function summarizeFrame(frame) {
  const values = Array.isArray(frame?.values) ? frame.values : [];
  let minMm = Infinity;
  let maxMm = -Infinity;
  let wetCellCount = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < minMm) minMm = value;
    if (value > maxMm) maxMm = value;
    if (value >= 0.05) wetCellCount += 1;
  }

  return {
    frameIndex: frame?.frameIndex ?? null,
    runTime: frame?.runTime || null,
    validTime: frame?.validTime || null,
    leadMinutes: frame?.leadMinutes ?? null,
    windowStart: frame?.windowStart || null,
    windowEnd: frame?.windowEnd || null,
    unit: frame?.unit || SWIRLS_RAW_CONTRACT.unit,
    grid: frame?.grid ? {
      rows: frame.grid.rows,
      cols: frame.grid.cols,
      cellCount: frame.grid.cellCount,
      orientation: frame.grid.orientation,
      bounds: frame.grid.bounds
    } : null,
    minMm: Number.isFinite(minMm) ? minMm : null,
    maxMm: Number.isFinite(maxMm) ? maxMm : null,
    wetCellCount,
    sourceBytes: Number.isFinite(frame?.sourceBytes) ? frame.sourceBytes : null,
    sourceUpdatedAt: frame?.sourceUpdatedAt || null,
    cacheStatus: frame?.cacheStatus || null,
    ready: frame?.validation?.ready === true && frame?.validation?.runTimeMatchesIndex === true
  };
}

function normalizeFrameIndex(value) {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= SWIRLS_RAW_CONTRACT.frameCount) {
    throw new Error(`SWIRLS frame index must be 0..${SWIRLS_RAW_CONTRACT.frameCount - 1}`);
  }
  return index;
}

function normalizeFetchResult(result, label) {
  if (typeof result === 'string') {
    return {
      body: result,
      bytes: new TextEncoder().encode(result).byteLength,
      updatedAt: null,
      cacheStatus: null
    };
  }
  if (!result || typeof result.body !== 'string') throw new Error(`${label} fetch returned no text body`);
  return {
    body: result.body,
    bytes: Number.isFinite(result.bytes) ? result.bytes : new TextEncoder().encode(result.body).byteLength,
    updatedAt: result.updatedAt || null,
    cacheStatus: result.cacheStatus || null
  };
}

function isRolloverMismatch(error) {
  return error instanceof Error && /SWIRLS run time mismatch/.test(error.message);
}

const SWIRLS_PUBLIC_CONTRACT = Object.freeze({
  version: SWIRLS_RAW_CONTRACT.version,
  enabled: true,
  probeEndpoint: '/probe/swirls',
  frameEndpoint: '/api/rain/swirls/frame?frame=0..15',
  frameCount: SWIRLS_RAW_CONTRACT.frameCount,
  cadenceMinutes: SWIRLS_RAW_CONTRACT.cadenceMinutes,
  accumulationMinutes: SWIRLS_RAW_CONTRACT.accumulationMinutes,
  firstLeadMinutes: SWIRLS_RAW_CONTRACT.firstLeadMinutes,
  lastLeadMinutes: SWIRLS_RAW_CONTRACT.lastLeadMinutes,
  unit: SWIRLS_RAW_CONTRACT.unit,
  grid: {
    rows: SWIRLS_RAW_CONTRACT.rows,
    cols: SWIRLS_RAW_CONTRACT.cols,
    cellCount: SWIRLS_RAW_CONTRACT.cellCount,
    orientation: SWIRLS_RAW_CONTRACT.orientation,
    coverage: SWIRLS_RAW_CONTRACT.coverage
  }
});

function createWorkerSwirlsFetchText() {
  return async function fetchSwirlsText(url, options = {}) {
    const ttlSeconds = Math.max(1, Number(options.ttlSeconds) || SWIRLS_FETCH_POLICY.indexTtlSeconds);
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || SWIRLS_FETCH_POLICY.timeoutMs);
    const bypassCache = options.bypassCache === true;
    const accept = 'text/plain,*/*';
    const cache = caches.default;
    const cacheKey = new Request(url, { headers: { Accept: accept } });

    if (!bypassCache) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const body = await cached.text();
        return {
          body,
          bytes: new TextEncoder().encode(body).byteLength,
          updatedAt: cached.headers.get('last-modified'),
          cacheStatus: 'worker-hit'
        };
      }
    }

    const upstream = await fetchWithTimeout(url, {
      cache: bypassCache ? 'no-store' : 'no-cache',
      headers: {
        Accept: accept,
        'Cache-Control': bypassCache ? 'no-cache, no-store, max-age=0' : 'no-cache'
      },
      cf: bypassCache
        ? { cacheEverything: false, cacheTtl: 0 }
        : { cacheEverything: true, cacheTtl: ttlSeconds }
    }, timeoutMs);

    if (!upstream.ok) throw new Error('SWIRLS upstream HTTP ' + upstream.status);
    const body = await upstream.text();
    const updatedAt = upstream.headers.get('last-modified');
    const upstreamCacheStatus = upstream.headers.get('cf-cache-status') || null;

    if (!bypassCache) {
      const headers = new Headers(upstream.headers);
      headers.set('Cache-Control', 'public, max-age=' + ttlSeconds);
      await cache.put(cacheKey, new Response(body, { status: 200, headers }));
    }

    return {
      body,
      bytes: new TextEncoder().encode(body).byteLength,
      updatedAt,
      cacheStatus: upstreamCacheStatus || (bypassCache ? 'bypass' : 'worker-miss')
    };
  };
}

const SWIRLS_RUNTIME = createSwirlsRuntime({
  fetchText: createWorkerSwirlsFetchText(),
  policy: SWIRLS_FETCH_POLICY
});

async function handleSwirlsProbe() {
  const probe = await SWIRLS_RUNTIME.probe({ frameIndex: 0, includeLastFrame: true });
  return json({
    ...probe,
    version: VERSION,
    workerVersion: VERSION
  }, 200, { 'Cache-Control': 'no-store' });
}

async function handleSwirlsFrame(url) {
  const rawFrame = url.searchParams.get('frame');
  if (!/^\d+$/.test(String(rawFrame || ''))) {
    return json({ ok: false, version: VERSION, error: 'SWIRLS frame must be an integer from 0 to 15' }, 400, { 'Cache-Control': 'no-store' });
  }

  const frameIndex = Number(rawFrame);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= SWIRLS_RAW_CONTRACT.frameCount) {
    return json({ ok: false, version: VERSION, error: 'SWIRLS frame must be an integer from 0 to 15' }, 400, { 'Cache-Control': 'no-store' });
  }

  const frame = await SWIRLS_RUNTIME.loadFrame(frameIndex);
  return json({
    ok: true,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    contractVersion: frame.contractVersion,
    frameIndex: frame.frameIndex,
    runTime: frame.runTime,
    validTime: frame.validTime,
    leadMinutes: frame.leadMinutes,
    windowStart: frame.windowStart,
    windowEnd: frame.windowEnd,
    unit: frame.unit,
    source: frame.source,
    sourceBytes: frame.sourceBytes,
    sourceUpdatedAt: frame.sourceUpdatedAt,
    cacheStatus: frame.cacheStatus,
    index: frame.index,
    grid: frame.grid,
    values: frame.values,
    validation: frame.validation
  }, 200, { 'Cache-Control': 'public, max-age=' + SWIRLS_FETCH_POLICY.mdlTtlSeconds });
}
/* RAIN_TRACK_SWIRLS_INLINE_END */
