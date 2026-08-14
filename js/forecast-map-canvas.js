import { rasterizeForecastFrame } from './forecast-map-renderer.js';

export function prepareForecastCanvasFrame(frame, grid) {
  const raster = rasterizeForecastFrame(frame, grid);
  const pixelCount = raster.width * raster.height;
  return {
    width:raster.width,
    height:raster.height,
    rowStride:raster.width * 4,
    pixelCount,
    byteLength:pixelCount * 4,
    rgba:new Uint8ClampedArray(raster.rgba),
    wetCellCount:raster.wetCellCount,
    dryCellCount:raster.dryCellCount,
    maxMm:raster.maxMm
  };
}

export function validateForecastCanvasFrame(prepared) {
  const width = Number(prepared?.width);
  const height = Number(prepared?.height);
  const rowStride = Number(prepared?.rowStride);
  const pixelCount = Number(prepared?.pixelCount);
  const byteLength = Number(prepared?.byteLength);
  const rgba = prepared?.rgba;

  if (!Number.isInteger(width) || width < 2) throw new Error('預報 Canvas width 無效');
  if (!Number.isInteger(height) || height < 2) throw new Error('預報 Canvas height 無效');
  if (rowStride !== width * 4) throw new Error('預報 Canvas row stride 無效');
  if (pixelCount !== width * height) throw new Error('預報 Canvas pixel count 無效');
  if (byteLength !== pixelCount * 4) throw new Error('預報 Canvas byte length 無效');
  if (!(rgba instanceof Uint8ClampedArray) || rgba.length !== byteLength) {
    throw new Error('預報 Canvas RGBA buffer 無效');
  }
  return { width, height, rowStride, pixelCount, byteLength };
}

export function copyForecastCanvasPixels(target, prepared) {
  const validated = validateForecastCanvasFrame(prepared);
  if (!(target instanceof Uint8ClampedArray)) throw new Error('Canvas pixel target 無效');
  if (target.length !== validated.byteLength) throw new Error('Canvas pixel target 大小不符');
  target.set(prepared.rgba);
  return validated;
}
