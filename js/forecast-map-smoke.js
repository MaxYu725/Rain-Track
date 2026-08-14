import { state } from './state.js';
import { getForecastMapRuntimeSnapshot, loadForecastMap, setForecastMapIndex } from './forecast-map-runtime.js';

const PARAM = 'forecastMapSmoke';
const ENABLED = new URLSearchParams(location.search).get(PARAM) === '1';
const STEP_MS = 2200;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForMap(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!state.map && Date.now() < deadline) await sleep(100);
  if (!state.map) throw new Error('Forecast Map smoke：Leaflet 地圖初始化逾時');
}

function renderSmokeStatus(snapshot, message = '') {
  let badge = document.getElementById('forecast-map-smoke-status');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'forecast-map-smoke-status';
    badge.className = 'map-hud';
    Object.assign(badge.style, {
      position:'absolute', left:'12px', bottom:'160px', zIndex:'950',
      padding:'7px 10px', background:'rgba(0,0,0,.78)', color:'#fff',
      borderRadius:'4px', fontSize:'12px', pointerEvents:'none'
    });
    document.getElementById('map-container')?.appendChild(badge);
  }
  const frame = snapshot?.selectedFrame;
  badge.textContent = message || `兩小時預報測試 ${Number(frame?.index || 0) + 1}/${snapshot?.frameCount || 0} · ${frame?.leadMinutes || '—'} 分鐘`;
}

async function runSmoke() {
  if (!ENABLED) return;
  try {
    await waitForMap();
    let snapshot = await loadForecastMap({ frameIndex:0 });
    renderSmokeStatus(snapshot);
    for (let i = 1; i < snapshot.frameCount; i += 1) {
      await sleep(STEP_MS);
      snapshot = setForecastMapIndex(i);
      renderSmokeStatus(snapshot);
    }
    window.__RAIN_FORECAST_SMOKE__ = getForecastMapRuntimeSnapshot();
  } catch (error) {
    renderSmokeStatus(null, `兩小時預報測試失敗：${error.message || error}`);
  }
}

document.addEventListener('DOMContentLoaded', runSmoke, { once:true });
