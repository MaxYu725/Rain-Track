let heavyModule = null;
let heavyPromise = null;
let defaultForecastStarting = false;
let bodyObserver = null;

// Map-first is a presentation decision, not a data dependency. Apply it as
// soon as this lightweight module evaluates so Rain Home cannot visually block
// the primary map surface while its point-series request is still settling.
if (typeof document !== 'undefined' && document.body) {
  document.body.classList.add('rain-map-view');
  document.body.classList.remove('rain-home-details-view');
}

function loadHeavyRainMapMode() {
  if (heavyModule) return Promise.resolve(heavyModule);
  if (!heavyPromise) {
    heavyPromise = import('./rain-map-mode-heavy.js')
      .then(module => {
        heavyModule = module;
        return module;
      })
      .catch(error => {
        heavyPromise = null;
        throw error;
      });
  }
  return heavyPromise;
}

export async function setRainMapMode(requestedMode) {
  const module = await loadHeavyRainMapMode();
  return module.setRainMapMode(requestedMode);
}

export function getRainMapMode() {
  return heavyModule?.getRainMapMode?.() || 'off';
}

export function ensureRainMapModeLoaded() {
  return loadHeavyRainMapMode();
}

function injectMapFirstStyles() {
  if (document.getElementById('rain-home-map-first-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-home-map-first-style';
  style.textContent = `
    body.rain-home-v2.rain-map-view #rain-home-back-map{display:none!important}
    .rain-home-map-details{
      position:absolute;z-index:1250;left:58px;right:auto;top:12px;min-height:42px;padding:0 13px;
      border:1px solid #426b80;background:rgba(4,15,21,.93);color:#f4fbff;
      font:650 .82rem/1 "Segoe UI","Microsoft JhengHei",sans-serif;letter-spacing:.01em;
      box-shadow:0 4px 18px rgba(0,0,0,.28);backdrop-filter:blur(5px)
    }
    body:not(.rain-map-view) .rain-home-map-details{display:none!important}
    body.rain-home-v2.rain-map-view #rain-map-quickviews{max-width:calc(100% - 154px)!important}
    .rain-home-map-details:hover{border-color:#6d9bb1;background:rgba(7,25,34,.96)}
    .rain-home-map-details:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .rain-home-details-back{
      display:none;width:100%;min-height:48px;align-items:center;gap:9px;margin:0 0 8px;padding:0 14px;
      position:sticky;top:0;z-index:30;border:1px solid #365f73;background:rgba(5,17,23,.98);color:#effaff;
      font:650 .82rem/1 "Segoe UI","Microsoft JhengHei",sans-serif;text-align:left;
      box-shadow:0 6px 18px rgba(0,0,0,.38);backdrop-filter:blur(7px)
    }
    body.rain-home-v2.rain-home-details-view .rain-home-details-back{display:flex!important}
    .rain-home-details-back:hover{border-color:#5f8ea5;background:#091c25}
    .rain-home-details-back:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    @media(max-width:700px){
      .rain-home-map-details{left:48px;right:auto;top:8px;min-height:38px;padding:0 9px;font-size:.75rem}
      body.rain-home-v2.rain-map-view #rain-map-quickviews{max-width:calc(100% - 140px)!important}
      .rain-home-details-back{min-height:46px;margin-bottom:6px;padding:0 12px;font-size:.8rem}
    }
  `;
  document.head.append(style);
}

function syncMapFirstBodyState() {
  const body = document.body;
  if (!body) return;

  // Explicit map navigation wins if both states briefly coexist. This is what
  // lets the existing 「查看 2 小時雨區」 action escape the detail surface.
  if (body.classList.contains('rain-map-view')) {
    if (body.classList.contains('rain-home-details-view')) body.classList.remove('rain-home-details-view');
    return;
  }

  if (body.classList.contains('rain-home-details-view')) return;

  // Layer mode changes may remove rain-map-view through legacy listeners. In
  // the map-first product, turning a layer off must still leave the base map as
  // Home rather than exposing (or blanking into) the detail surface.
  body.classList.add('rain-map-view');
}

function showForecastDetails() {
  const body = document.body;
  if (!body) return;

  // Remove map state first. MutationObserver callbacks run after this task, so
  // the final state is unambiguous and cannot be mistaken for a return-to-map.
  body.classList.remove('rain-map-view');
  body.classList.add('rain-home-details-view');

  const subtitle = document.getElementById('mobile-title-sub');
  if (subtitle) subtitle.textContent = '定點兩小時預報';
  document.querySelector('.pivot-content-wrapper')?.scrollTo?.({ top:0, behavior:'instant' });
  requestAnimationFrame(() => document.getElementById('forecast-panel')?.scrollIntoView?.({ block:'start' }));
}

async function returnToForecastMap(button = null) {
  const body = document.body;
  if (!body) return;
  if (button) button.disabled = true;

  body.classList.remove('rain-home-details-view');
  body.classList.add('rain-map-view');
  const subtitle = document.getElementById('mobile-title-sub');
  if (subtitle) subtitle.textContent = '未來兩小時臨近預報';

  try {
    await setRainMapMode('forecast');
  } catch (error) {
    console.warn('Two-hour rain map unavailable:', error?.message || error);
  } finally {
    if (button) button.disabled = false;
  }
}

function ensureMapDetailsButton() {
  const container = document.getElementById('map-container');
  if (!container) return;
  let button = document.getElementById('rain-home-map-details');
  if (!button) {
    button = document.createElement('button');
    button.id = 'rain-home-map-details';
    button.className = 'rain-home-map-details map-hud';
    button.type = 'button';
    button.textContent = '預報詳情';
    button.setAttribute('aria-label', '展開目前位置兩小時預報詳情');
    button.addEventListener('click', showForecastDetails);
    container.append(button);
  }
}

function ensureDetailsBackButton() {
  const panel = document.getElementById('forecast-panel');
  if (!panel) return;
  let button = document.getElementById('rain-home-details-back');
  if (!button) {
    button = document.createElement('button');
    button.id = 'rain-home-details-back';
    button.className = 'rain-home-details-back';
    button.type = 'button';
    button.textContent = '← 返回 2 小時雨區';
    button.setAttribute('aria-label', '返回兩小時雨區地圖');
    button.addEventListener('click', () => void returnToForecastMap(button));
    panel.prepend(button);
  }
}

async function activateDefaultForecastMap() {
  if (defaultForecastStarting || getRainMapMode() === 'forecast') return;
  defaultForecastStarting = true;
  try {
    await setRainMapMode('forecast');
  } catch (error) {
    console.warn('Default two-hour rain map unavailable:', error?.message || error);
  } finally {
    defaultForecastStarting = false;
  }
}

function warmHeavyModuleAfterHomeBoot() {
  const warm = () => loadHeavyRainMapMode().catch(error => {
    console.warn('Rain map controls deferred:', error?.message || error);
  });

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(warm, { timeout:3000 });
  } else {
    setTimeout(warm, 1200);
  }
}

function initMapFirstHome() {
  document.body?.classList.add('rain-map-view');
  document.body?.classList.remove('rain-home-details-view');
  injectMapFirstStyles();
  ensureMapDetailsButton();
  ensureDetailsBackButton();

  if (document.body && !bodyObserver) {
    bodyObserver = new MutationObserver(syncMapFirstBodyState);
    bodyObserver.observe(document.body, { attributes:true, attributeFilter:['class'] });
  }

  // app.js initializes Leaflet after this lightweight facade. The map-ready
  // event is the single authoritative point at which the forecast overlay may
  // touch Leaflet, so this module needs no static dependency on app state.
  window.addEventListener('rain:map-ready', () => void activateDefaultForecastMap(), { once:true });
  warmHeavyModuleAfterHomeBoot();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMapFirstHome, { once:true });
} else {
  initMapFirstHome();
}
