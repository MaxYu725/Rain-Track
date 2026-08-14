import { readFileSync, writeFileSync } from 'node:fs';

const workerPath = 'worker.js';
let worker = readFileSync(workerPath, 'utf8');
let swirlsData = readFileSync('swirls-data.js', 'utf8');
let swirlsRuntime = readFileSync('swirls-worker-runtime.js', 'utf8');

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing transform anchor: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Transform anchor is not unique: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

if (!worker.includes("const VERSION = '2.4.4';")) {
  throw new Error('Expected stable Worker v2.4.4 baseline');
}
if (worker.includes('RAIN_TRACK_SWIRLS_INLINE_BEGIN')) {
  throw new Error('Worker already contains the Phase 3B2 inline adapter');
}

swirlsData = swirlsData
  .replace(/^export /gm, '')
  .replace(/\bcoordKey\b/g, 'swirlsCoordKey');

swirlsRuntime = swirlsRuntime
  .replace(/^import \{[\s\S]*?\} from '\.\/swirls-data\.js';\r?\n\r?\n/, '')
  .replace(/^export /gm, '');

if (/^\s*import\s/m.test(swirlsData) || /^\s*import\s/m.test(swirlsRuntime) || /^\s*export\s/m.test(swirlsData) || /^\s*export\s/m.test(swirlsRuntime)) {
  throw new Error('Module syntax remained in inline SWIRLS sources');
}

const adapter = String.raw`
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
`;

worker = replaceOnce(worker, 'Hong Kong Point Rainfall Forecast Worker v2.4.4', 'Hong Kong Point Rainfall Forecast Worker v2.5.0', 'version comment');
worker = replaceOnce(worker, "const VERSION = '2.4.4';", "const VERSION = '2.5.0';", 'VERSION');
worker = replaceOnce(
  worker,
  ' *   GET /api/rain/nowcast\n *   GET /probe/rain\n',
  ' *   GET /api/rain/nowcast\n *   GET /probe/rain\n *   GET /probe/swirls\n *   GET /api/rain/swirls/frame?frame=0..15\n',
  'route documentation'
);
worker = replaceOnce(
  worker,
  "            '/api/rain/nowcast',\n            '/probe/rain',\n            '/api/capabilities',",
  "            '/api/rain/nowcast',\n            '/probe/rain',\n            '/probe/swirls',\n            '/api/rain/swirls/frame?frame=0',\n            '/api/capabilities',",
  'health routes'
);
worker = replaceOnce(
  worker,
  '            nowcastGrid: true,\n            radarFrames: true,',
  '            nowcastGrid: true,\n            swirlsFrames: true,\n            swirls: SWIRLS_PUBLIC_CONTRACT,\n            radarFrames: true,',
  'health capabilities'
);
worker = replaceOnce(
  worker,
  '        capabilities: { pointForecast: true, nowcastGrid: true, radarFrames: true, radar: RADAR_CONTRACT },\n        radarContract: RADAR_CONTRACT',
  '        capabilities: {\n          pointForecast: true,\n          nowcastGrid: true,\n          swirlsFrames: true,\n          swirls: SWIRLS_PUBLIC_CONTRACT,\n          radarFrames: true,\n          radar: RADAR_CONTRACT\n        },\n        swirlsContract: SWIRLS_PUBLIC_CONTRACT,\n        radarContract: RADAR_CONTRACT',
  'capabilities endpoint'
);
worker = replaceOnce(
  worker,
  "      if (url.pathname === '/probe/rain') return await handleNowcast(true);\n\n      if (url.pathname === '/api/radar/frames') {",
  "      if (url.pathname === '/probe/rain') return await handleNowcast(true);\n      if (url.pathname === '/probe/swirls') return await handleSwirlsProbe();\n      if (url.pathname === '/api/rain/swirls/frame') return await handleSwirlsFrame(url);\n\n      if (url.pathname === '/api/radar/frames') {",
  'SWIRLS route dispatch'
);
worker = replaceOnce(
  worker,
  "        'User-Agent': 'Mozilla/5.0 (compatible; HK-Point-Rain-Worker/2.4.4)',",
  "        'User-Agent': 'Mozilla/5.0 (compatible; HK-Point-Rain-Worker/' + VERSION + ')',",
  'Worker user agent'
);

const inlineBlock = [
  '',
  '/* RAIN_TRACK_SWIRLS_INLINE_BEGIN',
  ' * Phase 3B2 production inline adapter. Keep worker.js directly deployable.',
  ' * Contract source of truth remains swirls-data.js / swirls-worker-runtime.js.',
  ' */',
  swirlsData.trim(),
  '',
  swirlsRuntime.trim(),
  '',
  adapter.trim(),
  '/* RAIN_TRACK_SWIRLS_INLINE_END */',
  ''
].join('\n');

const existingNames = new Set([
  ...[...worker.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map(match => match[1]),
  ...[...worker.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=/gm)].map(match => match[1])
]);
const inlineNames = [
  ...[...inlineBlock.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map(match => match[1]),
  ...[...inlineBlock.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=/gm)].map(match => match[1])
];
const duplicates = inlineNames.filter(name => existingNames.has(name));
if (duplicates.length) throw new Error(`Inline SWIRLS declaration conflicts: ${[...new Set(duplicates)].join(', ')}`);

worker = worker.trimEnd() + '\n' + inlineBlock;

if (/^\s*import\s/m.test(worker)) throw new Error('worker.js must remain import-free');
if (!worker.includes("'/probe/swirls'")) throw new Error('SWIRLS probe route missing');
if (!worker.includes("'/api/rain/swirls/frame'")) throw new Error('SWIRLS frame route missing');

writeFileSync(workerPath, worker);
console.log('Phase 3B2 clean Worker transform complete');
