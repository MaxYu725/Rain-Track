import { SWIRLS_RAW_CONTRACT } from './swirls-data.js';

const EPSILON = 1e-9;
const DEFAULT_MAX_CONCURRENT = 4;

export async function loadSwirlsPointSeries({
  runtime,
  latitude,
  longitude,
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
} = {}) {
  if (!runtime || typeof runtime.loadFrame !== 'function') {
    throw new Error('SWIRLS point series requires a runtime with loadFrame()');
  }
  const lat = finiteCoordinate(latitude, 'latitude');
  const lon = finiteCoordinate(longitude, 'longitude');
  assertInsideCoverage(lat, lon);

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const frames = await loadFrames(
        runtime,
        SWIRLS_RAW_CONTRACT.frameCount,
        Math.max(1, Math.min(8, Number(maxConcurrent) || DEFAULT_MAX_CONCURRENT)),
        attempt > 0,
      );
      return buildSwirlsPointSeries({ frames, latitude: lat, longitude: lon });
    } catch (error) {
      lastError = error;
      if (!/mixed SWIRLS run|run changed|run time mismatch/i.test(String(error?.message || error))) throw error;
    }
  }
  throw lastError || new Error('Unable to build SWIRLS point series');
}

export function buildSwirlsPointSeries({ frames, latitude, longitude } = {}) {
  const lat = finiteCoordinate(latitude, 'latitude');
  const lon = finiteCoordinate(longitude, 'longitude');
  if (!Array.isArray(frames) || frames.length !== SWIRLS_RAW_CONTRACT.frameCount) {
    throw new Error(`SWIRLS point series requires ${SWIRLS_RAW_CONTRACT.frameCount} frames`);
  }

  const ordered = [...frames].sort((a, b) => Number(a.frameIndex) - Number(b.frameIndex));
  const runTimes = new Set(ordered.map(frame => frame?.runTime).filter(Boolean));
  if (runTimes.size !== 1) throw new Error('mixed SWIRLS run while building point series');

  const referenceGrid = ordered[0]?.grid;
  assertGrid(referenceGrid);
  const samples = ordered.map((frame, index) => {
    if (Number(frame?.frameIndex) !== index) throw new Error(`SWIRLS point series missing frame ${index}`);
    if (frame.runTime !== ordered[0].runTime) throw new Error('mixed SWIRLS run while building point series');
    assertCompatibleGrid(referenceGrid, frame.grid);
    const sampled = sampleFrameAtPoint(frame, lat, lon);
    return {
      frameIndex: index,
      validTime: frame.validTime,
      leadMinutes: frame.leadMinutes,
      windowStart: frame.windowStart,
      windowEnd: frame.windowEnd,
      accumulationMm: round(sampled.value, 3),
      spatialSpreadMm: round(sampled.spatialSpreadMm, 3),
    };
  });

  const peak = samples.reduce((best, sample) =>
    sample.accumulationMm > best.accumulationMm ? sample : best,
  samples[0]);
  const firstWet = samples.find(sample => sample.accumulationMm >= 0.05) || null;

  return {
    contractVersion: SWIRLS_RAW_CONTRACT.version,
    runTime: ordered[0].runTime,
    cadenceMinutes: SWIRLS_RAW_CONTRACT.cadenceMinutes,
    accumulationMinutes: SWIRLS_RAW_CONTRACT.accumulationMinutes,
    unit: SWIRLS_RAW_CONTRACT.unit,
    location: { lat, lon },
    interpolation: 'bilinear-four-grid-points',
    sampleCount: samples.length,
    peakAccumulationMm: peak.accumulationMm,
    peakLeadMinutes: peak.leadMinutes,
    firstWetLeadMinutes: firstWet?.leadMinutes ?? null,
    samples,
  };
}

export function sampleFrameAtPoint(frame, latitude, longitude) {
  const grid = frame?.grid;
  assertGrid(grid);
  if (!Array.isArray(frame?.values) || frame.values.length !== grid.rows * grid.cols) {
    throw new Error('SWIRLS frame values do not match grid shape');
  }

  const row = bracketAxis(grid.latitudes, latitude);
  const col = bracketAxis(grid.longitudes, longitude);
  if (!row || !col) throw new Error('Selected point is outside the SWIRLS grid');

  const q00 = valueAt(frame.values, grid.cols, row.i0, col.i0);
  const q01 = valueAt(frame.values, grid.cols, row.i0, col.i1);
  const q10 = valueAt(frame.values, grid.cols, row.i1, col.i0);
  const q11 = valueAt(frame.values, grid.cols, row.i1, col.i1);
  const values = [q00, q01, q10, q11];
  if (values.some(value => !Number.isFinite(value))) {
    throw new Error('SWIRLS interpolation corner contains a non-finite value');
  }

  const top = q00 * (1 - col.t) + q01 * col.t;
  const bottom = q10 * (1 - col.t) + q11 * col.t;
  const value = top * (1 - row.t) + bottom * row.t;
  return {
    value: Math.max(0, value),
    spatialSpreadMm: Math.max(...values) - Math.min(...values),
  };
}

async function loadFrames(runtime, frameCount, maxConcurrent, bypassCache) {
  const output = new Array(frameCount);
  for (let start = 0; start < frameCount; start += maxConcurrent) {
    const indexes = Array.from(
      { length: Math.min(maxConcurrent, frameCount - start) },
      (_, offset) => start + offset,
    );
    const loaded = await Promise.all(indexes.map(index => runtime.loadFrame(index, { bypassCache })));
    loaded.forEach((frame, offset) => { output[indexes[offset]] = frame; });
  }
  return output;
}

function assertInsideCoverage(lat, lon) {
  const coverage = SWIRLS_RAW_CONTRACT.coverage;
  if (
    lat < coverage.minLat || lat > coverage.maxLat ||
    lon < coverage.minLon || lon > coverage.maxLon
  ) {
    throw new RangeError('Coordinates are outside the SWIRLS coverage');
  }
}

function assertGrid(grid) {
  if (!grid || !Array.isArray(grid.latitudes) || !Array.isArray(grid.longitudes)) {
    throw new Error('SWIRLS frame grid axes are missing');
  }
  if (!Number.isInteger(grid.rows) || !Number.isInteger(grid.cols)) {
    throw new Error('SWIRLS frame grid shape is invalid');
  }
  if (grid.latitudes.length !== grid.rows || grid.longitudes.length !== grid.cols) {
    throw new Error('SWIRLS frame grid axes do not match shape');
  }
}

function assertCompatibleGrid(reference, candidate) {
  assertGrid(candidate);
  if (reference.rows !== candidate.rows || reference.cols !== candidate.cols) {
    throw new Error('SWIRLS frame grid shape changed within run');
  }
  if (!sameAxis(reference.latitudes, candidate.latitudes) || !sameAxis(reference.longitudes, candidate.longitudes)) {
    throw new Error('SWIRLS frame grid axes changed within run');
  }
}

function sameAxis(first, second) {
  if (first.length !== second.length) return false;
  for (let i = 0; i < first.length; i += 1) {
    if (Math.abs(Number(first[i]) - Number(second[i])) > EPSILON) return false;
  }
  return true;
}

function bracketAxis(axis, target) {
  if (!axis.length) return null;
  if (axis.length === 1) {
    return Math.abs(target - axis[0]) <= EPSILON ? { i0: 0, i1: 0, t: 0 } : null;
  }
  for (let index = 0; index < axis.length - 1; index += 1) {
    const a = Number(axis[index]);
    const b = Number(axis[index + 1]);
    const low = Math.min(a, b) - EPSILON;
    const high = Math.max(a, b) + EPSILON;
    if (target < low || target > high) continue;
    if (Math.abs(b - a) <= EPSILON) return { i0: index, i1: index, t: 0 };
    return { i0: index, i1: index + 1, t: clamp((target - a) / (b - a), 0, 1) };
  }
  return null;
}

function valueAt(values, cols, row, col) {
  return Number(values[row * cols + col]);
}

function finiteCoordinate(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`Invalid ${label}`);
  return number;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
