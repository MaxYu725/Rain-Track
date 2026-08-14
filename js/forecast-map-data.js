export const FORECAST_MAP_CONTRACT = Object.freeze({
  version: '1.0',
  unit: 'mm / 30 min',
  horizonMinutes: 120,
  nominalLeadMinutes: [30, 60, 90, 120],
  orientation: 'row-major-north-to-south-west-to-east'
});

function key(lat, lon) {
  return `${Number(lat).toFixed(6)}|${Number(lon).toFixed(6)}`;
}

function round6(value) {
  return Number(Number(value).toFixed(6));
}

function axisFromGrid(min, max, step) {
  if (![min, max, step].every(Number.isFinite) || step <= 0 || max < min) return [];
  const count = Math.round((max - min) / step) + 1;
  if (count < 2 || count > 1000) return [];
  return Array.from({ length:count }, (_, index) => round6(min + index * step));
}

function deriveAxes(grid, frames) {
  let latitudes = axisFromGrid(Number(grid?.minLat), Number(grid?.maxLat), Number(grid?.stepLat));
  let longitudes = axisFromGrid(Number(grid?.minLon), Number(grid?.maxLon), Number(grid?.stepLon));

  if (latitudes.length > 1 && longitudes.length > 1) return { latitudes, longitudes };

  const allPoints = frames.flatMap(frame => Array.isArray(frame?.points) ? frame.points : []);
  latitudes = [...new Set(allPoints.map(point => round6(point?.[0])).filter(Number.isFinite))].sort((a, b) => a - b);
  longitudes = [...new Set(allPoints.map(point => round6(point?.[1])).filter(Number.isFinite))].sort((a, b) => a - b);
  return { latitudes, longitudes };
}

function normalizeLeadMinutes(frame, issueTime) {
  const explicit = Number(frame?.leadMinutes);
  if (Number.isFinite(explicit)) return Math.round(explicit);
  const issueMs = Date.parse(issueTime || '');
  const frameMs = Date.parse(frame?.time || '');
  return Number.isFinite(issueMs) && Number.isFinite(frameMs)
    ? Math.round((frameMs - issueMs) / 60000)
    : null;
}

export function compactForecastGrid({ issueTime, unit = FORECAST_MAP_CONTRACT.unit, grid = {}, frames = [] } = {}) {
  const normalizedFrames = Array.isArray(frames)
    ? frames.map(frame => ({ ...frame, leadMinutes:normalizeLeadMinutes(frame, issueTime) }))
    : [];
  const { latitudes, longitudes } = deriveAxes(grid, normalizedFrames);
  const northToSouth = [...latitudes].sort((a, b) => b - a);
  const westToEast = [...longitudes].sort((a, b) => a - b);
  const rows = northToSouth.length;
  const cols = westToEast.length;
  const expectedCellCount = rows * cols;
  const coordinateKeys = northToSouth.flatMap(lat => westToEast.map(lon => key(lat, lon)));

  const frameByLead = new Map();
  for (const frame of normalizedFrames) {
    if (FORECAST_MAP_CONTRACT.nominalLeadMinutes.includes(frame.leadMinutes) && !frameByLead.has(frame.leadMinutes)) {
      frameByLead.set(frame.leadMinutes, frame);
    }
  }

  const compactFrames = FORECAST_MAP_CONTRACT.nominalLeadMinutes
    .map(leadMinutes => frameByLead.get(leadMinutes))
    .filter(Boolean)
    .map((frame, index) => {
      const pointIndex = new Map();
      let invalidPointCount = 0;
      for (const point of Array.isArray(frame.points) ? frame.points : []) {
        const lat = Number(point?.[0]);
        const lon = Number(point?.[1]);
        const value = Number(point?.[2]);
        if (![lat, lon, value].every(Number.isFinite) || value < 0) {
          invalidPointCount += 1;
          continue;
        }
        pointIndex.set(key(lat, lon), value);
      }

      let missingValueCount = 0;
      const values = coordinateKeys.map(cellKey => {
        const value = pointIndex.get(cellKey);
        if (!Number.isFinite(value)) {
          missingValueCount += 1;
          return null;
        }
        return value;
      });
      const sourcePointCount = Array.isArray(frame.points) ? frame.points.length : 0;
      const duplicatePointCount = Math.max(0, sourcePointCount - invalidPointCount - pointIndex.size);

      return {
        index,
        time: frame.time,
        leadMinutes: frame.leadMinutes,
        values,
        diagnostics: {
          sourcePointCount,
          uniquePointCount: pointIndex.size,
          duplicatePointCount,
          invalidPointCount,
          valueCount: values.length,
          missingValueCount
        }
      };
    });

  const expectedLeadMinutesPresent = compactFrames.length === FORECAST_MAP_CONTRACT.nominalLeadMinutes.length
    && FORECAST_MAP_CONTRACT.nominalLeadMinutes.every((lead, index) => compactFrames[index]?.leadMinutes === lead);
  const completeFrames = compactFrames.length > 0 && expectedCellCount > 0 && compactFrames.every(frame =>
    frame.diagnostics.sourcePointCount === expectedCellCount
      && frame.diagnostics.uniquePointCount === expectedCellCount
      && frame.diagnostics.duplicatePointCount === 0
      && frame.diagnostics.invalidPointCount === 0
      && frame.diagnostics.valueCount === expectedCellCount
      && frame.diagnostics.missingValueCount === 0
  );

  const rawStepLat = Number(grid?.stepLat) || (latitudes.length > 1 ? Math.abs(latitudes[1] - latitudes[0]) : null);
  const rawStepLon = Number(grid?.stepLon) || (longitudes.length > 1 ? Math.abs(longitudes[1] - longitudes[0]) : null);
  const stepLat = Number.isFinite(rawStepLat) ? round6(rawStepLat) : null;
  const stepLon = Number.isFinite(rawStepLon) ? round6(rawStepLon) : null;
  const minLat = latitudes.length ? Math.min(...latitudes) : null;
  const maxLat = latitudes.length ? Math.max(...latitudes) : null;
  const minLon = longitudes.length ? Math.min(...longitudes) : null;
  const maxLon = longitudes.length ? Math.max(...longitudes) : null;
  const reasonableSize = expectedCellCount > 0 && expectedCellCount <= 40000;

  return {
    contractVersion: FORECAST_MAP_CONTRACT.version,
    issueTime,
    unit: unit || FORECAST_MAP_CONTRACT.unit,
    horizonMinutes: FORECAST_MAP_CONTRACT.horizonMinutes,
    grid: {
      rows,
      cols,
      stepLat,
      stepLon,
      orientation: FORECAST_MAP_CONTRACT.orientation,
      latitudes: northToSouth,
      longitudes: westToEast,
      bounds: {
        north: Number.isFinite(maxLat) && Number.isFinite(stepLat) ? round6(maxLat + stepLat / 2) : maxLat,
        south: Number.isFinite(minLat) && Number.isFinite(stepLat) ? round6(minLat - stepLat / 2) : minLat,
        east: Number.isFinite(maxLon) && Number.isFinite(stepLon) ? round6(maxLon + stepLon / 2) : maxLon,
        west: Number.isFinite(minLon) && Number.isFinite(stepLon) ? round6(minLon - stepLon / 2) : minLon
      }
    },
    frames: compactFrames,
    validation: {
      completeFrames,
      expectedLeadMinutesPresent,
      reasonableSize,
      nominalLeadMinutes: FORECAST_MAP_CONTRACT.nominalLeadMinutes,
      readyForOverlay: rows > 1 && cols > 1 && reasonableSize && completeFrames && expectedLeadMinutesPresent
    }
  };
}

export function normalizeNowcastPayload(data) {
  if (!data || !Array.isArray(data.frames)) throw new Error('兩小時預報回應缺少 frames');
  const issueTime = data.issueTime || data.baseTime || null;
  if (!issueTime || !Number.isFinite(Date.parse(issueTime))) throw new Error('兩小時預報缺少有效基準時間');

  const compact = compactForecastGrid({
    issueTime,
    unit:data.unit || FORECAST_MAP_CONTRACT.unit,
    grid:data.grid || {},
    frames:data.frames
  });
  if (!compact.validation.readyForOverlay) throw new Error('官方兩小時預報格點不完整，暫不顯示地圖');
  return compact;
}
