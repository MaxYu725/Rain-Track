export const FORECAST_RAIN_SCALE = Object.freeze([
  { min:0.05, rgba:[36, 162, 214, 210] },
  { min:0.2, rgba:[34, 187, 214, 220] },
  { min:0.5, rgba:[41, 199, 104, 225] },
  { min:1, rgba:[111, 207, 58, 230] },
  { min:2, rgba:[232, 204, 50, 235] },
  { min:5, rgba:[246, 147, 45, 240] },
  { min:10, rgba:[235, 72, 58, 245] }
]);

const TRANSPARENT = Object.freeze([0, 0, 0, 0]);

export function rainfallToRgba(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < FORECAST_RAIN_SCALE[0].min) return [...TRANSPARENT];

  let selected = FORECAST_RAIN_SCALE[0].rgba;
  for (const stop of FORECAST_RAIN_SCALE) {
    if (amount < stop.min) break;
    selected = stop.rgba;
  }
  return [...selected];
}

export function validateRasterFrame(frame, grid) {
  const rows = Number(grid?.rows);
  const cols = Number(grid?.cols);
  const values = frame?.values;
  if (!Number.isInteger(rows) || rows < 2 || rows > 1000) throw new Error('預報圖層 rows 無效');
  if (!Number.isInteger(cols) || cols < 2 || cols > 1000) throw new Error('預報圖層 cols 無效');
  if (!Array.isArray(values)) throw new Error('預報圖層 frame 缺少 values');
  const expected = rows * cols;
  if (expected > 40000) throw new Error('預報圖層格點數量過大');
  if (values.length !== expected) throw new Error(`預報圖層 values 數量不符：${values.length}/${expected}`);
  if (values.some(value => !Number.isFinite(Number(value)) || Number(value) < 0)) {
    throw new Error('預報圖層含有無效雨量值');
  }
  return { rows, cols, expected };
}

export function rasterizeForecastFrame(frame, grid) {
  const { rows, cols, expected } = validateRasterFrame(frame, grid);
  const rgba = new Uint8ClampedArray(expected * 4);
  let wetCellCount = 0;
  let maxMm = 0;

  for (let index = 0; index < expected; index += 1) {
    const amount = Number(frame.values[index]);
    if (amount >= FORECAST_RAIN_SCALE[0].min) wetCellCount += 1;
    if (amount > maxMm) maxMm = amount;
    const color = rainfallToRgba(amount);
    const offset = index * 4;
    rgba[offset] = color[0];
    rgba[offset + 1] = color[1];
    rgba[offset + 2] = color[2];
    rgba[offset + 3] = color[3];
  }

  return {
    width:cols,
    height:rows,
    rgba,
    wetCellCount,
    dryCellCount:expected - wetCellCount,
    maxMm
  };
}

export function forecastWindow(frame) {
  const end = new Date(frame?.time || '');
  if (Number.isNaN(end.getTime())) return null;
  return {
    start:new Date(end.getTime() - 30 * 60 * 1000).toISOString(),
    end:end.toISOString()
  };
}
