import { prepareForecastCanvasFrame, copyForecastCanvasPixels } from './forecast-map-canvas.js';

export function renderForecastFrameToCanvas(canvas, frame, grid) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new Error('預報 Canvas 元素無效');
  }

  const prepared = prepareForecastCanvasFrame(frame, grid);
  canvas.width = prepared.width;
  canvas.height = prepared.height;

  const context = canvas.getContext('2d', { alpha:true });
  if (!context) throw new Error('瀏覽器不支援 Canvas 2D');

  const imageData = context.createImageData(prepared.width, prepared.height);
  copyForecastCanvasPixels(imageData.data, prepared);
  context.putImageData(imageData, 0, 0);

  return {
    canvas,
    width:prepared.width,
    height:prepared.height,
    wetCellCount:prepared.wetCellCount,
    dryCellCount:prepared.dryCellCount,
    maxMm:prepared.maxMm
  };
}
