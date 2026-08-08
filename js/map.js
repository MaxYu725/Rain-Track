import { DEFAULT_POINT, SUPPORTED_BOUNDS } from './config.js';
import { state } from './state.js';
import { formatLatLon, isMobileLayout } from './utils.js';

function leaflet() {
  if (!window.L) throw new Error('Leaflet 地圖程式未能載入');
  return window.L;
}

export function initMap({ onSelect }) {
  const L = leaflet();
  state.map = L.map('rain-map', {
    zoomControl:true,
    attributionControl:true,
    preferCanvas:true,
    minZoom:8,
    maxZoom:18,
    maxBounds:[[SUPPORTED_BOUNDS.south - 1, SUPPORTED_BOUNDS.west - 1],[SUPPORTED_BOUNDS.north + 1, SUPPORTED_BOUNDS.east + 1]],
    maxBoundsViscosity:.25
  }).setView([state.selected.lat, state.selected.lon], 12);

  state.mapLayers.darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains:'abcd', maxZoom:20, attribution:'© OpenStreetMap © CARTO'
  });
  state.mapLayers.lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    subdomains:'abcd', maxZoom:20, attribution:'© OpenStreetMap © CARTO'
  });
  (state.activeTiles === 'light' ? state.mapLayers.lightTiles : state.mapLayers.darkTiles).addTo(state.map);

  state.mapLayers.radius = L.layerGroup().addTo(state.map);
  state.mapLayers.accuracy = L.layerGroup().addTo(state.map);
  state.mapLayers.coverage = L.layerGroup().addTo(state.map);
  state.mapLayers.marker = L.layerGroup().addTo(state.map);

  state.map.on('click', event => onSelect?.(event.latlng.lat, event.latlng.lng));
  state.map.on('mousemove', event => {
    const readout = document.getElementById('coordinate-readout');
    if (readout) readout.textContent = formatLatLon(event.latlng.lat, event.latlng.lng);
  });
  state.map.on('mouseout', () => {
    const readout = document.getElementById('coordinate-readout');
    if (readout) readout.textContent = '—';
  });
  renderPointLayers();
  return state.map;
}

export function renderPointLayers() {
  if (!state.map) return;
  const L = leaflet();
  const { marker, radius, accuracy, coverage } = state.mapLayers;
  marker?.clearLayers(); radius?.clearLayers(); accuracy?.clearLayers(); coverage?.clearLayers();
  const center = [state.selected.lat, state.selected.lon];

  if (state.layers.radius) {
    L.circle(center, {
      radius:state.radiusKm * 1000, color:'#1ba1e2', weight:1.25, opacity:.58,
      dashArray:'7,8', fillColor:'#1ba1e2', fillOpacity:.035, interactive:false
    }).addTo(radius);
    const northLat = state.selected.lat + state.radiusKm / 110.574;
    const label = L.divIcon({ className:'', html:`<div class="radius-label" style="opacity:.72">附近 ${state.radiusKm} km</div>`, iconSize:[86,22], iconAnchor:[43,11] });
    L.marker([northLat, state.selected.lon], { icon:label, interactive:false, zIndexOffset:300 }).addTo(radius);
  }

  if (state.layers.marker) {
    const icon = L.divIcon({ className:'', html:'<div class="selected-pin"></div>', iconSize:[24,24], iconAnchor:[12,12] });
    L.marker(center, { icon, zIndexOffset:1000 })
      .bindTooltip(state.selected.name, { permanent:true, direction:'right', className:'point-label', offset:[12,0] })
      .addTo(marker);
  }

  if (Number.isFinite(state.accuracyMeters) && state.accuracyMeters > 0) {
    L.circle(center, {
      radius:state.accuracyMeters, color:'#7fe7ff', weight:1, opacity:.58,
      fillColor:'#7fe7ff', fillOpacity:.05, interactive:false
    }).addTo(accuracy);
  }

  if (state.layers.coverage && state.forecast?.grid) renderCoverage(state.forecast.grid);
}

export function renderCoverage(grid) {
  if (!state.map || !state.layers.coverage || !grid) return;
  const values = [grid.minLat, grid.maxLat, grid.minLon, grid.maxLon];
  if (!values.every(Number.isFinite)) return;
  const L = leaflet();
  const bounds = [[grid.minLat, grid.minLon], [grid.maxLat, grid.maxLon]];
  L.rectangle(bounds, { color:'#7fe7ff', weight:1, opacity:.5, dashArray:'5,7', fill:false, interactive:false }).addTo(state.mapLayers.coverage);
}

export function setLocationAccuracy(meters) {
  state.accuracyMeters = Number.isFinite(Number(meters)) ? Number(meters) : null;
  renderPointLayers();
}

export function setLayerVisibility(key, value) {
  if (!(key in state.layers)) return;
  state.layers[key] = Boolean(value);
  renderPointLayers();
}

export function changeRadius(radiusKm) {
  state.radiusKm = [1,2,3,5].includes(Number(radiusKm)) ? Number(radiusKm) : 2;
  localStorage.setItem('hkRainRadiusKm', String(state.radiusKm));
  renderPointLayers();
}

export function centerHongKong() { state.map?.setView([22.35,114.15], 11); }

export function toggleBasemap() {
  if (!state.map) return;
  const useLight = state.activeTiles !== 'light';
  const next = useLight ? state.mapLayers.lightTiles : state.mapLayers.darkTiles;
  const previous = useLight ? state.mapLayers.darkTiles : state.mapLayers.lightTiles;
  if (state.map.hasLayer(previous)) state.map.removeLayer(previous);
  next.addTo(state.map); next.bringToBack();
  state.activeTiles = useLight ? 'light' : 'dark';
  localStorage.setItem('hkRainBasemap', state.activeTiles);
}

export function centerPointForSheet(lat, lon, zoom = 14) {
  if (!state.map) return;
  requestAnimationFrame(() => {
    const map = state.map;
    if (!map) return;
    const L = leaflet();
    const target = L.latLng(lat, lon);
    const targetZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), Number(zoom) || 14));
    map.stop();

    if (!isMobileLayout()) {
      map.setView(target, targetZoom, { animate:false });
      return;
    }

    const panel = document.getElementById('forecast-panel');
    const size = map.getSize();
    const panelHeight = panel?.getBoundingClientRect().height || 0;
    const visibleBottom = Math.max(100, size.y - panelHeight - 14);
    const desiredMarkerY = Math.max(76, visibleBottom * .52);
    const targetPixel = map.project(target, targetZoom);
    const centerPixel = L.point(targetPixel.x, targetPixel.y + size.y / 2 - desiredMarkerY);
    const center = map.unproject(centerPixel, targetZoom);
    map.setView(center, targetZoom, { animate:false });
  });
}

export function keepSelectedVisible(animate = true) {
  if (!isMobileLayout() || !state.map) return;
  const panel = document.getElementById('forecast-panel');
  if (!panel) return;
  const size = state.map.getSize();
  const point = state.map.latLngToContainerPoint([state.selected.lat, state.selected.lon]);
  const visibleBottom = Math.max(100, size.y - panel.getBoundingClientRect().height - 14);
  const targetY = Math.max(76, visibleBottom * .52);
  const delta = point.y - targetY;
  if (Math.abs(delta) > 12) state.map.panBy([0, delta], { animate, duration:.22 });
}

export function invalidateMap() { state.map?.invalidateSize(); }
export function resetPoint() {
  state.selected = { ...DEFAULT_POINT };
  state.accuracyMeters = null;
  renderPointLayers();
  centerPointForSheet(DEFAULT_POINT.lat, DEFAULT_POINT.lon, 13);
}
