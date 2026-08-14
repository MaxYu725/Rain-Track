const FORECAST_PANE = 'forecastMapPane';
const DEFAULT_FORECAST_OPACITY = 0.58;

function leaflet() {
  if (!window.L) throw new Error('Leaflet 地圖程式未能載入');
  return window.L;
}

function clampOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_FORECAST_OPACITY;
  return Math.max(0, Math.min(1, number));
}

export function forecastLeafletBounds(grid) {
  const north = Number(grid?.bounds?.north);
  const south = Number(grid?.bounds?.south);
  const east = Number(grid?.bounds?.east);
  const west = Number(grid?.bounds?.west);
  if (![north, south, east, west].every(Number.isFinite) || north <= south || east <= west) {
    throw new Error('兩小時預報圖層邊界無效');
  }
  return [[south, west], [north, east]];
}

export function ensureForecastMapPane(map, zIndex = 345) {
  if (!map || typeof map.getPane !== 'function' || typeof map.createPane !== 'function') {
    throw new Error('Leaflet 地圖實例無效');
  }
  let pane = map.getPane(FORECAST_PANE);
  if (!pane) pane = map.createPane(FORECAST_PANE);
  pane.style.zIndex = String(Number.isFinite(Number(zIndex)) ? Math.round(Number(zIndex)) : 345);
  pane.style.pointerEvents = 'none';
  pane.style.imageRendering = 'pixelated';
  return pane;
}

export function canvasToForecastImageUrl(canvas) {
  if (!canvas || typeof canvas.toDataURL !== 'function') throw new Error('預報 Canvas 無法輸出影像');
  const width = Number(canvas.width);
  const height = Number(canvas.height);
  if (!Number.isInteger(width) || width < 2 || !Number.isInteger(height) || height < 2) {
    throw new Error('預報 Canvas 尺寸無效');
  }
  const url = canvas.toDataURL('image/png');
  if (typeof url !== 'string' || !url.startsWith('data:image/png')) throw new Error('預報 Canvas PNG 輸出失敗');
  return url;
}

export function upsertForecastOverlay({ map, layer = null, canvas, grid, opacity = DEFAULT_FORECAST_OPACITY } = {}) {
  if (!map || typeof map.hasLayer !== 'function') throw new Error('Leaflet 地圖實例無效');
  const L = leaflet();
  const bounds = forecastLeafletBounds(grid);
  const imageUrl = canvasToForecastImageUrl(canvas);
  const normalizedOpacity = clampOpacity(opacity);
  ensureForecastMapPane(map);

  if (layer && typeof layer.setUrl === 'function' && typeof layer.setBounds === 'function') {
    layer.setUrl(imageUrl);
    layer.setBounds(bounds);
    layer.setOpacity?.(normalizedOpacity);
    if (!map.hasLayer(layer)) layer.addTo(map);
    return layer;
  }

  const next = L.imageOverlay(imageUrl, bounds, {
    opacity:normalizedOpacity,
    interactive:false,
    pane:FORECAST_PANE,
    className:'rain-forecast-overlay'
  }).addTo(map);

  if (layer && map.hasLayer(layer)) map.removeLayer(layer);
  return next;
}

export function setForecastOverlayOpacity(layer, opacity) {
  if (!layer || typeof layer.setOpacity !== 'function') return false;
  layer.setOpacity(clampOpacity(opacity));
  return true;
}

export function removeForecastOverlay(map, layer) {
  if (!map || !layer || typeof map.hasLayer !== 'function') return false;
  if (map.hasLayer(layer)) map.removeLayer(layer);
  return true;
}
