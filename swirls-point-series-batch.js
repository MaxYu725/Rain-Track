import { SWIRLS_RAW_CONTRACT, bindSwirlsMdlFrame } from './swirls-data.js';
import { SWIRLS_FETCH_POLICY, summarizeIndex } from './swirls-worker-runtime.js';

const HARD_DEADLINE_GRACE_MS = 1_500;

export function createSwirlsPointSeriesBatchLoader({
  loadIndex,
  fetchText,
  policy = SWIRLS_FETCH_POLICY
} = {}) {
  if (typeof loadIndex !== 'function') throw new Error('SWIRLS batch loader requires loadIndex()');
  if (typeof fetchText !== 'function') throw new Error('SWIRLS batch loader requires fetchText()');

  return async function loadFrames(frameIndexes, { bypassCache = false } = {}) {
    const indexes = normalizeFrameIndexes(frameIndexes);
    const fetchDeadlineMs = Math.max(1, Number(policy?.timeoutMs) || SWIRLS_FETCH_POLICY.timeoutMs) + HARD_DEADLINE_GRACE_MS;

    // One immutable index snapshot per request. The hard deadline is deliberately
    // independent from AbortController so a stalled upstream fetch can never keep
    // the compact point-series route pending indefinitely.
    const indexData = await withHardDeadline(
      () => loadIndex({ bypassCache }),
      fetchDeadlineMs,
      'SWIRLS index'
    );

    // All frame tasks still start immediately from the same snapshot. Each task
    // gets a JS-level hard deadline in addition to the network abort timeout.
    // A hung frame therefore degrades to a partial 15/16-style series instead of
    // blocking every otherwise usable point.
    const tasks = indexes.map(frameIndex => withHardDeadline(async () => {
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
    }, fetchDeadlineMs, `SWIRLS frame ${frameIndex}`));

    const settled = await Promise.allSettled(tasks);
    return {
      index: summarizeIndex(indexData),
      frames: settled.map(result => result.status === 'fulfilled' ? result.value : null),
      failures: settled.flatMap((result, resultIndex) => result.status === 'rejected'
        ? [{
            frameIndex: indexes[resultIndex],
            error: result.reason instanceof Error ? result.reason.message : String(result.reason)
          }]
        : [])
    };
  };
}

function withHardDeadline(task, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(
      finish(reject),
      Math.max(1, Number(timeoutMs) || SWIRLS_FETCH_POLICY.timeoutMs),
      new Error(`${label} exceeded hard deadline`)
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
