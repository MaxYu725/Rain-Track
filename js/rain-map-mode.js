let heavyModule = null;
let heavyPromise = null;

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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', warmHeavyModuleAfterHomeBoot, { once:true });
} else {
  warmHeavyModuleAfterHomeBoot();
}
