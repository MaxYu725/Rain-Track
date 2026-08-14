import { rasterizeForecastFrame } from './forecast-map-renderer.js';

export function prepareForecastCanvasFrame(frame, grid) {
  return rasterizeForecastFrame(frame, grid);
}
