export const SWIRLS_RAW_CONTRACT = Object.freeze({
  version: '1.0',
  indexUrl: 'https://maps.weather.gov.hk/ocf/dat/nc/nc.rf.index.2.txt',
  assetBaseUrl: 'https://maps.weather.gov.hk/ocf/dat/nc/',
  frameCount: 16,
  cadenceMinutes: 6,
  accumulationMinutes: 30,
  firstLeadMinutes: 30,
  lastLeadMinutes: 120,
  rows: 121,
  cols: 121,
  cellCount: 121 * 121,
  unit: 'mm / 30 min',
  orientation: 'row-major-north-to-south-west-to-east',
  coverage: {
    minLat: 21.328,
    maxLat: 23.487,
    minLon: 112.956,
    maxLon: 115.291
  }
});

const INDEX_PNG = /^ncrf_minute00_(\d+)\.png$/;
const INDEX_MDL = /^ncrf_minute00_(\d+)\.af\.mdl$/;
const HEADER_RE = /SL-RF\s+DMO\s+(20\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})/;
const EPSILON = 1e-6;

export function parseSwirlsIndex(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (!lines.length) throw new Error('SWIRLS index is empty');

  const frames = lines.map((line, lineIndex) => {
    const parts = line.split(',').map(part => part.trim());
    if (parts.length !== 3) throw new Error(`SWIRLS index line ${lineIndex + 1} is malformed`);

    const [validToken, pngFile, mdlFile] = parts;
    const validTime = parseHktCompact(validToken);
    if (!validTime) throw new Error(`SWIRLS index line ${lineIndex + 1} has invalid valid time`);

    const pngMatch = pngFile.match(INDEX_PNG);
    const mdlMatch = mdlFile.match(INDEX_MDL);
    if (!pngMatch || !mdlMatch) throw new Error(`SWIRLS index line ${lineIndex + 1} has unexpected asset names`);

    const pngIndex = Number(pngMatch[1]);
    const mdlIndex = Number(mdlMatch[1]);
    if (pngIndex !== mdlIndex) throw new Error(`SWIRLS index line ${lineIndex + 1} asset indices disagree`);

    return {
      frameIndex: mdlIndex,
      validTime,
      pngFile,
      mdlFile,
      pngUrl: new URL(pngFile, SWIRLS_RAW_CONTRACT.assetBaseUrl).toString(),
      mdlUrl: new URL(mdlFile, SWIRLS_RAW_CONTRACT.assetBaseUrl).toString()
    };
  }).sort((a, b) => a.frameIndex - b.frameIndex);

  validateIndexFrames(frames);

  const firstValidMs = Date.parse(frames[0].validTime);
  const inferredRunTime = new Date(firstValidMs - SWIRLS_RAW_CONTRACT.accumulationMinutes * 60_000).toISOString();

  return {
    contractVersion: SWIRLS_RAW_CONTRACT.version,
    parser: 'hko-swirls-index-v1',
    source: SWIRLS_RAW_CONTRACT.indexUrl,
    cadenceMinutes: SWIRLS_RAW_CONTRACT.cadenceMinutes,
    accumulationMinutes: SWIRLS_RAW_CONTRACT.accumulationMinutes,
    unit: SWIRLS_RAW_CONTRACT.unit,
    inferredRunTime,
    frameCount: frames.length,
    frames: frames.map(frame => ({
      ...frame,
      leadMinutes: Math.round((Date.parse(frame.validTime) - Date.parse(inferredRunTime)) / 60_000),
      windowStart: subtractMinutesIso(frame.validTime, SWIRLS_RAW_CONTRACT.accumulationMinutes),
      windowEnd: frame.validTime
    }))
  };
}

export function parseSwirlsMdl(text) {
  const source = unwrapBrowserSavedHtml(String(text || '')).replace(/\r/g, '');
  const header = source.match(HEADER_RE);
  if (!header) throw new Error('SWIRLS MDL header is missing or invalid');

  const runTime = parseHktParts(header[1], header[2], header[3], header[4], header[5]);
  if (!runTime) throw new Error('SWIRLS MDL run time is invalid');

  const points = [];
  let invalidPointCount = 0;
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.includes('SL-RF')) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 3) continue;

    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    const rainfall = Number(parts[2]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(rainfall)) {
      invalidPointCount += 1;
      continue;
    }
    if (lat < 18 || lat > 26 || lon < 110 || lon > 118 || rainfall < 0 || rainfall > 1000) {
      invalidPointCount += 1;
      continue;
    }
    points.push({ lat, lon, rainfall });
  }

  if (invalidPointCount) throw new Error(`SWIRLS MDL contains ${invalidPointCount} invalid grid point(s)`);
  if (!points.length) throw new Error('SWIRLS MDL contains no grid points');

  const latAsc = uniqueSorted(points.map(point => point.lat));
  const lonAsc = uniqueSorted(points.map(point => point.lon));
  const latDesc = [...latAsc].reverse();
  const expectedCellCount = latAsc.length * lonAsc.length;
  const coordSet = new Set();
  let duplicatePointCount = 0;

  for (const point of points) {
    const key = coordKey(point.lat, point.lon);
    if (coordSet.has(key)) duplicatePointCount += 1;
    coordSet.add(key);
  }

  const completeGrid = latAsc.length === SWIRLS_RAW_CONTRACT.rows
    && lonAsc.length === SWIRLS_RAW_CONTRACT.cols
    && points.length === SWIRLS_RAW_CONTRACT.cellCount
    && expectedCellCount === SWIRLS_RAW_CONTRACT.cellCount
    && coordSet.size === SWIRLS_RAW_CONTRACT.cellCount
    && duplicatePointCount === 0;

  if (!completeGrid) {
    throw new Error(`SWIRLS MDL grid incomplete: ${latAsc.length}x${lonAsc.length}, ${points.length} points, ${duplicatePointCount} duplicate(s)`);
  }

  const orientationValid = validateSourceOrientation(points, latDesc, lonAsc);
  if (!orientationValid) throw new Error('SWIRLS MDL grid orientation is unexpected');

  const latEdges = axisEdgeBounds(latAsc);
  const lonEdges = axisEdgeBounds(lonAsc);
  const values = points.map(point => point.rainfall);

  return {
    contractVersion: SWIRLS_RAW_CONTRACT.version,
    parser: 'hko-swirls-af-mdl-v1',
    runTime,
    unit: SWIRLS_RAW_CONTRACT.unit,
    grid: {
      rows: latDesc.length,
      cols: lonAsc.length,
      cellCount: points.length,
      orientation: SWIRLS_RAW_CONTRACT.orientation,
      latitudes: latDesc,
      longitudes: lonAsc,
      stepLat: averageAxisStep(latAsc),
      stepLon: averageAxisStep(lonAsc),
      bounds: {
        south: latEdges.min,
        north: latEdges.max,
        west: lonEdges.min,
        east: lonEdges.max
      }
    },
    values,
    validation: {
      expectedCellCount: SWIRLS_RAW_CONTRACT.cellCount,
      actualCellCount: points.length,
      uniqueCellCount: coordSet.size,
      duplicatePointCount,
      completeGrid,
      orientationValid,
      ready: completeGrid && orientationValid
    }
  };
}

export function bindSwirlsMdlFrame(indexData, frameIndex, mdlText) {
  if (!indexData || !Array.isArray(indexData.frames)) throw new Error('SWIRLS index data is required');
  const frame = indexData.frames.find(item => item.frameIndex === Number(frameIndex));
  if (!frame) throw new Error(`SWIRLS frame ${frameIndex} is not present in the index`);

  const mdl = parseSwirlsMdl(mdlText);
  if (mdl.runTime !== indexData.inferredRunTime) {
    throw new Error(`SWIRLS run time mismatch: index infers ${indexData.inferredRunTime}, MDL reports ${mdl.runTime}`);
  }

  return {
    contractVersion: SWIRLS_RAW_CONTRACT.version,
    frameIndex: frame.frameIndex,
    runTime: mdl.runTime,
    validTime: frame.validTime,
    leadMinutes: frame.leadMinutes,
    windowStart: frame.windowStart,
    windowEnd: frame.windowEnd,
    unit: mdl.unit,
    source: {
      indexUrl: indexData.source,
      mdlUrl: frame.mdlUrl,
      pngUrl: frame.pngUrl
    },
    grid: mdl.grid,
    values: mdl.values,
    validation: {
      ...mdl.validation,
      runTimeMatchesIndex: true
    }
  };
}

function validateIndexFrames(frames) {
  if (frames.length !== SWIRLS_RAW_CONTRACT.frameCount) {
    throw new Error(`SWIRLS index expected ${SWIRLS_RAW_CONTRACT.frameCount} frames, received ${frames.length}`);
  }

  const seen = new Set();
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame.frameIndex !== index) throw new Error(`SWIRLS index is missing or reorders frame ${index}`);
    if (seen.has(frame.validTime)) throw new Error('SWIRLS index contains duplicate valid times');
    seen.add(frame.validTime);

    if (index > 0) {
      const gap = Math.round((Date.parse(frame.validTime) - Date.parse(frames[index - 1].validTime)) / 60_000);
      if (gap !== SWIRLS_RAW_CONTRACT.cadenceMinutes) {
        throw new Error(`SWIRLS index cadence mismatch at frame ${index}: ${gap} minutes`);
      }
    }
  }

  const horizon = Math.round((Date.parse(frames.at(-1).validTime) - Date.parse(frames[0].validTime)) / 60_000)
    + SWIRLS_RAW_CONTRACT.firstLeadMinutes;
  if (horizon !== SWIRLS_RAW_CONTRACT.lastLeadMinutes) {
    throw new Error(`SWIRLS index horizon mismatch: ${horizon} minutes`);
  }
}

function validateSourceOrientation(points, latDesc, lonAsc) {
  if (points.length !== latDesc.length * lonAsc.length) return false;
  let offset = 0;
  for (const lat of latDesc) {
    for (const lon of lonAsc) {
      const point = points[offset++];
      if (Math.abs(point.lat - lat) > EPSILON || Math.abs(point.lon - lon) > EPSILON) return false;
    }
  }
  return true;
}

function uniqueSorted(values) {
  return [...new Set(values.map(value => Number(value.toFixed(6))))].sort((a, b) => a - b);
}

function averageAxisStep(axis) {
  if (!Array.isArray(axis) || axis.length < 2) return null;
  return Number(((axis.at(-1) - axis[0]) / (axis.length - 1)).toFixed(6));
}

function axisEdgeBounds(axis) {
  if (!Array.isArray(axis) || !axis.length) return { min: null, max: null };
  if (axis.length === 1) return { min: axis[0], max: axis[0] };
  const firstGap = axis[1] - axis[0];
  const lastGap = axis.at(-1) - axis.at(-2);
  return {
    min: Number((axis[0] - firstGap / 2).toFixed(6)),
    max: Number((axis.at(-1) + lastGap / 2).toFixed(6))
  };
}

function coordKey(lat, lon) {
  return `${Number(lat).toFixed(6)}|${Number(lon).toFixed(6)}`;
}

function parseHktCompact(value) {
  const match = String(value || '').match(/^(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  return parseHktParts(match[1], match[2], match[3], match[4], match[5]);
}

function parseHktParts(year, month, day, hour, minute) {
  const iso = `${year}-${month}-${day}T${hour}:${minute}:00+08:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function subtractMinutesIso(value, minutes) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time - minutes * 60_000).toISOString();
}

function unwrapBrowserSavedHtml(value) {
  if (!/<html|<body|<!--\s*saved from url=/i.test(value)) return value;
  return value
    .replace(/<!--[^]*?-->/g, '\n')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
