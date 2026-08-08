import { state } from './state.js';
import { isSupportedPoint } from './utils.js';

let callbacks = {};
let permissionStatus = null;
let activeRequest = null;

export async function initLocation(options = {}) {
  callbacks = options;
  if (!navigator.geolocation) {
    state.locationPermission = 'unsupported';
    callbacks.onPermission?.('unsupported');
    return 'unsupported';
  }
  state.locationPermission = await queryPermission();
  callbacks.onPermission?.(state.locationPermission);
  if (permissionStatus) {
    permissionStatus.onchange = () => {
      state.locationPermission = permissionStatus.state;
      callbacks.onPermission?.(permissionStatus.state);
    };
  }
  return state.locationPermission;
}

async function queryPermission() {
  if (!navigator.permissions?.query) return 'unknown';
  try {
    permissionStatus = await navigator.permissions.query({ name:'geolocation' });
    return permissionStatus.state;
  } catch {
    return 'unknown';
  }
}

export async function maybeAutoLocate({ shortcut = false } = {}) {
  if (!state.autoLocate || state.initialSource === 'share') return false;
  const permission = state.locationPermission;
  if (permission === 'granted') {
    await requestLocation({ automatic:true, refine:true });
    return true;
  }
  if (permission === 'prompt' || permission === 'unknown') {
    callbacks.onPrompt?.({
      mode:'prompt',
      title:shortcut ? '顯示目前位置雨量' : '顯示附近雨量',
      message:'按下後瀏覽器會要求定位權限；未允許前仍會顯示上次位置。',
      actionLabel:'顯示附近雨量'
    });
    return false;
  }
  if (permission === 'denied') {
    callbacks.onPrompt?.({
      mode:'denied',
      title:'定位權限已關閉',
      message:'請在瀏覽器或系統網站權限中允許位置，再按頂部定位按鈕。'
    });
  }
  return false;
}

export async function requestLocation({ automatic = false, refine = true } = {}) {
  if (activeRequest) return activeRequest;
  activeRequest = performLocation({ automatic, refine });
  setBusy(true);
  try {
    return await activeRequest;
  } finally {
    activeRequest = null;
    setBusy(false);
  }
}

async function performLocation({ automatic, refine }) {
  if (!navigator.geolocation) {
    callbacks.onStatus?.('error','瀏覽器不支援定位');
    return false;
  }
  if (state.locationPermission === 'denied') {
    callbacks.onStatus?.('empty','定位權限已關閉');
    callbacks.onPrompt?.({ mode:'denied', title:'定位權限已關閉', message:'請在瀏覽器或系統網站權限中允許位置，再重新嘗試。' });
    return false;
  }

  callbacks.onStatus?.('loading', automatic ? '正在自動定位…' : '正在取得目前位置…');
  try {
    const coarse = await getPosition({
      enableHighAccuracy:false,
      timeout:7000,
      maximumAge:automatic ? 300000 : 30000
    });
    state.locationPermission = 'granted';
    if (!isAcceptedPosition(coarse)) return rejectUnsupported(automatic);

    let finalPosition = coarse;
    let refined = false;

    if (refine && Number.isFinite(coarse.coords.accuracy) && coarse.coords.accuracy > 250) {
      callbacks.onStatus?.('loading', `已取得約 ±${Math.round(coarse.coords.accuracy)} 米位置，正在提高精度…`);
      try {
        const precise = await getPosition({ enableHighAccuracy:true, timeout:10000, maximumAge:0 });
        if (isAcceptedPosition(precise) && isMeaningfullyBetter(precise, coarse)) {
          finalPosition = precise;
          refined = true;
        }
      } catch {
        // 高精度定位失敗時保留已取得的一般定位；不要再次移動地圖。
      }
    }

    callbacks.onPosition?.(finalPosition, { automatic, refined });
    callbacks.onStatus?.('ok', buildSuccessText(finalPosition, automatic, refined));
    return true;
  } catch (error) {
    if (error.code === 1) {
      state.locationPermission = 'denied';
      callbacks.onStatus?.('empty','未獲定位權限');
      callbacks.onPrompt?.({ mode:'denied', title:'未獲定位權限', message:'請在瀏覽器或系統網站權限中允許位置，再重新嘗試。' });
    } else {
      callbacks.onStatus?.('error', error.code === 3 ? '定位逾時，請移到較開揚位置再試' : '暫時未能取得位置');
    }
    callbacks.onError?.(error, { automatic });
    return false;
  }
}

function getPosition(options) {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
}

function isAcceptedPosition(position) {
  const { latitude, longitude } = position.coords;
  return Number.isFinite(latitude) && Number.isFinite(longitude) && isSupportedPoint(latitude, longitude);
}

function rejectUnsupported(automatic) {
  callbacks.onStatus?.('error','目前位置不在香港預報範圍');
  callbacks.onError?.(new Error('目前位置不在香港雨量預報支援範圍'), { automatic });
  return false;
}

function isMeaningfullyBetter(next, previous) {
  const nextAccuracy = Number(next.coords.accuracy);
  const previousAccuracy = Number(previous.coords.accuracy);
  if (!Number.isFinite(nextAccuracy)) return false;
  if (!Number.isFinite(previousAccuracy)) return true;
  return nextAccuracy + 30 < previousAccuracy;
}

function setBusy(busy) {
  callbacks.onBusy?.(busy);
  for (const id of ['locate-button','badge-location','drawer-locate-button','location-permission-action']) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.disabled = Boolean(busy);
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
}

function buildSuccessText(position, automatic, refined) {
  const accuracy = Number.isFinite(position.coords.accuracy) ? `約 ±${Math.round(position.coords.accuracy)} 米` : '精度不詳';
  return `${automatic ? '已自動定位' : '已定位'}${refined ? '（高精度）' : ''}：${accuracy}`;
}
