import { SWIRLS_RAW_CONTRACT } from './swirls-data.js';
import { sampleSwirlsPoint } from './swirls-point-sample.js';

export class SwirlsPointRequestError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SwirlsPointRequestError';
    this.status = status;
  }
}

export function createSwirlsPointRequestHandler({ loadFrame }) {
  if (typeof loadFrame !== 'function') {
    throw new Error('SWIRLS point request handler requires loadFrame(frameIndex)');
  }

  return async function handleSwirlsPointRequest(url) {
    const frameIndex = parseFrameIndex(url.searchParams.get('frame'));
    const lat = parseCoordinate(url.searchParams.get('lat'), 'lat');
    const lon = parseCoordinate(url.searchParams.get('lon'), 'lon');

    if (
      lat < SWIRLS_RAW_CONTRACT.coverage.minLat ||
      lat > SWIRLS_RAW_CONTRACT.coverage.maxLat ||
      lon < SWIRLS_RAW_CONTRACT.coverage.minLon ||
      lon > SWIRLS_RAW_CONTRACT.coverage.maxLon
    ) {
      throw new SwirlsPointRequestError('SWIRLS point is outside supported coverage', 422);
    }

    // Non-regression invariant: one request loads exactly one requested frame.
    // There is deliberately no series aggregation, fan-out, snapshot or retry loop here.
    const frame = await loadFrame(frameIndex);
    const sample = sampleSwirlsPoint(frame, lat, lon);

    return {
      ok: true,
      contractVersion: frame?.contractVersion || SWIRLS_RAW_CONTRACT.version,
      ...sample,
    };
  };
}

function parseFrameIndex(value) {
  if (!/^\d+$/.test(String(value ?? ''))) {
    throw new SwirlsPointRequestError('SWIRLS frame must be an integer from 0 to 15', 400);
  }
  const frameIndex = Number(value);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= SWIRLS_RAW_CONTRACT.frameCount) {
    throw new SwirlsPointRequestError('SWIRLS frame must be an integer from 0 to 15', 400);
  }
  return frameIndex;
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
