import { toast } from './ui.js';

let deferredInstallPrompt = null;
let waitingWorker = null;
let registrationRef = null;
let updateInProgress = false;
let reloadStarted = false;

export function isInstalledPwa() {
  return window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function clearUpdateQuery() {
  const url = new URL(location.href);
  if (!url.searchParams.has('_pwa')) return;
  url.searchParams.delete('_pwa');
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function reloadForNewController() {
  if (reloadStarted) return;
  reloadStarted = true;
  const url = new URL(location.href);
  url.searchParams.set('_pwa', Date.now().toString(36));
  location.replace(url.toString());
}

function setUpdateButtonBusy(busy) {
  const button = document.getElementById('pwa-update-button');
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? '更新中…' : '立即更新';
}

export function initPwa() {
  clearUpdateQuery();
  document.documentElement.classList.toggle('pwa-mode', isInstalledPwa());
  updatePwaStatus();

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updatePwaStatus();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.documentElement.classList.add('pwa-mode');
    updatePwaStatus('已安裝為 PWA；下次可由主畫面全螢幕啟動。');
    toast('PWA 已安裝');
  });

  if (!('serviceWorker' in navigator)) {
    updatePwaStatus('此瀏覽器不支援 Service Worker，仍可使用一般網頁模式。');
    return;
  }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    updatePwaStatus('PWA 需要 HTTPS；請部署至 HTTPS 網站後使用。');
    return;
  }

  navigator.serviceWorker.register('./service-worker.js', {
    scope:'./',
    updateViaCache:'none'
  }).then(registration => {
    registrationRef = registration;
    if (registration.waiting) exposeUpdate(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) exposeUpdate(installing);
      });
    });
    registration.update().catch(() => {});
    updatePwaStatus();
  }).catch(error => updatePwaStatus(`離線快取啟動失敗：${error.message}`));

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Do not interrupt normal startup merely because a background shell update
    // became active. Reload only after the user explicitly chose to apply one.
    if (!updateInProgress) return;
    reloadForNewController();
  });
}

function exposeUpdate(worker) {
  waitingWorker = worker;
  updateInProgress = false;
  setUpdateButtonBusy(false);
  const bar = document.getElementById('pwa-update-bar');
  bar?.classList.remove('hidden');
  updatePwaStatus('已有新版可用；按「立即更新」後會切換整套新版檔案並重新載入。');
}

export async function applyPwaUpdate() {
  if (!registrationRef && 'serviceWorker' in navigator) {
    registrationRef = await navigator.serviceWorker.getRegistration('./').catch(() => null);
  }

  let worker = waitingWorker || registrationRef?.waiting || null;
  if (!worker && registrationRef) {
    await registrationRef.update().catch(() => {});
    worker = registrationRef.waiting || null;
  }

  if (!worker) {
    toast('目前沒有等待安裝的新版');
    return;
  }

  updateInProgress = true;
  waitingWorker = worker;
  setUpdateButtonBusy(true);
  updatePwaStatus('正在套用新版並重建應用程式快取…');
  worker.postMessage({ type:'SKIP_WAITING' });

  // Android WebView/PWA 偶爾不會即時送出 controllerchange；
  // 超時後以 cache-busting navigation 作最後保險，不要求使用者清除瀏覽器資料。
  setTimeout(() => {
    if (updateInProgress) reloadForNewController();
  }, 7000);
}

export async function installPwa() {
  if (isInstalledPwa()) { toast('目前已在 PWA 模式'); return; }
  if (!deferredInstallPrompt) {
    toast(isIosDevice() ? '請在 Safari 分享選單選擇「加至主畫面」' : '請使用瀏覽器選單安裝應用程式');
    return;
  }
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  updatePwaStatus();
  if (choice?.outcome === 'accepted') toast('正在安裝 PWA');
}

function updatePwaStatus(override = '') {
  const status = document.getElementById('pwa-status');
  const button = document.getElementById('install-app-button');
  if (!status || !button) return;
  if (override) { status.textContent = override; return; }
  if (isInstalledPwa()) {
    button.classList.add('hidden');
    status.textContent = 'PWA 模式已啟動；系統支援時會隱藏瀏覽器及狀態列。';
  } else if (deferredInstallPrompt) {
    button.classList.remove('hidden');
    status.textContent = '可安裝到主畫面，安裝後以全螢幕模式啟動。';
  } else {
    button.classList.add('hidden');
    status.textContent = isIosDevice()
      ? 'iPhone／iPad：在 Safari 分享選單選擇「加至主畫面」。'
      : '可從瀏覽器選單選擇「安裝應用程式」或「加到主畫面」。';
  }
}
