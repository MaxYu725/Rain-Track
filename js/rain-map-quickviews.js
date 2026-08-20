import { state } from './state.js';

const PRESETS = Object.freeze([
  {
    id:'regional',
    label:'區域',
    aria:'查看香港、深圳及南面海域整體雨區',
    bounds:[[21.65, 113.68], [22.80, 114.68]]
  },
  {
    id:'hong-kong',
    label:'香港',
    aria:'查看全香港雨區',
    bounds:[[22.14, 113.82], [22.58, 114.50]]
  },
  {
    id:'shenzhen',
    label:'深圳',
    aria:'查看深圳附近雨區',
    bounds:[[22.42, 113.72], [22.90, 114.65]]
  },
  {
    id:'south-sea',
    label:'南海',
    aria:'查看香港以南海域雨區',
    bounds:[[21.35, 113.10], [22.22, 115.20]]
  }
]);

let activeMode = 'off';
let mapMoveHandler = null;

function ensureStyles() {
  if (document.getElementById('rain-map-quickviews-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-map-quickviews-style';
  style.textContent = `
    .rain-map-quickviews{position:absolute;z-index:1200;top:12px;right:12px;display:none;align-items:center;gap:5px;max-width:calc(100% - 140px);padding:5px;border:1px solid #3f464a;background:rgba(0,0,0,.9);box-shadow:0 3px 12px rgba(0,0,0,.4);backdrop-filter:blur(8px)}
    .rain-map-quickviews.visible{display:flex}
    .rain-map-quickviews-label{padding:0 5px;color:#8f969a;font-size:.64rem;white-space:nowrap}
    .rain-map-quickview-btn{min-height:34px;padding:0 10px;border:1px solid #3f464a;background:#090b0c;color:#c8d0d4;font-size:.7rem;white-space:nowrap}
    .rain-map-quickview-btn:hover{border-color:#6f7d84;color:#fff}
    .rain-map-quickview-btn.active{border-color:#277ca6;background:#08202c;color:#f4fbff;box-shadow:inset 0 -2px 0 #22a7e0}
    body.rain-home-v2.rain-map-view .radius-label{display:none!important}
    @media(max-width:700px){
      .rain-map-quickviews{top:8px;right:8px;max-width:calc(100% - 112px);overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;padding:3px;gap:3px}
      .rain-map-quickviews::-webkit-scrollbar{display:none}
      .rain-map-quickviews-label{display:none}
      .rain-map-quickview-btn{min-height:31px;padding:0 8px;font-size:.66rem}
      body.rain-home-v2.rain-map-view .rain-home-back-map{top:8px;left:8px;min-height:38px;padding:0 10px;font-size:.82rem}
    }
  `;
  document.head.append(style);
}

function ensureControls() {
  let controls = document.getElementById('rain-map-quickviews');
  if (controls) return controls;
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer) return null;

  controls = document.createElement('div');
  controls.id = 'rain-map-quickviews';
  controls.className = 'rain-map-quickviews';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '雨區快速視野');
  controls.innerHTML = `
    <span class="rain-map-quickviews-label">雨區視野</span>
    ${PRESETS.map(preset => `<button class="rain-map-quickview-btn" type="button" data-rain-map-view="${preset.id}" aria-label="${preset.aria}">${preset.label}</button>`).join('')}
    <button class="rain-map-quickview-btn" type="button" data-rain-map-view="location" aria-label="查看目前定位附近">附近</button>`;

  controls.addEventListener('click', event => {
    const button = event.target.closest('[data-rain-map-view]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    applyView(button.dataset.rainMapView, button);
  });

  mapContainer.append(controls);
  bindMapMoveClear();
  syncVisibility();
  return controls;
}

function bindMapMoveClear() {
  if (!state.map || mapMoveHandler) return;
  mapMoveHandler = event => {
    if (!event?.originalEvent) return;
    clearActive();
  };
  state.map.on?.('movestart', mapMoveHandler);
  state.map.on?.('zoomstart', mapMoveHandler);
}

function clearActive() {
  document.querySelectorAll('#rain-map-quickviews .rain-map-quickview-btn.active')
    .forEach(button => button.classList.remove('active'));
}

function markActive(button) {
  clearActive();
  button?.classList.add('active');
}

function applyView(id, button, { animate = true } = {}) {
  const map = state.map;
  if (!map) return;

  if (id === 'location') {
    const lat = Number(state.selected?.lat);
    const lon = Number(state.selected?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    map.setView([lat, lon], Math.max(12, Number(map.getZoom?.()) || 12), { animate });
    markActive(button);
    return;
  }

  const preset = PRESETS.find(item => item.id === id);
  if (!preset) return;
  map.fitBounds(preset.bounds, {
    animate,
    paddingTopLeft:[20, 68],
    paddingBottomRight:[20, 150]
  });
  markActive(button);
}

function applyDefaultRegionalView(controls) {
  const button = controls?.querySelector('[data-rain-map-view="regional"]');
  if (!button) return;
  requestAnimationFrame(() => {
    state.map?.invalidateSize?.({ pan:false, animate:false });
    requestAnimationFrame(() => applyView('regional', button, { animate:false }));
  });
}

function syncVisibility() {
  const controls = ensureControls();
  if (!controls) return;
  const visible = activeMode === 'forecast';
  controls.classList.toggle('visible', visible);
  controls.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (!visible) {
    clearActive();
    return;
  }
  bindMapMoveClear();
  applyDefaultRegionalView(controls);
}

function initRainMapQuickViews() {
  ensureStyles();
  ensureControls();
  window.addEventListener('rain:map-mode-change', event => {
    activeMode = event.detail?.mode || 'off';
    syncVisibility();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRainMapQuickViews, { once:true });
} else {
  initRainMapQuickViews();
}
