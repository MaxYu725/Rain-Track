import { SWIRLS_RAW_CONTRACT } from './swirls-data.js';
import { sampleSwirlsPoint } from './swirls-point-sample.js';
import { SwirlsPointRequestError } from './swirls-point-request.js';

export function createSwirlsPointSeriesRequestHandler({ loadFrames } = {}) {
  if (typeof loadFrames !== 'function') {
    throw new Error('SWIRLS point-series request handler requires loadFrames(frameIndexes)');
  }

  return async function handleSwirlsPointSeriesRequest(url) {
    const lat = parseCoordinate(url.searchParams.get('lat'), 'lat');
    const lon = parseCoordinate(url.searchParams.get('lon'), 'lon');
    assertSupportedCoverage(lat, lon);

    const frameIndexes = Array.from({ length:SWIRLS_RAW_CONTRACT.frameCount }, (_, frameIndex) => frameIndex);
    const batch = await loadFrames(frameIndexes);
    const frames = Array.isArray(batch?.frames) ? batch.frames : [];
    const samples = frames
      .filter(Boolean)
      .map(frame => sampleSwirlsPoint(frame, lat, lon))
      .sort((a, b) => a.frameIndex - b.frameIndex);

    const missingFrames = frameIndexes.filter(frameIndex => !samples.some(sample => sample.frameIndex === frameIndex));
    validateSeriesSnapshot(samples, batch?.index?.runTime);
    if (!samples.length) throw new Error('SWIRLS point series contains no usable frames');

    const first = samples[0];
    const runTime = batch?.index?.runTime || first.runTime;
    return {
      ok: true,
      complete: missingFrames.length === 0,
      contractVersion: first.contractVersion || SWIRLS_RAW_CONTRACT.version,
      source: 'HKO SWIRLS point series',
      runTime,
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
      })),
      missingFrames
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

function validateSeriesSnapshot(samples, expectedRunTime) {
  if (!Array.isArray(samples)) throw new Error('SWIRLS point series is invalid');
  const seen = new Set();
  for (const sample of samples) {
    if (!Number.isInteger(sample.frameIndex) || sample.frameIndex < 0 || sample.frameIndex >= SWIRLS_RAW_CONTRACT.frameCount) {
      throw new Error('SWIRLS point series contains invalid frame index');
    }
    if (seen.has(sample.frameIndex)) throw new Error('SWIRLS point series contains duplicate frames');
    seen.add(sample.frameIndex);

    const expectedLead = SWIRLS_RAW_CONTRACT.firstLeadMinutes + sample.frameIndex * SWIRLS_RAW_CONTRACT.cadenceMinutes;
    if (sample.leadMinutes !== expectedLead) throw new Error('SWIRLS point series lead time is invalid');
    if (!sample.runTime || (expectedRunTime && sample.runTime !== expectedRunTime)) {
      throw new Error('SWIRLS point series spans multiple forecast runs');
    }
    if (!Number.isFinite(sample.amountMm) || sample.amountMm < 0) {
      throw new Error('SWIRLS point series contains invalid rainfall');
    }
  }
}
