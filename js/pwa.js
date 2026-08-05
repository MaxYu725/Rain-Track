import { toast } from './ui.js';

let deferredInstallPrompt = null;
let waitingWorker = null;

export function isInstalledPwa() {
  return window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function initPwa() {
  sessionStorage.removeItem('hkRainReloadingForUpdate');
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
    updatePwaStatus('PWA 需要 HTTPS；請部署至 Cloudflare Pages 後使用。');
    return;
  }

  navigator.serviceWorker.register('./service-worker.js', { scope:'./' }).then(registration => {
    if (registration.waiting) exposeUpdate(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) exposeUpdate(installing);
      });
    });
    updatePwaStatus();
  }).catch(error => updatePwaStatus(`離線快取啟動失敗：${error.message}`));

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (sessionStorage.getItem('hkRainReloadingForUpdate') === '1') return;
    sessionStorage.setItem('hkRainReloadingForUpdate','1');
    location.reload();
  });
}

function exposeUpdate(worker) {
  waitingWorker = worker;
  const bar = document.getElementById('pwa-update-bar');
  bar?.classList.remove('hidden');
  updatePwaStatus('已有新版可用；按「立即更新」後會安全重新載入。');
}

export async function applyPwaUpdate() {
  if (!waitingWorker) {
    toast('目前沒有等待安裝的新版');
    return;
  }
  waitingWorker.postMessage({ type:'SKIP_WAITING' });
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
