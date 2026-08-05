import { PLACE_CENTERS, SUPPORTED_BOUNDS } from './config.js';

export function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
export function round(value, digits = 1) { const factor = 10 ** digits; return Math.round((Number(value) + Number.EPSILON) * factor) / factor; }
export function loadJSON(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; } }
export function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
export function isMobileLayout() { return window.matchMedia('(max-width:700px)').matches; }
export function formatLatLon(lat, lon) { return `${Number(lat).toFixed(4)}°N, ${Number(lon).toFixed(4)}°E`; }
export function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-HK', { timeZone:'Asia/Hong_Kong', hour:'2-digit', minute:'2-digit', hour12:false }).format(date);
}
export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-HK', { timeZone:'Asia/Hong_Kong', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(date);
}
export function formatRain(value) { const number = Number(value); if (!Number.isFinite(number)) return '—'; return number < 10 ? number.toFixed(1) : Math.round(number).toString(); }
export function formatPeriodWindow(endTime) {
  const end = new Date(endTime);
  if (Number.isNaN(end.getTime())) return '—';
  const start = new Date(end.getTime() - 30 * 60 * 1000);
  return `${formatTime(start)}–${formatTime(end)}`;
}
export function haversine(a, b, c, d) {
  const R = 6371, toRad = value => value * Math.PI / 180;
  const dLat = toRad(c - a), dLon = toRad(d - b);
  const q = Math.sin(dLat/2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
}
export function isSupportedPoint(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= SUPPORTED_BOUNDS.south && lat <= SUPPORTED_BOUNDS.north && lon >= SUPPORTED_BOUNDS.west && lon <= SUPPORTED_BOUNDS.east;
}
export function insideGrid(lat, lon, grid) {
  if (!grid) return true;
  return [grid.minLat, grid.maxLat, grid.minLon, grid.maxLon].every(Number.isFinite)
    ? lat >= grid.minLat && lat <= grid.maxLat && lon >= grid.minLon && lon <= grid.maxLon
    : true;
}
export function automaticLocationName(lat, lon) {
  let nearest = null;
  for (const [name, placeLat, placeLon] of PLACE_CENTERS) {
    const distance = haversine(lat, lon, placeLat, placeLon);
    if (!nearest || distance < nearest.distance) nearest = { name, distance };
  }
  if (!nearest) return '自選位置';
  return nearest.distance < 1.2 ? nearest.name : `${nearest.name}附近`;
}
export function rainLevel(value) {
  if (value >= 10) return 'very-heavy';
  if (value >= 2) return 'heavy';
  if (value >= .5) return 'moderate';
  if (value >= .2) return 'light';
  return 'dry';
}
export function debounce(fn, wait = 120) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}
export function semverAtLeast(actual, required) {
  const parse = value => String(value || '0').split('.').map(part => Number.parseInt(part, 10) || 0);
  const a = parse(actual), r = parse(required);
  for (let index = 0; index < Math.max(a.length, r.length); index++) {
    if ((a[index] || 0) > (r[index] || 0)) return true;
    if ((a[index] || 0) < (r[index] || 0)) return false;
  }
  return true;
}
export function nextAnimationFrame() { return new Promise(resolve => requestAnimationFrame(resolve)); }
