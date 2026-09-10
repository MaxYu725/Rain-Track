import { SWIRLS_RAW_CONTRACT, bindSwirlsMdlFrame } from './swirls-data.js';
import { SWIRLS_FETCH_POLICY, summarizeIndex } from './swirls-worker-runtime.js';

export const SWIRLS_POINT_SERIES_CONCURRENCY = 4;
export const SWIRLS_POINT_SERIES_INDEX_DEADLINE_MS = 8_000;
export const SWIRLS_POINT_SERIES_FRAME_BUDGET_MS = 9_000;

export function createSwirlsPointSeriesBatchLoader({
  loadIndex,
  fetchText,
  policy = SWIRLS_FETCH_POLICY,
  concurrency = SWIRLS_POINT_SERIES_CONCURRENCY,
  indexDeadlineMs = SWIRLS_POINT_SERIES_INDEX_DEADLINE_MS,
  frameBudgetMs = SWIRLS_POINT_SERIES_FRAME_BUDGET_MS
} = {}) {
  if (typeof loadIndex !== 'function') throw new Error('SWIRLS batch loader requires loadIndex()');
  if (typeof fetchText !== 'function') throw new Error('SWIRLS batch loader requires fetchText()');

  return async function loadFrames(frameIndexes, { bypassCache = false } = {}) {
    const indexes = normalizeFrameIndexes(frameIndexes);
    const workerCount = Math.max(1, Math.min(indexes.length, Number(concurrency) || SWIRLS_POINT_SERIES_CONCURRENCY));
    const indexDeadline = Math.max(1, Number(indexDeadlineMs) || SWIRLS_POINT_SERIES_INDEX_DEADLINE_MS);
    const frameBudget = Math.max(1, Number(frameBudgetMs) || SWIRLS_POINT_SERIES_FRAME_BUDGET_MS);

    // Read exactly one immutable index snapshot. A compact Rain Home request
    // must never wait forever for the upstream index before it can fail closed.
    const indexData = await withHardDeadline(
      () => loadIndex({ bypassCache }),
      indexDeadline,
      'SWIRLS index'
    );

    // Keep concurrent HKO MDL work below the Worker outbound connection ceiling.
    // The whole frame phase also has one shared budget: completed frames are
    // returned as a coherent partial series instead of allowing one hung frame
    // to pin Promise.allSettled() and the Rain Home skeleton indefinitely.
    const deadlineAt = Date.now() + frameBudget;
    const results = Array(indexes.length);
    let nextPosition = 0;

    const runWorker = async () => {
      while (true) {
        const position = nextPosition;
        nextPosition += 1;
        if (position >= indexes.length) return;

        const frameIndex = indexes[position];
        const remainingMs = deadlineAt - Date.now();
        if (remainingMs <= 0) {
          results[position] = {
            status:'rejected',
            reason:new Error(`SWIRLS frame ${frameIndex} skipped after series deadline`)
          };
          continue;
        }

        try {
          const fetchTimeoutMs = Math.max(1, Math.min(
            Number(policy?.timeoutMs) || SWIRLS_FETCH_POLICY.timeoutMs,
            remainingMs
          ));
          results[position] = {
            status:'fulfilled',
            value:await withHardDeadline(
              () => loadFrameFromSnapshot(indexData, frameIndex, {
                fetchText,
                policy,
                bypassCache,
                timeoutMs:fetchTimeoutMs
              }),
              remainingMs,
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

async function loadFrameFromSnapshot(indexData, frameIndex, { fetchText, policy, bypassCache, timeoutMs }) {
  const descriptor = indexData.frames.find(frame => frame.frameIndex === frameIndex);
  if (!descriptor) throw new Error(`SWIRLS frame ${frameIndex} is not present in the current index`);

  const result = await fetchText(descriptor.mdlUrl, {
    kind:'mdl',
    frameIndex,
    runTime:indexData.inferredRunTime,
    ttlSeconds:policy.mdlTtlSeconds,
    timeoutMs,
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
      Math.max(1, Number(timeoutMs) || 1)
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
