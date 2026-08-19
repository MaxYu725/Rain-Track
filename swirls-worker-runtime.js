import {
  SWIRLS_RAW_CONTRACT,
  bindSwirlsMdlFrame,
  parseSwirlsIndex
} from './swirls-data.js';

export const SWIRLS_FETCH_POLICY = Object.freeze({
  indexTtlSeconds: 45,
  mdlTtlSeconds: 45,
  timeoutMs: 12_000,
  retryOnRollover: true
});

export function createSwirlsRuntime({
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

  async function loadFrames(frameIndexes, { concurrency = 4, bypassCache = false } = {}) {
    const normalizedIndexes = normalizeFrameIndexes(frameIndexes);
    const parallelism = Math.max(1, Math.min(6, Math.floor(Number(concurrency) || 4), normalizedIndexes.length));

    // Point-series must share one index snapshot. Besides guaranteeing that all
    // 16 frames are bound to the same forecast run, this avoids re-fetching the
    // SWIRLS index once per frame and keeps a Free-plan Worker invocation below
    // Cloudflare's external subrequest budget even when upstream URLs redirect.
    const indexData = await loadIndex({ bypassCache });
    return mapWithConcurrency(
      normalizedIndexes,
      parallelism,
      frameIndex => loadBoundFrame(indexData, frameIndex, { bypassCache })
    );
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

  return Object.freeze({ loadIndex, loadFrame, loadFrames, probe });
}

export function createNetworkFetchText({
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

export function summarizeIndex(indexData) {
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

export function summarizeFrame(frame) {
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

function normalizeFrameIndexes(values) {
  if (!Array.isArray(values) || !values.length) throw new Error('SWIRLS frame batch requires at least one frame index');
  return values.map(normalizeFrameIndex);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const resultIndex = cursor++;
      results[resultIndex] = await worker(items[resultIndex], resultIndex);
    }
  }

  await Promise.all(Array.from({ length:Math.min(concurrency, items.length) }, run));
  return results;
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
