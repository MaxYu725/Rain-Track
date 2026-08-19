import { SWIRLS_RAW_CONTRACT } from './swirls-data.js';
import { buildSwirlsPointSeries } from './swirls-point-series.js';

export const SWIRLS_SNAPSHOT_SCHEMA_VERSION = '1.0';
export const SWIRLS_SNAPSHOT_KEY = 'swirls:snapshot:complete:v1';
export const SWIRLS_SNAPSHOT_STATUS_KEY = 'swirls:snapshot:status:v1';
export const SWIRLS_SNAPSHOT_MAX_AGE_MINUTES = 18;
const DEFAULT_MAX_CONCURRENT = 3;

export async function buildCompleteSwirlsSnapshot({
  runtime,
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
  now = () => new Date(),
} = {}) {
  if (!runtime || typeof runtime.loadFrame !== 'function') {
    throw new Error('SWIRLS snapshot requires a runtime with loadFrame()');
  }

  const concurrency = Math.max(1, Math.min(4, Number(maxConcurrent) || DEFAULT_MAX_CONCURRENT));
  const frames = new Array(SWIRLS_RAW_CONTRACT.frameCount);
  for (let start = 0; start < frames.length; start += concurrency) {
    const indexes = Array.from(
      { length: Math.min(concurrency, frames.length - start) },
      (_, offset) => start + offset,
    );
    const loaded = await Promise.all(indexes.map(index => runtime.loadFrame(index)));
    loaded.forEach((frame, offset) => { frames[indexes[offset]] = frame; });
  }

  return normalizeCompleteSnapshot(frames, now());
}

export function normalizeCompleteSnapshot(frames, builtAt = new Date()) {
  if (!Array.isArray(frames) || frames.length !== SWIRLS_RAW_CONTRACT.frameCount) {
    throw new Error(`Complete SWIRLS snapshot requires ${SWIRLS_RAW_CONTRACT.frameCount} frames`);
  }

  const ordered = [...frames].sort((a, b) => Number(a?.frameIndex) - Number(b?.frameIndex));
  const first = ordered[0];
  if (!first?.grid) throw new Error('SWIRLS snapshot frame grid is missing');
  const runTimes = new Set(ordered.map(frame => frame?.runTime).filter(Boolean));
  if (runTimes.size !== 1) throw new Error('Complete SWIRLS snapshot contains mixed runs');

  const grid = cloneGrid(first.grid);
  const normalizedFrames = ordered.map((frame, index) => {
    if (Number(frame?.frameIndex) !== index) throw new Error(`SWIRLS snapshot missing frame ${index}`);
    if (frame.runTime !== first.runTime) throw new Error('Complete SWIRLS snapshot contains mixed runs');
    assertCompatibleGrid(grid, frame.grid);
    const expectedLead = SWIRLS_RAW_CONTRACT.firstLeadMinutes + index * SWIRLS_RAW_CONTRACT.cadenceMinutes;
    if (Number(frame.leadMinutes) !== expectedLead) {
      throw new Error(`SWIRLS snapshot frame ${index} lead mismatch`);
    }
    if (frame.unit !== SWIRLS_RAW_CONTRACT.unit) throw new Error(`SWIRLS snapshot frame ${index} unit mismatch`);
    if (!Array.isArray(frame.values) || frame.values.length !== grid.rows * grid.cols) {
      throw new Error(`SWIRLS snapshot frame ${index} grid payload mismatch`);
    }
    return {
      frameIndex: index,
      validTime: frame.validTime,
      leadMinutes: frame.leadMinutes,
      windowStart: frame.windowStart,
      windowEnd: frame.windowEnd,
      values: frame.values.map(value => Number(value)),
    };
  });

  const built = builtAt instanceof Date ? builtAt : new Date(builtAt);
  if (!Number.isFinite(built.getTime())) throw new Error('SWIRLS snapshot builtAt is invalid');

  return {
    schemaVersion: SWIRLS_SNAPSHOT_SCHEMA_VERSION,
    contractVersion: SWIRLS_RAW_CONTRACT.version,
    runTime: first.runTime,
    builtAt: built.toISOString(),
    cadenceMinutes: SWIRLS_RAW_CONTRACT.cadenceMinutes,
    accumulationMinutes: SWIRLS_RAW_CONTRACT.accumulationMinutes,
    unit: SWIRLS_RAW_CONTRACT.unit,
    grid,
    frames: normalizedFrames,
  };
}

export function buildPointSeriesFromSnapshot(snapshot, latitude, longitude) {
  assertSnapshotShape(snapshot);
  const frames = snapshot.frames.map(frame => ({
    ...frame,
    runTime: snapshot.runTime,
    unit: snapshot.unit,
    grid: snapshot.grid,
  }));
  return buildSwirlsPointSeries({ frames, latitude, longitude });
}

export function snapshotAgeMinutes(snapshot, nowEpochMs = Date.now()) {
  const builtAt = Date.parse(snapshot?.builtAt || '');
  if (!Number.isFinite(builtAt)) return Infinity;
  return Math.max(0, (Number(nowEpochMs) - builtAt) / 60_000);
}

export function snapshotIsFresh(
  snapshot,
  nowEpochMs = Date.now(),
  maxAgeMinutes = SWIRLS_SNAPSHOT_MAX_AGE_MINUTES,
) {
  try {
    assertSnapshotShape(snapshot);
  } catch {
    return false;
  }
  return snapshotAgeMinutes(snapshot, nowEpochMs) <= Math.max(1, Number(maxAgeMinutes) || SWIRLS_SNAPSHOT_MAX_AGE_MINUTES);
}

export function snapshotMetadata(snapshot, nowEpochMs = Date.now()) {
  if (!snapshot) return null;
  return {
    schemaVersion: snapshot.schemaVersion || null,
    runTime: snapshot.runTime || null,
    builtAt: snapshot.builtAt || null,
    ageMinutes: Number(snapshotAgeMinutes(snapshot, nowEpochMs).toFixed(2)),
    frameCount: Array.isArray(snapshot.frames) ? snapshot.frames.length : 0,
    fresh: snapshotIsFresh(snapshot, nowEpochMs),
  };
}

function assertSnapshotShape(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== SWIRLS_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error('SWIRLS snapshot schema mismatch');
  }
  if (!snapshot.runTime || !snapshot.builtAt) throw new Error('SWIRLS snapshot metadata is incomplete');
  if (snapshot.cadenceMinutes !== SWIRLS_RAW_CONTRACT.cadenceMinutes) throw new Error('SWIRLS snapshot cadence mismatch');
  if (snapshot.accumulationMinutes !== SWIRLS_RAW_CONTRACT.accumulationMinutes) {
    throw new Error('SWIRLS snapshot accumulation mismatch');
  }
  if (snapshot.unit !== SWIRLS_RAW_CONTRACT.unit) throw new Error('SWIRLS snapshot unit mismatch');
  if (!snapshot.grid || !Array.isArray(snapshot.grid.latitudes) || !Array.isArray(snapshot.grid.longitudes)) {
    throw new Error('SWIRLS snapshot grid is invalid');
  }
  if (!Array.isArray(snapshot.frames) || snapshot.frames.length !== SWIRLS_RAW_CONTRACT.frameCount) {
    throw new Error('SWIRLS snapshot is incomplete');
  }
}

function cloneGrid(grid) {
  if (!Number.isInteger(grid.rows) || !Number.isInteger(grid.cols)) throw new Error('SWIRLS snapshot grid shape is invalid');
  if (!Array.isArray(grid.latitudes) || grid.latitudes.length !== grid.rows) throw new Error('SWIRLS snapshot latitude axis mismatch');
  if (!Array.isArray(grid.longitudes) || grid.longitudes.length !== grid.cols) throw new Error('SWIRLS snapshot longitude axis mismatch');
  return {
    rows: grid.rows,
    cols: grid.cols,
    cellCount: grid.cellCount ?? grid.rows * grid.cols,
    orientation: grid.orientation,
    latitudes: grid.latitudes.map(Number),
    longitudes: grid.longitudes.map(Number),
    stepLat: grid.stepLat,
    stepLon: grid.stepLon,
    bounds: grid.bounds ? { ...grid.bounds } : null,
  };
}

function assertCompatibleGrid(reference, candidate) {
  if (!candidate || reference.rows !== candidate.rows || reference.cols !== candidate.cols) {
    throw new Error('SWIRLS snapshot grid shape changed within run');
  }
  if (!sameAxis(reference.latitudes, candidate.latitudes) || !sameAxis(reference.longitudes, candidate.longitudes)) {
    throw new Error('SWIRLS snapshot grid axes changed within run');
  }
}

function sameAxis(first, second) {
  if (!Array.isArray(second) || first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (Math.abs(Number(first[index]) - Number(second[index])) > 1e-9) return false;
  }
  return true;
}
