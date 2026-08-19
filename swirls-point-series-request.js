import { SWIRLS_RAW_CONTRACT } from './swirls-data.js';
import { sampleSwirlsPoint } from './swirls-point-sample.js';
import { SwirlsPointRequestError } from './swirls-point-request.js';

const DEFAULT_CONCURRENCY = 4;

export function createSwirlsPointSeriesRequestHandler({
  loadFrame,
  loadFrames,
  concurrency = DEFAULT_CONCURRENCY
}) {
  if (typeof loadFrame !== 'function' && typeof loadFrames !== 'function') {
    throw new Error('SWIRLS point-series request handler requires loadFrame(frameIndex) or loadFrames(frameIndexes)');
  }
  const parallelism = Math.max(1, Math.min(SWIRLS_RAW_CONTRACT.frameCount, Math.floor(Number(concurrency) || DEFAULT_CONCURRENCY)));

  return async function handleSwirlsPointSeriesRequest(url) {
    const lat = parseCoordinate(url.searchParams.get('lat'), 'lat');
    const lon = parseCoordinate(url.searchParams.get('lon'), 'lon');
    assertSupportedCoverage(lat, lon);

    const frameIndexes = Array.from({ length:SWIRLS_RAW_CONTRACT.frameCount }, (_, frameIndex) => frameIndex);
    const frames = typeof loadFrames === 'function'
      ? await loadFrames(frameIndexes, { concurrency:parallelism })
      : await mapWithConcurrency(frameIndexes, parallelism, frameIndex => loadFrame(frameIndex));
    const samples = frames.map(frame => sampleSwirlsPoint(frame, lat, lon));

    validateSeries(samples);
    const first = samples[0];

    return {
      ok: true,
      contractVersion: first?.contractVersion || SWIRLS_RAW_CONTRACT.version,
      source: 'HKO SWIRLS point series',
      runTime: first.runTime,
      cadenceMinutes: SWIRLS_RAW_CONTRACT.cadenceMinutes,
      accumulationMinutes: SWIRLS_RAW_CONTRACT.accumulationMinutes,
      firstLeadMinutes: SWIRLS_RAW_CONTRACT.firstLeadMinutes,
      lastLeadMinutes: SWIRLS_RAW_CONTRACT.lastLeadMinutes,
      unit: first.unit || SWIRLS_RAW_CONTRACT.unit,
      location: { lat, lon },
      interpolation: first.interpolation,
      points: samples.map(sample => ({
        frameIndex: sample.frameIndex,
        validTime: sample.validTime,
        leadMinutes: sample.leadMinutes,
        windowStart: sample.windowStart,
        windowEnd: sample.windowEnd,
        amountMm: sample.amountMm,
        clampedToGridCentreBoundary: Boolean(sample.clampedToGridCentreBoundary)
      }))
    };
  };
}

function parseCoordinate(value, label) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new SwirlsPointRequestError(`Missing or invalid ${label}`, 400);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new SwirlsPointRequestError(`Missing or invalid ${label}`, 400);
  }
  return number;
}

function assertSupportedCoverage(lat, lon) {
  if (
    lat < SWIRLS_RAW_CONTRACT.coverage.minLat ||
    lat > SWIRLS_RAW_CONTRACT.coverage.maxLat ||
    lon < SWIRLS_RAW_CONTRACT.coverage.minLon ||
    lon > SWIRLS_RAW_CONTRACT.coverage.maxLon
  ) {
    throw new SwirlsPointRequestError('SWIRLS point is outside supported coverage', 422);
  }
}

function validateSeries(samples) {
  if (!Array.isArray(samples) || samples.length !== SWIRLS_RAW_CONTRACT.frameCount) {
    throw new Error('SWIRLS point series is incomplete');
  }

  const runTime = samples[0]?.runTime;
  if (!runTime) throw new Error('SWIRLS point series is missing run time');

  samples.forEach((sample, frameIndex) => {
    if (sample.frameIndex !== frameIndex) throw new Error('SWIRLS point series frame order is invalid');
    if (sample.runTime !== runTime) throw new Error('SWIRLS point series spans multiple forecast runs');
    const expectedLead = SWIRLS_RAW_CONTRACT.firstLeadMinutes + frameIndex * SWIRLS_RAW_CONTRACT.cadenceMinutes;
    if (sample.leadMinutes !== expectedLead) throw new Error('SWIRLS point series lead time is invalid');
    if (!Number.isFinite(sample.amountMm) || sample.amountMm < 0) throw new Error('SWIRLS point series contains invalid rainfall');
  });
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length:Math.min(concurrency, items.length) }, run));
  return results;
}
