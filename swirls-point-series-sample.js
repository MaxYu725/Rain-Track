import { SWIRLS_RAW_CONTRACT } from './swirls-data.js';

const EPSILON = 1e-9;
const HEADER_RE = /SL-RF\s+DMO\s+(20\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})/;
const NEIGHBOR_RADIUS = 2;

// Compact Rain Home path: read one interpolated value directly from native
// SWIRLS MDL text. It deliberately does not build the 121x121 decoded frame.
export function sampleSwirlsMdlPoint(indexData, frameIndex, mdlText, lat, lon) {
  if (!indexData || !Array.isArray(indexData.frames)) throw new Error('SWIRLS index data is required');
  const frame = indexData.frames.find(item => item.frameIndex === Number(frameIndex));
  if (!frame) throw new Error(`SWIRLS frame ${frameIndex} is not present in the index`);

  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('SWIRLS point sample requires finite lat/lon');
  }

  const coverage = SWIRLS_RAW_CONTRACT.coverage;
  if (latitude < coverage.minLat || latitude > coverage.maxLat || longitude < coverage.minLon || longitude > coverage.maxLon) {
    throw new Error('SWIRLS point is outside frame coverage');
  }

  const source = String(mdlText || '').replace(/\r/g, '');
  const header = source.match(HEADER_RE);
  if (!header) throw new Error('SWIRLS MDL header is missing or invalid');
  const runTime = parseHktParts(header[1], header[2], header[3], header[4], header[5]);
  if (!runTime) throw new Error('SWIRLS MDL run time is invalid');
  if (runTime !== indexData.inferredRunTime) {
    throw new Error(`SWIRLS run time mismatch: index infers ${indexData.inferredRunTime}, MDL reports ${runTime}`);
  }

  const rows = SWIRLS_RAW_CONTRACT.rows;
  const cols = SWIRLS_RAW_CONTRACT.cols;
  const rowEstimate = (coverage.maxLat - latitude) / (coverage.maxLat - coverage.minLat) * (rows - 1);
  const colEstimate = (longitude - coverage.minLon) / (coverage.maxLon - coverage.minLon) * (cols - 1);
  const candidateRows = localIndexes(rowEstimate, rows);
  const candidateCols = localIndexes(colEstimate, cols);
  const wantedOrdinals = new Set();
  for (const row of candidateRows) for (const col of candidateCols) wantedOrdinals.add(row * cols + col);

  const cells = selectNativeGridCells(source, header.index, wantedOrdinals);
  const rowEntries = candidateRows.map(row => {
    const first = cells.get(row * cols + candidateCols[0]);
    if (!first) throw new Error(`SWIRLS MDL fast sample is missing row ${row}`);
    for (const col of candidateCols) {
      const cell = cells.get(row * cols + col);
      if (!cell || Math.abs(cell.lat - first.lat) > 1e-6) throw new Error('SWIRLS MDL row geometry is inconsistent');
    }
    return { index:row, value:first.lat };
  });
  const colEntries = candidateCols.map(col => {
    const first = cells.get(candidateRows[0] * cols + col);
    if (!first) throw new Error(`SWIRLS MDL fast sample is missing column ${col}`);
    for (const row of candidateRows) {
      const cell = cells.get(row * cols + col);
      if (!cell || Math.abs(cell.lon - first.lon) > 1e-6) throw new Error('SWIRLS MDL column geometry is inconsistent');
    }
    return { index:col, value:first.lon };
  });

  validateMonotonic(rowEntries, true, 'latitude');
  validateMonotonic(colEntries, false, 'longitude');
  const [row0, row1] = bracketEntries(rowEntries, latitude, true);
  const [col0, col1] = bracketEntries(colEntries, longitude, false);

  const q00 = cellAt(cells, row0, col0, cols).rainfall;
  const q01 = cellAt(cells, row0, col1, cols).rainfall;
  const q10 = cellAt(cells, row1, col0, cols).rainfall;
  const q11 = cellAt(cells, row1, col1, cols).rainfall;
  const lat0 = cellAt(cells, row0, col0, cols).lat;
  const lat1 = cellAt(cells, row1, col0, cols).lat;
  const lon0 = cellAt(cells, row0, col0, cols).lon;
  const lon1 = cellAt(cells, row0, col1, cols).lon;
  const tx = Math.abs(lon1 - lon0) < EPSILON ? 0 : (longitude - lon0) / (lon1 - lon0);
  const ty = Math.abs(lat1 - lat0) < EPSILON ? 0 : (latitude - lat0) / (lat1 - lat0);
  const north = q00 * (1 - tx) + q01 * tx;
  const south = q10 * (1 - tx) + q11 * tx;
  const amountMm = Math.max(0, north * (1 - ty) + south * ty);

  return {
    contractVersion:SWIRLS_RAW_CONTRACT.version,
    frameIndex:frame.frameIndex,
    runTime,
    validTime:frame.validTime,
    leadMinutes:frame.leadMinutes,
    windowStart:frame.windowStart,
    windowEnd:frame.windowEnd,
    cadenceMinutes:SWIRLS_RAW_CONTRACT.cadenceMinutes,
    accumulationMinutes:SWIRLS_RAW_CONTRACT.accumulationMinutes,
    unit:SWIRLS_RAW_CONTRACT.unit,
    location:{ lat:latitude, lon:longitude },
    interpolation:'bilinear-grid-centres',
    amountMm:round(amountMm, 3),
    clampedToGridCentreBoundary:false
  };
}

function selectNativeGridCells(source, headerOffset, wantedOrdinals) {
  const headerEnd = source.indexOf('\n', headerOffset);
  if (headerEnd < 0) throw new Error('SWIRLS MDL contains no grid points');

  const selected = new Map();
  let dataIndex = 0;
  let start = headerEnd + 1;
  while (start <= source.length) {
    let end = source.indexOf('\n', start);
    if (end < 0) end = source.length;
    let left = start;
    let right = end;
    while (left < right && isSpaceCode(source.charCodeAt(left))) left += 1;
    while (right > left && isSpaceCode(source.charCodeAt(right - 1))) right -= 1;
    if (right > left) {
      if (dataIndex >= SWIRLS_RAW_CONTRACT.cellCount) throw new Error('SWIRLS MDL grid contains too many points');
      if (wantedOrdinals.has(dataIndex)) selected.set(dataIndex, parseNativeGridLine(source.slice(left, right)));
      dataIndex += 1;
    }
    if (end === source.length) break;
    start = end + 1;
  }

  if (dataIndex !== SWIRLS_RAW_CONTRACT.cellCount) {
    throw new Error(`SWIRLS MDL grid incomplete: expected ${SWIRLS_RAW_CONTRACT.cellCount} points, received ${dataIndex}`);
  }
  if (selected.size !== wantedOrdinals.size) throw new Error('SWIRLS MDL fast sample did not collect the requested cells');
  return selected;
}

function parseNativeGridLine(line) {
  const parts = line.trim().split(/\s+/);
  if (parts.length !== 3) throw new Error('SWIRLS MDL fast sample encountered a malformed grid point');
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  const rainfall = Number(parts[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(rainfall) || rainfall < 0 || rainfall > 1000) {
    throw new Error('SWIRLS MDL fast sample encountered an invalid grid point');
  }
  return { lon, lat, rainfall };
}

function localIndexes(estimate, length) {
  const centre = Math.floor(Number(estimate));
  const start = Math.max(0, centre - NEIGHBOR_RADIUS);
  const end = Math.min(length - 1, centre + NEIGHBOR_RADIUS + 1);
  return Array.from({ length:end - start + 1 }, (_, offset) => start + offset);
}

function validateMonotonic(entries, descending, label) {
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1].value;
    const current = entries[index].value;
    if (descending ? current >= previous : current <= previous) {
      throw new Error(`SWIRLS MDL ${label} axis is not monotonic`);
    }
  }
}

function bracketEntries(entries, target, descending) {
  for (const entry of entries) if (Math.abs(entry.value - target) < EPSILON) return [entry.index, entry.index];
  for (let index = 0; index < entries.length - 1; index += 1) {
    const first = entries[index];
    const second = entries[index + 1];
    const inside = descending
      ? first.value >= target && target >= second.value
      : first.value <= target && target <= second.value;
    if (inside) return [first.index, second.index];
  }
  throw new Error('SWIRLS MDL fast sample could not bracket the requested point');
}

function cellAt(cells, row, col, cols) {
  const cell = cells.get(row * cols + col);
  if (!cell) throw new Error('SWIRLS MDL fast sample is missing an interpolation cell');
  return cell;
}

function isSpaceCode(code) {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function parseHktParts(year, month, day, hour, minute) {
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
