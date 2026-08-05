import { DEFAULT_API_BASE, DEFAULT_POINT } from './config.js';
import { automaticLocationName, isSupportedPoint, loadJSON } from './utils.js';

function loadInitialPoint() {
  const params = new URLSearchParams(location.search);
  const hasShared = params.get('share') === '1';
  const latRaw = params.get('lat');
  const lonRaw = params.get('lon');
  const lat = latRaw !== null && latRaw.trim() !== '' ? Number(latRaw) : NaN;
  const lon = lonRaw !== null && lonRaw.trim() !== '' ? Number(lonRaw) : NaN;
  const name = (params.get('name') || '').trim();
  if ((hasShared || (latRaw !== null && lonRaw !== null)) && isSupportedPoint(lat, lon)) {
    return { lat, lon, name: name || '分享位置', source:'share' };
  }
  const stored = loadJSON('hkRainLastPoint', null);
  if (stored && isSupportedPoint(Number(stored.lat), Number(stored.lon))) {
    return { lat:Number(stored.lat), lon:Number(stored.lon), name:String(stored.name || '上次位置'), source:'stored' };
  }
  return { ...DEFAULT_POINT, source:'default' };
}

function loadSavedPoints() {
  const current = loadJSON('hkRainSavedPoints', null);
  if (Array.isArray(current)) return current;
  const legacy = loadJSON('hkRadarSavedPoints', []);
  return Array.isArray(legacy) ? legacy : [];
}

const initialPoint = loadInitialPoint();
if (['自選位置','目前位置','分享位置'].includes(initialPoint.name)) initialPoint.name = automaticLocationName(initialPoint.lat, initialPoint.lon);

export const state = {
  apiBase: (localStorage.getItem('hkRainApiBase') || localStorage.getItem('hkRadarApiBase') || DEFAULT_API_BASE).replace(/\/$/, ''),
  selected: { lat:initialPoint.lat, lon:initialPoint.lon, name:initialPoint.name },
  initialSource: initialPoint.source,
  saved: loadSavedPoints(),
  radiusKm: [1,2,3,5].includes(Number(localStorage.getItem('hkRainRadiusKm'))) ? Number(localStorage.getItem('hkRainRadiusKm')) : 2,
  autoLocate: localStorage.getItem('hkRainAutoLocate') !== 'off',
  activeTiles: localStorage.getItem('hkRainBasemap') === 'light' ? 'light' : 'dark',
  layers: { marker:true, radius:true, coverage:false, radar:false },
  accuracyMeters: null,
  forecast: null,
  forecastMeta: { fetchedAt:0, fromCache:false, offline:false },
  forecastCache: new Map(),
  requestToken: 0,
  abortController: null,
  worker: { version:null, compatible:null, capabilities:{ pointForecast:true, nowcastGrid:true, radarFrames:false }, radarContract:null },
  map: null,
  mapLayers: {},
  sheet: { mode:localStorage.getItem('hkRainSheetMode') || 'half', dragging:false, startY:0, startHeight:0, moved:false },
  radar: { frames:[], index:0, range:64, opacity:.68, layer:null },
  refreshTimer: null,
  lastSuccessfulRefreshAt: 0,
  drawerTrigger: null,
  locationPermission: 'unknown'
};
