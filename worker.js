/**
 * Hong Kong Point Rainfall Forecast Worker v2.2.0
 * Cloudflare Worker (module syntax)
 *
 * Routes:
 *   GET /health
 *   GET /api/rain/point?lat=22.3023&lon=114.1746&radiusKm=2
 *   GET /api/rain/nowcast
 *   GET /probe/rain
 *   GET /api/capabilities
 */

const VERSION = '2.2.0';
const HKO_NOWCAST = 'https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast_tc.csv';
const CACHE_TTL_SECONDS = 600;

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
            '/api/capabilities'
          ],
          capabilities: {
            pointForecast: true,
            nowcastGrid: true,
            radarFrames: false,
            radarContract: '/api/radar/frames?range=64|256'
          },
          time: new Date().toISOString()
        });
      }

      if (url.pathname === '/api/capabilities') return json({
        ok: true, version: VERSION,
        capabilities: { pointForecast: true, nowcastGrid: true, radarFrames: false, radarContract: '/api/radar/frames?range=64|256' }
      }, 200, { 'Cache-Control': 'public, max-age=300' });
      if (url.pathname === '/api/rain/point') return await handlePointForecast(url);
      if (url.pathname === '/api/rain/nowcast') return await handleNowcast(false);
      if (url.pathname === '/probe/rain') return await handleNowcast(true);

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

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HK-Point-Rain-Worker/2.2)',
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

  let text;
  if (!wet.length) {
    text = nearbyWet
      ? '定點未來兩小時暫未見明顯降雨，但附近地區可能有雨。'
      : '未來兩小時暫未預測有明顯降雨。';
  } else {
    const first = wet[0];
    text = `預計約 ${leadLabel(first.leadMinutes)} 開始有雨，最強時段約 ${formatHkTime(peak.time)}。`;
  }

  return {
    text,
    totalMm,
    peakMm: round(peak.amountMm, 2),
    peakTime: peak.time,
    rainStartTime: wet[0]?.time || null,
    rainStartLeadMinutes: wet[0]?.leadMinutes ?? null,
    rainEndTime: wet[wet.length - 1]?.time || null,
    wetPeriodCount: wet.length
  };
}

function assessDataQuality(sourceAgeMinutes, nearbyDeltaMax, periods) {
  const maxSpread = Math.max(...periods.map(period => period.spatialSpreadMm));
  if (sourceAgeMinutes !== null && sourceAgeMinutes > 60) {
    return { status: 'expired', label: '資料已過期', note: '官方網格資料基準已超過60分鐘，結果只供參考，請稍後重新整理。' };
  }
  if (sourceAgeMinutes !== null && sourceAgeMinutes > 30) {
    return { status: 'stale', label: '資料可能過期', note: '官方網格資料基準已超過30分鐘，可能仍在等待上游更新。' };
  }
  if (sourceAgeMinutes !== null && sourceAgeMinutes > 18) {
    return { status: 'delayed', label: '更新稍有延遲', note: '官方網格資料基準已超過18分鐘，但仍可作短時參考。' };
  }
  if (nearbyDeltaMax >= 2 || maxSpread >= 3) {
    return { status: 'location-sensitive', label: '位置較敏感', note: '附近網格雨量差異較大，小幅移動位置可能改變結果。' };
  }
  return { status: 'normal', label: '資料正常', note: '定點與附近網格的預報變化相對平順。' };
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
