import {
  RAIN_HOME_CADENCE_MINUTES,
  RAIN_HOME_HORIZON_MINUTES
} from './rain-home-time.js';
import { state } from './state.js';

const SERIES_SESSION_PREFIX = 'rain-home-series-v1:';
export const RAIN_HOME_FOREGROUND_MAX_AGE_MS = 4 * 60 * 1000;
export const RAIN_HOME_REFRESH_COOLDOWN_MS = 90 * 1000;

let scheduled = false;
let lastRefreshRequestAt = 0;

export function rainHomeReliabilityPointKey(point) {
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  return `${lat.toFixed(4)}|${lon.toFixed(4)}`;
}

export function inspectRainHomeStoredSeries(stored, {
  nowMs = Date.now(),
  maxAgeMs = RAIN_HOME_FOREGROUND_MAX_AGE_MS
} = {}) {
  let record = stored;
  if (typeof record === 'string') {
    try { record = JSON.parse(record); } catch { return { usable:false, shouldRefresh:false, reason:'invalid-json' }; }
  }
  const savedAt = Number(record?.savedAt);
  const points = Array.isArray(record?.data?.points) ? record.data.points : [];
  if (!Number.isFinite(savedAt) || !points.length) return { usable:false, shouldRefresh:false, reason:'missing-record' };

  const validTimes = points
    .map(point => Date.parse(point?.validTime || ''))
    .filter(Number.isFinite);
  if (!validTimes.length) return { usable:false, shouldRefresh:false, reason:'missing-valid-times' };

  const ageMs = nowMs - savedAt;
  const latestValidMs = Math.max(...validTimes);
  const runMs = Date.parse(record?.data?.runTime || '');
  const runHorizonMs = Number.isFinite(runMs)
    ? runMs + RAIN_HOME_HORIZON_MINUTES * 60_000
    : latestValidMs;
  const relevantUntilMs = Math.max(latestValidMs, runHorizonMs);
  const staleByAge = ageMs > maxAgeMs;
  const hasFuturePoint = validTimes.some(time => time >= nowMs - 60_000);
  const expired = relevantUntilMs < nowMs - RAIN_HOME_CADENCE_MINUTES * 60_000 || !hasFuturePoint;

  return {
    usable:true,
    shouldRefresh:staleByAge || expired,
    reason:expired ? 'forecast-expired' : staleByAge ? 'series-aged' : 'fresh',
    ageMs,
    latestValidMs,
    relevantUntilMs,
    hasFuturePoint
  };
}

function currentReadyRoot() {
  return document.querySelector('.rain-home-root[data-view-kind="ready"]');
}

function readStoredSeries(pointKey) {
  if (!pointKey) return null;
  try { return sessionStorage.getItem(`${SERIES_SESSION_PREFIX}${pointKey}`); }
  catch { return null; }
}

export function shouldRefreshRainHome(root, {
  point = state.selected,
  nowMs = Date.now(),
  mapView = document.body?.classList?.contains('rain-map-view')
} = {}) {
  if (!root || root.dataset?.viewKind !== 'ready' || mapView) return { refresh:false, reason:'not-ready' };
  const currentKey = rainHomeReliabilityPointKey(point);
  if (!currentKey) return { refresh:false, reason:'invalid-point' };
  if (root.dataset?.pointKey && root.dataset.pointKey !== currentKey) return { refresh:true, reason:'location-mismatch' };

  const stored = readStoredSeries(currentKey);
  const inspection = inspectRainHomeStoredSeries(stored, { nowMs });
  if (!inspection.usable) return { refresh:false, reason:inspection.reason };
  return { refresh:inspection.shouldRefresh, reason:inspection.reason, inspection };
}

export function clearRainHomeSupplementalContext(root = currentReadyRoot()) {
  if (!root) return false;
  root.querySelector('[data-rain-home-observed-radar]')?.remove();
  root.querySelector('[data-rain-home-observed-context]')?.remove();

  if (root.dataset.rainHomeSwirlsCaptured === '1') {
    const verdict = root.querySelector('.rain-home-verdict');
    const timing = root.querySelector('.rain-home-timing');
    const subtitle = document.getElementById('mobile-title-sub');
    if (verdict) verdict.textContent = root.dataset.rainHomeSwirlsTitle || '';
    if (timing) timing.textContent = root.dataset.rainHomeSwirlsTiming || '';
    if (subtitle && root.dataset.rainHomeSwirlsSubtitle !== undefined) subtitle.textContent = root.dataset.rainHomeSwirlsSubtitle;
  }

  delete root.dataset.rainHomeNowNext;
  delete root.dataset.rainHomeObservedAttempted;
  delete root.dataset.rainHomeObservedLoading;
  delete root.dataset.rainHomeObservedKey;
  return true;
}

function requestHomeRefresh(reason, nowMs = Date.now()) {
  if (document.visibilityState === 'hidden' || document.body?.classList?.contains('rain-map-view')) return false;
  if (nowMs - lastRefreshRequestAt < RAIN_HOME_REFRESH_COOLDOWN_MS) return false;
  lastRefreshRequestAt = nowMs;
  clearRainHomeSupplementalContext();
  window.dispatchEvent(new CustomEvent('rain:refresh', { detail:{ source:'rain-home-reliability', reason } }));
  return true;
}

export function checkRainHomeForegroundFreshness({ nowMs = Date.now() } = {}) {
  const root = currentReadyRoot();
  const decision = shouldRefreshRainHome(root, { nowMs });
  if (!decision.refresh) return decision;
  return { ...decision, requested:requestHomeRefresh(decision.reason, nowMs) };
}

function scheduleFreshnessCheck() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (document.visibilityState !== 'hidden') checkRainHomeForegroundFreshness();
  });
}

function initRainHomeReliability() {
  window.addEventListener('rain:location-change', () => clearRainHomeSupplementalContext());
  window.addEventListener('rain:refresh', () => clearRainHomeSupplementalContext());
  window.addEventListener('rain:map-mode-change', event => {
    if (!event.detail?.mode || event.detail.mode === 'off') scheduleFreshnessCheck();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) scheduleFreshnessCheck();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleFreshnessCheck();
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initRainHomeReliability, { once:true });
  else initRainHomeReliability();
}
