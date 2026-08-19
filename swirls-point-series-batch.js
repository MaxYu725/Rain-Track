import { SWIRLS_RAW_CONTRACT, bindSwirlsMdlFrame } from './swirls-data.js';
import { SWIRLS_FETCH_POLICY, summarizeIndex } from './swirls-worker-runtime.js';

const DEFAULT_CONCURRENCY = 4;

export function createSwirlsPointSeriesBatchLoader({
  loadIndex,
  fetchText,
  policy = SWIRLS_FETCH_POLICY
} = {}) {
  if (typeof loadIndex !== 'function') throw new Error('SWIRLS batch loader requires loadIndex()');
  if (typeof fetchText !== 'function') throw new Error('SWIRLS batch loader requires fetchText()');

  return async function loadFrames(frameIndexes, { concurrency = DEFAULT_CONCURRENCY, bypassCache = false } = {}) {
    const indexes = normalizeFrameIndexes(frameIndexes);
    const parallelism = Math.max(1, Math.min(indexes.length, 6, Math.floor(Number(concurrency) || DEFAULT_CONCURRENCY)));

    // One index snapshot per invocation guarantees that every frame belongs to
    // the same forecast run and avoids repeating the index subrequest 16 times.
    const indexData = await loadIndex({ bypassCache });

    return mapWithConcurrency(indexes, parallelism, async frameIndex => {
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
    });
  };
}

function normalizeFrameIndexes(values) {
  if (!Array.isArray(values) || !values.length) throw new Error('SWIRLS frame batch requires at least one frame index');
  return values.map(value => {
    const frameIndex = Number(value);
    if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= SWIRLS_RAW_CONTRACT.frameCount) {
      throw new Error(`SWIRLS frame index must be 0..${SWIRLS_RAW_CONTRACT.frameCount - 1}`);
    }
    return frameIndex;
  });
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
