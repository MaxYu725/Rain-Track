import { APP_VERSION, CACHE_MS, DEFAULT_POINT, REFRESH_INTERVAL_MS, REQUIRED_WORKER_VERSION } from './config.js';
import { fetchCapabilities, fetchHealth, fetchPointForecast } from './api.js';
import { state } from './state.js';
import { automaticLocationName, insideGrid, isMobileLayout, isSupportedPoint, loadJSON, saveJSON, semverAtLeast } from './utils.js';
import { centerHongKong, centerPointForSheet, changeRadius, initMap, renderPointLayers, setLayerVisibility, setLocationAccuracy, toggleBasemap } from './map.js';
import { initLocation, maybeAutoLocate, requestLocation } from './location.js';
import { renderError, renderForecast, renderLoading } from './forecast.js';
import {
  announce, askConfirm, askPointName, askSharePrecision, closestPlaceCenter, hideLocationPrompt, initDialogs,
  initDrawer, initMobileSheet, initPlaceSearch, renderSavedPoints, setBadge, setLoading, setLocationStatus,
  setMobileStatus, setSheetMode, setUpdating, showLocationPrompt, toast, toggleDrawer, toggleForecastPanel,
  updateDiagnostics, updateLayerControls, updateStorageStatus
} from './ui.js';
import { applyPwaUpdate, initPwa, installPwa } from './pwa.js';
import { changeRadarRange, setRadarIndex, setRadarOpacity, toggleRadar, updateRadarCapability } from './radar.js';

let initialized = false;

async function init() {
  if (initialized) return;
  initialized = true;
  hydrateControls();
  initDialogs();
  initDrawer();
  initMobileSheet();
  initPwa();
  initMap({ onSelect:(lat, lon) => selectPoint(lat, lon, '自選位置', { moveMap:true }) });
  bindEvents();
  renderSavedPoints(selectSavedPoint, deleteSavedPoint);
  initPlaceSearch(item => selectPoint(item.lat, item.lon, item.name, { moveMap:true }));
  updateLayerControls();
  updateStorageStatus();
  renderPointLayers();
  setupRefreshLifecycle();
  await setupLocation();

  await Promise.allSettled([loadCapabilities(), loadPointForecast({ force:false })]);
  const shortcut = new URLSearchParams(location.search).get('action') === 'locate';
  await maybeAutoLocate({ shortcut });
  if (localStorage.getItem('hkRainHintDismissed') === '1') document.querySelector('.map-hint')?.classList.add('hint-hidden');
  else setTimeout(() => document.querySelector('.map-hint')?.classList.add('hint-hidden'), 6500);
}

function hydrateControls() {
  const apiInput = document.getElementById('api-base-input'); if (apiInput) apiInput.value = state.apiBase;
  const radius = document.getElementById('radius-select'); if (radius) radius.value = String(state.radiusKm);
  const autoLocate = document.getElementById('auto-locate-toggle'); if (autoLocate) autoLocate.checked = state.autoLocate;
  const radarRange = document.getElementById('radar-range'); if (radarRange) radarRange.value = String(state.radar.range);
  const radarOpacity = document.getElementById('radar-opacity'); if (radarOpacity) radarOpacity.value = String(Math.round(state.radar.opacity * 100));
  const opacityValue = document.getElementById('radar-opacity-value'); if (opacityValue) opacityValue.textContent = `${Math.round(state.radar.opacity * 100)}%`;
  updateDiagnostics({ appVersion:APP_VERSION });
}


function bindEvents() {
  document.getElementById('locate-button')?.addEventListener('click', () => requestLocation({ automatic:false, refine:true }));
  document.getElementById('badge-location')?.addEventListener('click', () => requestLocation({ automatic:false, refine:true }));
  document.getElementById('refresh-button')?.addEventListener('click', () => refresh(false));
  document.getElementById('drawer-button')?.addEventListener('click', event => toggleDrawer(undefined, event.currentTarget));
  document.getElementById('mobile-status')?.addEventListener('click', event => toggleDrawer(true, event.currentTarget));
  document.getElementById('center-hk-button')?.addEventListener('click', centerHongKong);
  document.getElementById('basemap-button')?.addEventListener('click', toggleBasemap);
  document.getElementById('fullscreen-button')?.addEventListener('click', toggleFullscreen);
  document.getElementById('desktop-drawer-button')?.addEventListener('click', event => toggleDrawer(undefined, event.currentTarget));
  document.getElementById('forecast-toggle')?.addEventListener('click', () => toggleForecastPanel());
  document.getElementById('location-permission-action')?.addEventListener('click', () => { hideLocationPrompt(); requestLocation({ automatic:false, refine:true }); });
  document.getElementById('auto-locate-toggle')?.addEventListener('change', event => toggleAutoLocate(event.target.checked));
  document.getElementById('drawer-locate-button')?.addEventListener('click', () => requestLocation({ automatic:false, refine:true }));
  document.getElementById('save-current-button')?.addEventListener('click', saveCurrentPoint);
  document.getElementById('share-current-button')?.addEventListener('click', sharePoint);
  document.getElementById('toggle-marker')?.addEventListener('change', event => { setLayerVisibility('marker', event.target.checked); });
  document.getElementById('toggle-radius')?.addEventListener('change', event => { setLayerVisibility('radius', event.target.checked); });
  document.getElementById('toggle-coverage')?.addEventListener('change', event => { setLayerVisibility('coverage', event.target.checked); });
  document.getElementById('radius-select')?.addEventListener('change', event => { changeRadius(event.target.value); state.forecastCache.clear(); loadPointForecast({ force:true }); });
  document.getElementById('toggle-radar')?.addEventListener('change', event => { state.layers.radar = event.target.checked; toggleRadar(event.target.checked); });
  document.getElementById('radar-range')?.addEventListener('change', event => changeRadarRange(event.target.value));
  document.getElementById('radar-opacity')?.addEventListener('input', event => setRadarOpacity(event.target.value));
  document.getElementById('radar-slider')?.addEventListener('input', event => setRadarIndex(event.target.value));
  document.getElementById('drawer-center-hk-button')?.addEventListener('click', () => { centerHongKong(); toggleDrawer(false); });
  document.getElementById('drawer-basemap-button')?.addEventListener('click', toggleBasemap);
  document.getElementById('install-app-button')?.addEventListener('click', installPwa);
  document.getElementById('drawer-fullscreen-button')?.addEventListener('click', toggleFullscreen);
  document.getElementById('save-api-button')?.addEventListener('click', saveApiBase);
  document.getElementById('reset-app-button')?.addEventListener('click', resetApplication);
  document.getElementById('pwa-update-button')?.addEventListener('click', applyPwaUpdate);
  document.getElementById('pwa-update-dismiss')?.addEventListener('click', () => document.getElementById('pwa-update-bar')?.classList.add('hidden'));

  window.addEventListener('rain:save-point', saveCurrentPoint);
  window.addEventListener('rain:share-point', sharePoint);
  window.addEventListener('rain:refresh', () => refresh(false));
  window.addEventListener('resize', () => { state.map?.invalidateSize(); if (isMobileLayout()) setSheetMode(state.sheet.mode, { persist:false, offset:false }); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { toggleDrawer(false); toggleForecastPanel(false); }
  });
}

async function setupLocation() {
  await initLocation({
    onPermission:permission => {
      state.locationPermission = permission;
      if (permission === 'denied') setLocationStatus('定位權限已關閉', 'empty');
    },
    onPrompt:showLocationPrompt,
    onStatus:(status, message) => {
      setLocationStatus(message, status);
      if (status === 'loading') setMobileStatus('loading','正在定位');
      else if ((status === 'error' || status === 'empty') && !state.forecast) setMobileStatus(status,'定位未完成');
    },
    onPosition:(position, meta) => {
      hideLocationPrompt();
      const { latitude, longitude, accuracy } = position.coords;
      selectPoint(latitude, longitude, '目前位置', { moveMap:true, accuracy, fromLocation:true, silentToast:meta.automatic && !meta.refined });
      if (!meta.automatic || meta.refined) toast(`${meta.refined ? '已提高定位精度' : '已顯示'} ${state.selected.name}`);
    },
    onError:(error, meta) => { if (!meta.automatic) toast(error.message || '定位失敗'); }
  });
}

async function loadCapabilities() {
  try {
    let data;
    try { data = await fetchCapabilities(); }
    catch (error) { if (error.status !== 404) throw error; data = await fetchHealth(); }
    state.worker.version = data.version || null;
    const capabilities = data.capabilities || {};
    state.worker.compatible = semverAtLeast(state.worker.version, REQUIRED_WORKER_VERSION) && capabilities.pointForecast !== false;
    state.worker.capabilities = { ...state.worker.capabilities, ...capabilities };
    const versionText = state.worker.version || '不詳';
    const status = document.getElementById('worker-status');
    if (status) status.textContent = state.worker.compatible ? `Worker v${versionText} · Foundation 相容` : `Worker v${versionText} · 請升級至 v${REQUIRED_WORKER_VERSION}`;
    updateDiagnostics({ appVersion:APP_VERSION });
    updateRadarCapability(capabilities, data.radarContract || capabilities.radar || null);
    if (!state.worker.compatible) setBadge('point','error','POINT');
  } catch (error) {
    state.worker.compatible = null;
    const status = document.getElementById('worker-status'); if (status) status.textContent = `未能檢查 Worker：${error.message}`;
    updateDiagnostics({ appVersion:APP_VERSION, workerError:error.message });
    updateRadarCapability({ radarFrames:false }, null);
  }
}

function cacheKey(point = state.selected) { return `${point.lat.toFixed(3)}|${point.lon.toFixed(3)}|${state.radiusKm}`; }

async function refresh(silent = false) { return loadPointForecast({ force:true, silent }); }

async function loadPointForecast({ force = false, silent = false } = {}) {
  const point = { ...state.selected };
  const key = cacheKey(point);
  const memory = state.forecastCache.get(key);
  const stored = loadJSON('hkRainLastForecast', null);
  const storedMatch = stored?.cacheKey === key && stored?.data ? stored : null;
  if (!force && memory && Date.now() - memory.savedAt < CACHE_MS) {
    state.forecast = memory.data;
    state.forecastMeta = { fetchedAt:memory.savedAt, fromCache:true, offline:false };
    renderForecast(); scheduleRefresh(); return;
  }
  if (!force && !memory && storedMatch && Date.now() - storedMatch.savedAt < CACHE_MS) {
    state.forecast = storedMatch.data;
    state.forecastCache.set(key, storedMatch);
    state.forecastMeta = { fetchedAt:storedMatch.savedAt, fromCache:true, offline:false };
    renderForecast(); scheduleRefresh(); return;
  }

  const token = ++state.requestToken;
  state.abortController?.abort();
  state.abortController = new AbortController();
  const retain = Boolean(state.forecast);
  if (!silent && !retain) setLoading(true);
  if (retain) setUpdating(true); else renderLoading(point);

  try {
    const data = await fetchPointForecast(point, state.radiusKm, { signal:state.abortController.signal });
    if (token !== state.requestToken) return;
    if (!data?.periods?.length) throw new Error('Worker 沒有返回可用預報時段');
    state.forecast = data;
    const savedAt = Date.now();
    state.lastSuccessfulRefreshAt = savedAt;
    state.forecastMeta = { fetchedAt:savedAt, fromCache:false, offline:false };
    state.forecastCache.set(key, { data, savedAt });
    saveJSON('hkRainLastForecast', { cacheKey:key, data, savedAt });
    renderForecast();
    renderPointLayers();
    syncUrl();
  } catch (error) {
    if (error.name === 'AbortError' || token !== state.requestToken) return;
    const fallback = state.forecastCache.get(key) || storedMatch;
    if (fallback?.data) {
      state.forecast = fallback.data;
      state.forecastMeta = { fetchedAt:fallback.savedAt, fromCache:true, offline:!navigator.onLine };
      const notice = `網絡暫時未能更新，正在顯示 ${new Date(fallback.savedAt).toLocaleTimeString('zh-HK',{hour:'2-digit',minute:'2-digit',hour12:false})} 儲存的快取預報。`;
      renderForecast({ cacheNotice:notice });
      toast(notice, 5000);
    } else {
      const message = error.status === 404
        ? `Worker 版本過舊；請部署 v${REQUIRED_WORKER_VERSION}，v1.5 已移除舊版網格後備模式。`
        : error.message || String(error);
      state.forecast = null;
      renderError(message);
    }
  } finally {
    if (token === state.requestToken) { setLoading(false); setUpdating(false); scheduleRefresh(); }
  }
}

function selectPoint(lat, lon, name = '自選位置', options = {}) {
  const numericLat = Number(lat), numericLon = Number(lon);
  if (!isSupportedPoint(numericLat, numericLon)) { toast('所選位置超出香港雨量預報支援範圍'); return false; }
  if (state.forecast?.grid && !insideGrid(numericLat, numericLon, state.forecast.grid)) { toast('所選位置超出目前官方雨量預報網格範圍'); return false; }
  const automaticName = ['自選位置','目前位置','分享位置'].includes(name) ? automaticLocationName(numericLat, numericLon) : name;
  state.selected = { lat:numericLat, lon:numericLon, name:automaticName };
  state.accuracyMeters = Number.isFinite(options.accuracy) ? Number(options.accuracy) : options.keepAccuracy ? state.accuracyMeters : null;
  saveJSON('hkRainLastPoint', state.selected);
  renderPointLayers();
  if (options.moveMap) centerPointForSheet(numericLat, numericLon, Math.max(state.map?.getZoom() || 13, 13));
  if (name === '自選位置') { localStorage.setItem('hkRainHintDismissed','1'); document.querySelector('.map-hint')?.classList.add('hint-hidden'); }
  if (isMobileLayout() && !state.sheet.userMode) setSheetMode('half', { persist:false, offset:false });
  loadPointForecast({ force:false });
  return true;
}

function selectSavedPoint(point) {
  selectPoint(point.lat, point.lon, point.name, { moveMap:true });
  toggleDrawer(false);
}

async function saveCurrentPoint() {
  const proposed = state.selected.name || '新定點';
  const name = await askPointName(proposed);
  if (!name) return;
  const item = { lat:state.selected.lat, lon:state.selected.lon, name:name.trim() || '定點' };
  const existing = state.saved.findIndex(point => Math.abs(point.lat - item.lat) < .0005 && Math.abs(point.lon - item.lon) < .0005);
  if (existing >= 0) state.saved[existing] = item; else state.saved.push(item);
  state.selected.name = item.name;
  saveJSON('hkRainSavedPoints', state.saved);
  saveJSON('hkRainLastPoint', state.selected);
  renderSavedPoints(selectSavedPoint, deleteSavedPoint);
  renderForecast(); renderPointLayers(); syncUrl(); updateStorageStatus();
  toast('已儲存位置'); announce(`已儲存${item.name}`);
}

async function deleteSavedPoint(index) {
  const point = state.saved[index];
  if (!point) return;
  const confirmed = await askConfirm('刪除位置', `確定刪除「${point.name}」？`, '刪除');
  if (!confirmed) return;
  state.saved.splice(index, 1);
  saveJSON('hkRainSavedPoints', state.saved);
  renderSavedPoints(selectSavedPoint, deleteSavedPoint);
  updateStorageStatus();
  toast('已刪除位置');
}

async function sharePoint() {
  const precision = await askSharePrecision();
  if (!precision) return;
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('share','1');
  let lat = state.selected.lat, lon = state.selected.lon, name = state.selected.name;
  if (precision === 'nearby') {
    const place = closestPlaceCenter(lat, lon);
    lat = place.lat; lon = place.lon; name = `${place.name}附近`;
    url.searchParams.set('precision','nearby');
  } else {
    url.searchParams.set('precision','exact');
  }
  url.searchParams.set('lat', Number(lat).toFixed(precision === 'nearby' ? 4 : 5));
  url.searchParams.set('lon', Number(lon).toFixed(precision === 'nearby' ? 4 : 5));
  url.searchParams.set('name', name);
  const value = url.toString();
  if (navigator.share) {
    try { await navigator.share({ title:'定點雨量預報', text:name, url:value }); return; } catch (error) { if (error.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(value); toast('位置連結已複製'); }
  catch { toast(value, 7000); }
}

function syncUrl() {
  const params = new URLSearchParams(location.search);
  if (params.get('share') !== '1' && !(params.has('lat') && params.has('lon'))) return;
  const url = new URL(location.href);
  url.searchParams.set('lat', state.selected.lat.toFixed(5));
  url.searchParams.set('lon', state.selected.lon.toFixed(5));
  url.searchParams.set('name', state.selected.name);
  history.replaceState(null, '', url);
}

function toggleAutoLocate(value) {
  state.autoLocate = Boolean(value);
  localStorage.setItem('hkRainAutoLocate', state.autoLocate ? 'on' : 'off');
  if (state.autoLocate) maybeAutoLocate();
  else hideLocationPrompt();
}

function saveApiBase() {
  const value = document.getElementById('api-base-input')?.value.trim().replace(/\/$/, '');
  if (!/^https:\/\//i.test(value)) { toast('請輸入 HTTPS Worker URL'); return; }
  localStorage.setItem('hkRainApiBase', value);
  updateDiagnostics({ appVersion:APP_VERSION });
  location.reload();
}

async function resetApplication() {
  const confirmed = await askConfirm('重設應用程式', '這會刪除已儲存位置、設定及快取預報，但不會移除已安裝的 PWA。', '重設');
  if (!confirmed) return;
  const keys = Object.keys(localStorage).filter(key => key.startsWith('hkRain') || key.startsWith('hkRadar'));
  keys.forEach(key => localStorage.removeItem(key));
  if ('caches' in window) {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('point-rain-pwa-')).map(name => caches.delete(name)));
  }
  location.href = location.pathname;
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

function setupRefreshLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') clearRefreshTimer();
    else if (forecastAge() >= REFRESH_INTERVAL_MS) refresh(true); else scheduleRefresh();
  });
  window.addEventListener('online', () => { if (forecastAge() >= REFRESH_INTERVAL_MS || state.forecastMeta.offline) refresh(true); });
  window.addEventListener('offline', () => { setMobileStatus('loading','離線 · 顯示快取'); toast('網絡已中斷，會保留目前預報'); });
}

function forecastAge() {
  const reference = state.lastSuccessfulRefreshAt || state.forecastMeta.fetchedAt || 0;
  return reference ? Date.now() - reference : Infinity;
}

function clearRefreshTimer() { if (state.refreshTimer) clearTimeout(state.refreshTimer); state.refreshTimer = null; }

function scheduleRefresh() {
  clearRefreshTimer();
  if (document.visibilityState === 'hidden') return;
  const delay = Math.max(1000, REFRESH_INTERVAL_MS - forecastAge());
  state.refreshTimer = setTimeout(() => refresh(true), delay);
}

document.addEventListener('DOMContentLoaded', init);
