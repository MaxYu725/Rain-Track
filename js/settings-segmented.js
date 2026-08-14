import './rain-map-mode.js';

const SEGMENTED_CONTROLS = [
  { id:'radar-range', labels:{ '64':'64 km', '256':'256 km' } },
  { id:'radar-height', labels:{ '2':'2 km', '3':'3 km' } },
  { id:'radar-data-mode', labels:{ live:'即時 HKO', test:'TEST' } },
  { id:'radar-speed', labels:{ '1100':'慢', '750':'標準', '500':'快' } },
  { id:'radius-select', labels:{ '1':'1 km', '2':'2 km', '3':'3 km', '5':'5 km' } }
];

let drawerObserver = null;
let timelineObserver = null;

function associatedLabel(select) {
  return select.closest('.setting-row')?.querySelector('label') || null;
}

function controlLabel(select) {
  return associatedLabel(select)?.textContent?.trim() || select.getAttribute('aria-label') || '選項';
}

function syncSegmentedControl(config) {
  const select = document.getElementById(config.id);
  const group = document.querySelector(`[data-segmented-for="${config.id}"]`);
  if (!select || !group) return;

  group.querySelectorAll('.segment-btn').forEach(button => {
    const option = [...select.options].find(item => item.value === button.dataset.value);
    const selected = select.value === button.dataset.value;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    button.disabled = Boolean(select.disabled || option?.disabled);
  });
}

function syncAllSettingsControls() {
  SEGMENTED_CONTROLS.forEach(syncSegmentedControl);
  syncTimelineQuickSwitches();
}

function enhanceSegmentedControl(config) {
  const select = document.getElementById(config.id);
  if (!select) return;

  const existing = document.querySelector(`[data-segmented-for="${config.id}"]`);
  if (existing) {
    syncSegmentedControl(config);
    return;
  }

  const row = select.closest('.setting-row');
  if (!row) return;

  const group = document.createElement('div');
  group.className = `segmented-control segmented-${config.id}`;
  group.dataset.segmentedFor = config.id;
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', controlLabel(select));

  [...select.options].forEach(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'segment-btn';
    button.dataset.value = option.value;
    button.textContent = config.labels?.[option.value] || option.textContent.trim();
    button.addEventListener('click', () => {
      if (button.disabled) return;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles:true }));
      syncAllSettingsControls();
      setTimeout(syncAllSettingsControls, 0);
    });
    group.append(button);
  });

  row.classList.add('has-segmented-control');
  select.classList.add('segmented-source');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  associatedLabel(select)?.removeAttribute('for');
  select.insertAdjacentElement('afterend', group);
  select.addEventListener('change', syncAllSettingsControls);

  const stateObserver = new MutationObserver(syncAllSettingsControls);
  stateObserver.observe(select, { attributes:true, subtree:true, attributeFilter:['disabled','selected'] });
  syncSegmentedControl(config);
}

function cycleSelect(selectId, values) {
  const select = document.getElementById(selectId);
  if (!select || select.disabled) return;

  const allowed = values.filter(value => {
    const option = [...select.options].find(item => item.value === value);
    return option && !option.disabled;
  });
  if (allowed.length < 2) return;

  const current = allowed.indexOf(select.value);
  select.value = allowed[(current < 0 ? 0 : current + 1) % allowed.length];
  select.dispatchEvent(new Event('change', { bubbles:true }));
  syncAllSettingsControls();
  setTimeout(syncAllSettingsControls, 0);
}

function ensureTimelineQuickSwitches() {
  const original = document.getElementById('radar-mode-chip');
  if (!original) return;

  let rangeButton = original;
  if (original.tagName !== 'BUTTON') {
    rangeButton = document.createElement('button');
    rangeButton.type = 'button';
    rangeButton.id = 'radar-mode-chip';
    rangeButton.className = original.className;
    rangeButton.textContent = original.textContent;
    original.replaceWith(rangeButton);
  }

  rangeButton.classList.add('radar-quick-chip');
  if (rangeButton.dataset.quickSwitch !== 'range') {
    rangeButton.dataset.quickSwitch = 'range';
    rangeButton.addEventListener('click', () => cycleSelect('radar-range', ['64','256']));
  }

  let heightButton = document.getElementById('radar-height-chip');
  if (!heightButton) {
    heightButton = document.createElement('button');
    heightButton.type = 'button';
    heightButton.id = 'radar-height-chip';
    heightButton.className = 'radar-mode-chip radar-height-chip radar-quick-chip hidden';
    rangeButton.insertAdjacentElement('afterend', heightButton);
  }
  if (heightButton.dataset.quickSwitch !== 'height') {
    heightButton.dataset.quickSwitch = 'height';
    heightButton.addEventListener('click', () => cycleSelect('radar-height', ['3','2']));
  }

  syncTimelineQuickSwitches();
}

function syncTimelineQuickSwitches() {
  const rangeSelect = document.getElementById('radar-range');
  const heightSelect = document.getElementById('radar-height');
  const modeSelect = document.getElementById('radar-data-mode');
  const rangeButton = document.getElementById('radar-mode-chip');
  const heightButton = document.getElementById('radar-height-chip');
  if (!rangeSelect || !rangeButton) return;

  const mode = modeSelect?.value || (localStorage.getItem('hkRainRadarMode') === 'test' ? 'test' : 'live');
  const range = rangeSelect.value === '256' ? '256' : '64';
  const rangeText = mode === 'test' ? `TEST · ${range} km` : `${range} km`;
  if (rangeButton.textContent !== rangeText) rangeButton.textContent = rangeText;
  rangeButton.classList.toggle('test', mode === 'test');
  rangeButton.disabled = rangeSelect.disabled;
  rangeButton.title = `切換雷達覆蓋範圍，目前 ${range} km`;
  rangeButton.setAttribute('aria-label', rangeButton.title);

  if (!heightButton || !heightSelect) return;
  const availableHeights = ['3','2'].filter(value => {
    const option = [...heightSelect.options].find(item => item.value === value);
    return option && !option.disabled;
  });
  const heightAvailable = mode !== 'test' && range === '64' && !heightSelect.disabled && availableHeights.length > 1;
  heightButton.classList.toggle('hidden', !heightAvailable);
  heightButton.disabled = !heightAvailable;

  const height = heightSelect.value === '2' ? '2' : '3';
  const heightText = `${height} km高`;
  if (heightButton.textContent !== heightText) heightButton.textContent = heightText;
  heightButton.title = `切換雷達高度，目前 ${height} km`;
  heightButton.setAttribute('aria-label', heightButton.title);
}

function enhanceAvailableControls() {
  SEGMENTED_CONTROLS.forEach(enhanceSegmentedControl);
  ensureTimelineQuickSwitches();
  syncAllSettingsControls();
}

function initSegmentedSettings() {
  enhanceAvailableControls();

  const drawer = document.getElementById('settings-drawer');
  if (drawer && !drawerObserver) {
    drawerObserver = new MutationObserver(enhanceAvailableControls);
    drawerObserver.observe(drawer, { childList:true, subtree:true });
  }

  const timeline = document.getElementById('radar-timeline');
  if (timeline && !timelineObserver) {
    timelineObserver = new MutationObserver(() => {
      ensureTimelineQuickSwitches();
      syncTimelineQuickSwitches();
    });
    timelineObserver.observe(timeline, { childList:true, subtree:true });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initSegmentedSettings, 0);
});