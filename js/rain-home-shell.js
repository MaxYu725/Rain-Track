const LEGACY_SHEET_CLASSES = Object.freeze([
  'collapsed',
  'sheet-peek',
  'sheet-half',
  'sheet-full',
  'dragging'
]);

let panelObserver = null;
let bodyObserver = null;

function panelHasLegacySheetState(panel) {
  if (!panel) return false;
  return LEGACY_SHEET_CLASSES.some(className => panel.classList.contains(className))
    || panel.hasAttribute('data-sheet')
    || Boolean(panel.style.getPropertyValue('height'));
}

function bodyHasLegacySheetState() {
  return document.body.classList.contains('sheet-peek-active')
    || document.body.classList.contains('sheet-expanded-active');
}

function stripLegacySheetState() {
  const handle = document.getElementById('sheet-handle');
  if (handle) handle.remove();
  const toggle = document.getElementById('forecast-toggle');
  if (toggle) toggle.remove();

  const panel = document.getElementById('forecast-panel');
  if (panel && panelHasLegacySheetState(panel)) {
    const staleClasses = LEGACY_SHEET_CLASSES.filter(className => panel.classList.contains(className));
    if (staleClasses.length) panel.classList.remove(...staleClasses);
    if (panel.hasAttribute('data-sheet')) panel.removeAttribute('data-sheet');
    if (panel.style.getPropertyValue('height')) panel.style.removeProperty('height');
  }

  if (bodyHasLegacySheetState()) {
    document.body.classList.remove('sheet-peek-active', 'sheet-expanded-active');
  }
}

function restorePanelIfNeeded() {
  const panel = document.getElementById('forecast-panel');
  if (panelHasLegacySheetState(panel)) stripLegacySheetState();
}

function restoreBodyIfNeeded() {
  if (bodyHasLegacySheetState()) stripLegacySheetState();
}

function migrateLegacySheetStorage() {
  localStorage.removeItem('hkRainSheetMode');
  localStorage.removeItem('hkRainSheetUserMode');
}

function initRainHomeShell() {
  migrateLegacySheetStorage();
  stripLegacySheetState();

  const panel = document.getElementById('forecast-panel');
  if (panel) {
    panelObserver = new MutationObserver(restorePanelIfNeeded);
    panelObserver.observe(panel, {
      attributes:true,
      attributeFilter:['class', 'style', 'data-sheet']
    });
  }

  bodyObserver = new MutationObserver(restoreBodyIfNeeded);
  bodyObserver.observe(document.body, {
    attributes:true,
    attributeFilter:['class']
  });

  window.addEventListener('rain:map-mode-change', stripLegacySheetState);
}

document.addEventListener('DOMContentLoaded', initRainHomeShell, { once:true });
