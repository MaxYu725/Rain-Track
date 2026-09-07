import { SWIRLS_RAW_CONTRACT, bindSwirlsMdlFrame } from './swirls-data.js';
import { SWIRLS_FETCH_POLICY, summarizeIndex } from './swirls-worker-runtime.js';

const HARD_DEADLINE_GRACE_MS = 1_500;
const RETRY_DELAY_MS = 120;
export const SWIRLS_POINT_SERIES_CONCURRENCY = 3;
export const SWIRLS_POINT_SERIES_ATTEMPTS = 2;

export function createSwirlsPointSeriesBatchLoader({
  loadIndex,
  fetchText,
  policy = SWIRLS_FETCH_POLICY,
  concurrency = SWIRLS_POINT_SERIES_CONCURRENCY,
  attempts = SWIRLS_POINT_SERIES_ATTEMPTS
} = {}) {
  if (typeof loadIndex !== 'function') throw new Error('SWIRLS batch loader requires loadIndex()');
  if (typeof fetchText !== 'function') throw new Error('SWIRLS batch loader requires fetchText()');

  return async function loadFrames(frameIndexes, { bypassCache = false } = {}) {
    const indexes = normalizeFrameIndexes(frameIndexes);
    const workerCount = Math.max(1, Math.min(indexes.length, Number(concurrency) || SWIRLS_POINT_SERIES_CONCURRENCY));
    const attemptCount = Math.max(1, Math.min(2, Number(attempts) || SWIRLS_POINT_SERIES_ATTEMPTS));
    const fetchDeadlineMs = Math.max(1, Number(policy?.timeoutMs) || SWIRLS_FETCH_POLICY.timeoutMs) + HARD_DEADLINE_GRACE_MS;

    // Keep one immutable index snapshot across the entire request so every
    // returned point belongs to the same SWIRLS run.
    const indexData = await withHardDeadline(
      () => loadIndex({ bypassCache }),
      fetchDeadlineMs,
      'SWIRLS index'
    );

    // HKO MDL requests are deliberately capped below the Worker connection
    // ceiling. A small pool is materially more reliable than launching all 16
    // upstream fetches together, and failed frames get one bounded retry while
    // preserving the same index snapshot.
    const results = Array(indexes.length);
    let nextPosition = 0;

    const runWorker = async () => {
      while (true) {
        const position = nextPosition;
        nextPosition += 1;
        if (position >= indexes.length) return;
        const frameIndex = indexes[position];
        try {
          results[position] = {
            status:'fulfilled',
            value:await withHardDeadline(
              () => loadFrameWithRetry(indexData, frameIndex, {
                fetchText,
                policy,
                bypassCache,
                attempts:attemptCount
              }),
              fetchDeadlineMs,
              `SWIRLS frame ${frameIndex}`
            )
          };
        } catch (error) {
          results[position] = { status:'rejected', reason:error };
        }
      }
    };

    await Promise.all(Array.from({ length:workerCount }, () => runWorker()));

    return {
      index:summarizeIndex(indexData),
      frames:results.map(result => result?.status === 'fulfilled' ? result.value : null),
      failures:results.flatMap((result, resultIndex) => result?.status === 'rejected'
        ? [{
            frameIndex:indexes[resultIndex],
            error:result.reason instanceof Error ? result.reason.message : String(result.reason)
          }]
        : [])
    };
  };
}

async function loadFrameWithRetry(indexData, frameIndex, options) {
  let lastError;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await loadFrameFromSnapshot(indexData, frameIndex, options);
    } catch (error) {
      lastError = error;
      if (attempt < options.attempts) await delay(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

async function loadFrameFromSnapshot(indexData, frameIndex, { fetchText, policy, bypassCache }) {
  const descriptor = indexData.frames.find(frame => frame.frameIndex === frameIndex);
  if (!descriptor) throw new Error(`SWIRLS frame ${frameIndex} is not present in the current index`);

  const result = await fetchText(descriptor.mdlUrl, {
    kind:'mdl',
    frameIndex,
    runTime:indexData.inferredRunTime,
    ttlSeconds:policy.mdlTtlSeconds,
    timeoutMs:policy.timeoutMs,
    bypassCache
  });
  const text = normalizeFetchResult(result, `SWIRLS frame ${frameIndex}`);
  const frame = bindSwirlsMdlFrame(indexData, frameIndex, text.body);

  return {
    ...frame,
    sourceBytes:text.bytes,
    sourceUpdatedAt:text.updatedAt,
    cacheStatus:text.cacheStatus,
    index:summarizeIndex(indexData)
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function withHardDeadline(task, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(value);
    };
    timer = setTimeout(
      () => finish(reject)(new Error(`${label} exceeded hard deadline`)),
      Math.max(1, Number(timeoutMs) || SWIRLS_FETCH_POLICY.timeoutMs)
    );

    Promise.resolve()
      .then(task)
      .then(finish(resolve), finish(reject));
  });
}

function normalizeFrameIndexes(values) {
  if (!Array.isArray(values) || !values.length) throw new Error('SWIRLS frame batch requires at least one frame index');
  const indexes = values.map(value => {
    const frameIndex = Number(value);
    if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= SWIRLS_RAW_CONTRACT.frameCount) {
      throw new Error(`SWIRLS frame index must be 0..${SWIRLS_RAW_CONTRACT.frameCount - 1}`);
    }
    return frameIndex;
  });
  if (new Set(indexes).size !== indexes.length) throw new Error('SWIRLS frame batch contains duplicate frame indexes');
  return indexes;
}

function normalizeFetchResult(result, label) {
  if (typeof result === 'string') {
    return {
      body:result,
      bytes:new TextEncoder().encode(result).byteLength,
      updatedAt:null,
      cacheStatus:null
    };
  }
  if (!result || typeof result.body !== 'string') throw new Error(`${label} fetch returned no text body`);
  return {
    body:result.body,
    bytes:Number.isFinite(result.bytes) ? result.bytes : new TextEncoder().encode(result.body).byteLength,
    updatedAt:result.updatedAt || null,
    cacheStatus:result.cacheStatus || null
  };
}
