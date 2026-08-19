import { SWIRLS_RAW_CONTRACT } from './swirls-data.js';

const EPSILON = 1e-9;

export function sampleSwirlsPoint(frame, lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('SWIRLS point sample requires finite lat/lon');
  }

  const grid = frame?.grid;
  const values = frame?.values;
  if (!grid || !Array.isArray(grid.latitudes) || !Array.isArray(grid.longitudes) || !Array.isArray(values)) {
    throw new Error('SWIRLS point sample requires a decoded frame grid');
  }
  if (grid.orientation !== SWIRLS_RAW_CONTRACT.orientation) {
    throw new Error('SWIRLS point sample received unexpected grid orientation');
  }

  const rows = grid.latitudes.length;
  const cols = grid.longitudes.length;
  if (!rows || !cols || values.length !== rows * cols) {
    throw new Error('SWIRLS point sample received an incomplete grid');
  }

  const bounds = grid.bounds;
  if (!bounds || latitude < bounds.south || latitude > bounds.north || longitude < bounds.west || longitude > bounds.east) {
    throw new Error('SWIRLS point is outside frame coverage');
  }

  const clampedLat = clamp(latitude, grid.latitudes.at(-1), grid.latitudes[0]);
  const clampedLon = clamp(longitude, grid.longitudes[0], grid.longitudes.at(-1));
  const [row0, row1] = bracketDescending(grid.latitudes, clampedLat);
  const [col0, col1] = bracketAscending(grid.longitudes, clampedLon);

  const q00 = valueAt(values, cols, row0, col0);
  const q01 = valueAt(values, cols, row0, col1);
  const q10 = valueAt(values, cols, row1, col0);
  const q11 = valueAt(values, cols, row1, col1);

  const lat0 = grid.latitudes[row0];
  const lat1 = grid.latitudes[row1];
  const lon0 = grid.longitudes[col0];
  const lon1 = grid.longitudes[col1];

  const tx = Math.abs(lon1 - lon0) < EPSILON ? 0 : (clampedLon - lon0) / (lon1 - lon0);
  const ty = Math.abs(lat1 - lat0) < EPSILON ? 0 : (clampedLat - lat0) / (lat1 - lat0);
  const north = q00 * (1 - tx) + q01 * tx;
  const south = q10 * (1 - tx) + q11 * tx;
  const amountMm = Math.max(0, north * (1 - ty) + south * ty);

  return {
    frameIndex: frame?.frameIndex ?? null,
    runTime: frame?.runTime || null,
    validTime: frame?.validTime || null,
    leadMinutes: frame?.leadMinutes ?? null,
    windowStart: frame?.windowStart || null,
    windowEnd: frame?.windowEnd || null,
    cadenceMinutes: SWIRLS_RAW_CONTRACT.cadenceMinutes,
    accumulationMinutes: SWIRLS_RAW_CONTRACT.accumulationMinutes,
    unit: frame?.unit || SWIRLS_RAW_CONTRACT.unit,
    location: { lat: latitude, lon: longitude },
    interpolation: 'bilinear-grid-centres',
    amountMm: round(amountMm, 3),
    clampedToGridCentreBoundary: Math.abs(latitude - clampedLat) > EPSILON || Math.abs(longitude - clampedLon) > EPSILON
  };
}

function valueAt(values, cols, row, col) {
  const value = Number(values[row * cols + col]);
  if (!Number.isFinite(value)) throw new Error('SWIRLS point sample encountered a non-finite grid value');
  return value;
}

function bracketAscending(axis, target) {
  if (target <= axis[0]) return [0, 0];
  if (target >= axis.at(-1)) return [axis.length - 1, axis.length - 1];
  let low = 0;
  let high = axis.length - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (axis[mid] <= target) low = mid;
    else high = mid;
  }
  return [low, high];
}

function bracketDescending(axis, target) {
  if (target >= axis[0]) return [0, 0];
  if (target <= axis.at(-1)) return [axis.length - 1, axis.length - 1];
  let low = 0;
  let high = axis.length - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (axis[mid] >= target) low = mid;
    else high = mid;
  }
  return [low, high];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
