const LEGACY_SHEET_CLASSES = Object.freeze([
  'collapsed',
  'sheet-peek',
  'sheet-half',
  'sheet-full',
  'dragging'
]);

let panelObserver = null;
let bodyObserver = null;

function stripLegacySheetState() {
  document.getElementById('sheet-handle')?.remove();
  document.getElementById('forecast-toggle')?.remove();

  const panel = document.getElementById('forecast-panel');
  if (panel) {
    LEGACY_SHEET_CLASSES.forEach(className => panel.classList.remove(className));
    panel.removeAttribute('data-sheet');
    panel.style.removeProperty('height');
  }

  document.body.classList.remove('sheet-peek-active', 'sheet-expanded-active');
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
    panelObserver = new MutationObserver(stripLegacySheetState);
    panelObserver.observe(panel, {
      attributes:true,
      attributeFilter:['class', 'style', 'data-sheet']
    });
  }

  bodyObserver = new MutationObserver(stripLegacySheetState);
  bodyObserver.observe(document.body, {
    attributes:true,
    attributeFilter:['class']
  });

  window.addEventListener('rain:map-mode-change', stripLegacySheetState);
}

document.addEventListener('DOMContentLoaded', initRainHomeShell, { once:true });
