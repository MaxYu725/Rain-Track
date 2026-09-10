import { SWIRLS_RAW_CONTRACT } from './swirls-data.js';
import { sampleSwirlsMdlPoint } from './swirls-point-series-sample.js';
import { SWIRLS_FETCH_POLICY, summarizeIndex } from './swirls-worker-runtime.js';

export function createSwirlsPointSeriesBatchLoader({
  loadIndex,
  fetchText,
  policy = SWIRLS_FETCH_POLICY
} = {}) {
  if (typeof loadIndex !== 'function') throw new Error('SWIRLS batch loader requires loadIndex()');
  if (typeof fetchText !== 'function') throw new Error('SWIRLS batch loader requires fetchText()');

  return async function loadFrames(frameIndexes, { bypassCache = false, point } = {}) {
    const indexes = normalizeFrameIndexes(frameIndexes);
    const latitude = Number(point?.lat);
    const longitude = Number(point?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('SWIRLS point-series batch requires a finite point');
    }

    // One immutable index snapshot keeps every compact sample on the same run.
    // Rain Home does not need decoded 121x121 frames: fetch each MDL once and
    // sample only the local interpolation cells directly from the text.
    const indexData = await loadIndex({ bypassCache });
    const tasks = indexes.map(async frameIndex => {
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
      return sampleSwirlsMdlPoint(indexData, frameIndex, text.body, latitude, longitude);
    });

    const settled = await Promise.allSettled(tasks);
    return {
      index:summarizeIndex(indexData),
      samples:settled.map(result => result.status === 'fulfilled' ? result.value : null),
      failures:settled.flatMap((result, resultIndex) => result.status === 'rejected'
        ? [{
            frameIndex:indexes[resultIndex],
            error:result.reason instanceof Error ? result.reason.message : String(result.reason)
          }]
        : [])
    };
  };
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
  if (typeof result === 'string') return { body:result };
  if (!result || typeof result.body !== 'string') throw new Error(`${label} fetch returned no text body`);
  return result;
}
