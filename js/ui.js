import { DEFAULT_POINT, PLACE_CENTERS } from './config.js';
import { state } from './state.js';
import { debounce, escapeHtml, haversine, isMobileLayout } from './utils.js';
import { invalidateMap, keepSelectedVisible } from './map.js';

let toastTimer = null;
let activeModalResolve = null;

export function announce(message) {
  const region = document.getElementById('app-status');
  if (!region) return;
  region.textContent = '';
  requestAnimationFrame(() => { region.textContent = message; });
}

export function toast(message, duration = 3500) {
  const element = document.getElementById('toast');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), duration);
}

export function setLoading(on) { document.getElementById('loading-line')?.classList.toggle('hidden', !on); }

export function setMobileStatus(status, label) {
  const element = document.getElementById('mobile-status');
  const text = document.getElementById('mobile-status-text');
  if (!element || !text) return;
  element.className = `mobile-status map-hud ${status || 'empty'}`;
  text.textContent = label || '資料狀態';
}

export function setBadge(key, status, label) {
  const element = document.getElementById(`badge-${key}`);
  if (!element) return;
  element.className = `source-badge ${status}`;
  element.textContent = label;
}

export function showLocationPrompt({ mode = 'prompt', title, message, actionLabel = '顯示附近雨量' } = {}) {
  const card = document.getElementById('location-permission-card');
  if (!card) return;
  card.dataset.mode = mode;
  card.querySelector('.location-permission-title').textContent = title || '顯示附近雨量';
  card.querySelector('.location-permission-message').textContent = message || '允許定位後可自動顯示附近兩小時雨量。';
  const button = document.getElementById('location-permission-action');
  button.textContent = actionLabel;
  button.classList.toggle('hidden', mode === 'denied');
  card.classList.remove('hidden');
}

export function hideLocationPrompt() { document.getElementById('location-permission-card')?.classList.add('hidden'); }

export function setLocationStatus(message, status = 'empty') {
  const detail = document.getElementById('location-status');
  if (detail) detail.textContent = message;
  setBadge('location', status, 'LOC');
  const locateButton = document.getElementById('locate-button');
  locateButton?.classList.toggle('is-loading', status === 'loading');
}

export function initMobileSheet() {
  const panel = document.getElementById('forecast-panel');
  const handle = document.getElementById('sheet-handle');
  if (!panel || !handle) return;
  if (!['peek','half','full'].includes(state.sheet.mode)) state.sheet.mode = 'half';
  const apply = () => {
    if (isMobileLayout()) setSheetMode(state.sheet.mode, { persist:false, offset:false });
    else panel.classList.remove('sheet-peek','sheet-half','sheet-full','dragging');
  };
  apply();
  window.matchMedia('(max-width:700px)').addEventListener?.('change', apply);
  handle.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); cycleSheetMode(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSheetMode(state.sheet.mode === 'peek' ? 'half' : 'full'); }
    if (event.key === 'ArrowDown') { event.preventDefault(); setSheetMode(state.sheet.mode === 'full' ? 'half' : 'peek'); }
  });
  handle.addEventListener('click', () => { if (!state.sheet.moved) cycleSheetMode(); state.sheet.moved = false; });
  handle.addEventListener('pointerdown', event => {
    if (!isMobileLayout()) return;
    state.sheet.dragging = true; state.sheet.moved = false;
    state.sheet.startY = event.clientY; state.sheet.startHeight = panel.getBoundingClientRect().height;
    panel.classList.add('dragging'); handle.setPointerCapture?.(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!state.sheet.dragging) return;
    const delta = state.sheet.startY - event.clientY;
    if (Math.abs(delta) > 5) state.sheet.moved = true;
    const min = 88;
    const safeTop = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 0;
    const max = Math.max(180, window.innerHeight - 68 - safeTop);
    panel.style.height = `${Math.max(min, Math.min(max, state.sheet.startHeight + delta))}px`;
  });
  const finish = event => {
    if (!state.sheet.dragging) return;
    state.sheet.dragging = false; panel.classList.remove('dragging');
    const height = panel.getBoundingClientRect().height; panel.style.height = '';
    const ratio = height / window.innerHeight;
    setSheetMode(ratio < .24 ? 'peek' : ratio < .72 ? 'half' : 'full');
    try { handle.releasePointerCapture?.(event.pointerId); } catch {}
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
}

export function cycleSheetMode() { setSheetMode(state.sheet.mode === 'peek' ? 'half' : state.sheet.mode === 'half' ? 'full' : 'half'); }

export function setSheetMode(mode, { persist = true, offset = true } = {}) {
  if (!['peek','half','full'].includes(mode)) mode = 'half';
  state.sheet.mode = mode;
  const panel = document.getElementById('forecast-panel');
  panel?.classList.remove('collapsed','sheet-peek','sheet-half','sheet-full');
  panel?.classList.add(`sheet-${mode}`);
  if (panel) panel.dataset.sheet = mode;
  const handle = document.getElementById('sheet-handle');
  handle?.setAttribute('aria-expanded', mode !== 'peek' ? 'true' : 'false');
  handle?.setAttribute('aria-label', `預報面板目前為${mode === 'peek' ? '收起' : mode === 'half' ? '半開' : '全開'}，可拖曳或使用上下方向鍵調整`);
  if (persist) localStorage.setItem('hkRainSheetMode', mode);
  requestAnimationFrame(() => { invalidateMap(); if (offset) keepSelectedVisible(true); });
}

export function toggleForecastPanel(force) {
  if (isMobileLayout()) {
    if (typeof force === 'boolean') setSheetMode(force ? 'half' : 'peek');
    else setSheetMode(state.sheet.mode === 'peek' ? 'half' : 'peek');
    return;
  }
  const panel = document.getElementById('forecast-panel');
  const collapsed = typeof force === 'boolean' ? !force : !panel?.classList.contains('collapsed');
  panel?.classList.toggle('collapsed', collapsed);
  const toggle = document.getElementById('forecast-toggle');
  if (toggle) { toggle.textContent = collapsed ? '⌃' : '⌄'; toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true'); }
}

export function initDrawer() {
  const drawer = document.getElementById('settings-drawer');
  const close = document.getElementById('drawer-close');
  drawer?.addEventListener('keydown', trapFocus);
  close?.addEventListener('click', () => toggleDrawer(false));
  document.getElementById('drawer-backdrop')?.addEventListener('click', () => toggleDrawer(false));
}

export function toggleDrawer(force, trigger = null) {
  const drawer = document.getElementById('settings-drawer');
  if (!drawer) return;
  const open = typeof force === 'boolean' ? force : !drawer.classList.contains('open');
  if (open) {
    state.drawerTrigger = trigger || document.activeElement;
    drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false');
    document.getElementById('drawer-backdrop')?.classList.remove('hidden');
    document.body.classList.add('drawer-open');
    setTimeout(() => document.getElementById('drawer-close')?.focus(), 40);
  } else {
    drawer.classList.remove('open'); drawer.setAttribute('aria-hidden','true');
    document.getElementById('drawer-backdrop')?.classList.add('hidden');
    document.body.classList.remove('drawer-open');
    state.drawerTrigger?.focus?.(); state.drawerTrigger = null;
  }
}

function trapFocus(event) {
  if (event.key !== 'Tab') return;
  const drawer = event.currentTarget;
  const focusable = [...drawer.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.classList.contains('hidden'));
  if (!focusable.length) return;
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export function renderSavedPoints(onSelect, onDelete) {
  const box = document.getElementById('saved-list');
  if (!box) return;
  const all = [DEFAULT_POINT, ...state.saved];
  box.innerHTML = all.map((point, index) => `<div class="saved-item"><button class="saved-main" type="button" data-index="${index}"><span class="saved-name">${escapeHtml(point.name)}</span><span class="saved-coord">${Number(point.lat).toFixed(4)}, ${Number(point.lon).toFixed(4)}</span></button>${index === 0 ? '<span></span>' : `<button class="delete-btn" type="button" data-delete="${index - 1}" aria-label="刪除 ${escapeHtml(point.name)}">×</button>`}</div>`).join('');
  box.querySelectorAll('[data-index]').forEach(button => button.addEventListener('click', () => onSelect?.(all[Number(button.dataset.index)])));
  box.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => onDelete?.(Number(button.dataset.delete))));
}

export function initPlaceSearch(onSelect) {
  const input = document.getElementById('place-search-input');
  const results = document.getElementById('place-search-results');
  if (!input || !results) return;
  const render = query => {
    const text = String(query || '').trim().toLowerCase();
    if (!text) { results.innerHTML = ''; results.classList.add('hidden'); return; }
    const entries = [
      ...state.saved.map(item => ({ ...item, source:'已儲存' })),
      ...PLACE_CENTERS.map(([name, lat, lon]) => ({ name, lat, lon, source:'地區' }))
    ];
    const seen = new Set();
    const matches = entries.filter(item => item.name.toLowerCase().includes(text)).filter(item => {
      const key = `${item.name}|${Number(item.lat).toFixed(3)}|${Number(item.lon).toFixed(3)}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    }).slice(0, 8);
    results.innerHTML = matches.length ? matches.map((item, index) => `<button type="button" class="search-result" data-result="${index}"><span>${escapeHtml(item.name)}</span><small>${escapeHtml(item.source)}</small></button>`).join('') : '<div class="search-empty">找不到相符地區</div>';
    results.classList.remove('hidden');
    results.querySelectorAll('[data-result]').forEach(button => button.addEventListener('click', () => {
      const item = matches[Number(button.dataset.result)];
      input.value = item.name; results.classList.add('hidden'); onSelect?.(item);
    }));
  };
  input.addEventListener('input', debounce(event => render(event.target.value), 90));
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { results.classList.add('hidden'); input.value = ''; }
  });
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (!dialog) return Promise.resolve(null);
  dialog.showModal?.();
  if (!dialog.open) dialog.setAttribute('open','');
  return new Promise(resolve => { activeModalResolve = value => { activeModalResolve = null; dialog.close?.(); dialog.removeAttribute('open'); resolve(value); }; });
}

export async function askPointName(defaultName) {
  const input = document.getElementById('point-name-input');
  input.value = defaultName || '新定點';
  const promise = openDialog('point-name-dialog');
  setTimeout(() => { input.focus(); input.select(); }, 30);
  return promise;
}

export async function askSharePrecision() {
  document.querySelector('input[name="share-precision"][value="nearby"]').checked = true;
  return openDialog('share-dialog');
}

export async function askConfirm(title, message, confirmLabel = '確認') {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-accept').textContent = confirmLabel;
  return openDialog('confirm-dialog');
}

export function initDialogs() {
  document.querySelectorAll('[data-dialog-cancel]').forEach(button => button.addEventListener('click', () => activeModalResolve?.(null)));
  document.getElementById('point-name-form')?.addEventListener('submit', event => {
    event.preventDefault(); activeModalResolve?.(document.getElementById('point-name-input').value.trim());
  });
  document.getElementById('share-form')?.addEventListener('submit', event => {
    event.preventDefault(); activeModalResolve?.(document.querySelector('input[name="share-precision"]:checked')?.value || 'nearby');
  });
  document.getElementById('confirm-form')?.addEventListener('submit', event => { event.preventDefault(); activeModalResolve?.(true); });
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('cancel', event => { event.preventDefault(); activeModalResolve?.(null); }));
}

export function setUpdating(on) {
  document.getElementById('forecast-updating')?.classList.toggle('hidden', !on);
  document.getElementById('refresh-button')?.classList.toggle('is-loading', on);
}

export function updateLayerControls() {
  for (const key of ['marker','radius','coverage','radar']) {
    const input = document.getElementById(`toggle-${key}`);
    if (input) input.checked = Boolean(state.layers[key]);
  }
  const radius = document.getElementById('radius-select'); if (radius) radius.value = String(state.radiusKm);
}

export function updateStorageStatus() {
  const status = document.getElementById('storage-status');
  if (!status) return;
  const forecast = localStorage.getItem('hkRainLastForecast') ? '有快取預報' : '沒有快取預報';
  status.textContent = `${state.saved.length} 個自訂位置 · ${forecast}`;
}

export function closestPlaceCenter(lat, lon) {
  let nearest = { name:'香港', lat:Number(lat.toFixed(2)), lon:Number(lon.toFixed(2)), distance:Infinity };
  for (const [name, placeLat, placeLon] of PLACE_CENTERS) {
    const distance = haversine(lat, lon, placeLat, placeLon);
    if (distance < nearest.distance) nearest = { name, lat:placeLat, lon:placeLon, distance };
  }
  return nearest;
}
