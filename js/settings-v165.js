const SEGMENTED_CONTROLS = Object.freeze({
  'radar-range': [
    ['64','64 km'],
    ['256','256 km']
  ],
  'radar-height': [
    ['3','3 km'],
    ['2','2 km']
  ],
  'radius-select': [
    ['1','1 km'],
    ['2','2 km'],
    ['3','3 km'],
    ['5','5 km']
  ],
  'radar-data-mode': [
    ['live','即時'],
    ['test','TEST']
  ],
  'radar-speed': [
    ['1100','慢'],
    ['750','標準'],
    ['500','快']
  ]
});

let syncQueued = false;

function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => {
    syncQueued = false;
    enhanceControls();
    ensureTimelineQuickSwitches();
    syncAll();
  });
}

function enhanceControls() {
  for (const [selectId, options] of Object.entries(SEGMENTED_CONTROLS)) {
    enhanceSelect(selectId, options);
  }
}

function enhanceSelect(selectId, options) {
  const select = document.getElementById(selectId);
  if (!select) return;

  let group = document.querySelector(`[data-segmented-for="${selectId}"]`);
  if (!group) {
    group = document.createElement('div');
    group.className = `settings-segmented settings-segmented-${options.length}`;
    group.dataset.segmentedFor = selectId;
    group.setAttribute('role','group');
    const label = document.querySelector(`label[for="${selectId}"]`);
    group.setAttribute('aria-label', label?.textContent?.trim() || selectId);

    for (const [value, text] of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settings-segment-button';
      button.dataset.value = value;
      button.textContent = text;
      button.setAttribute('aria-pressed','false');
      button.addEventListener('click', () => {
        if (button.disabled || select.disabled) return;
        if (select.value !== value) {
          select.value = value;
          select.dispatchEvent(new Event('change', { bubbles:true }));
        }
        queueSync();
        setTimeout(queueSync, 120);
      });
      group.append(button);
    }

    select.before(group);
    select.classList.add('settings-native-select');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden','true');
  }

  syncSegmented(select, group);
}

function syncSegmented(select, group) {
  const disabled = Boolean(select.disabled);
  group.classList.toggle('is-disabled', disabled);
  group.querySelectorAll('.settings-segment-button').forEach(button => {
    const option = [...select.options].find(item => item.value === button.dataset.value);
    const optionDisabled = Boolean(option?.disabled);
    const active = select.value === button.dataset.value;
    button.disabled = disabled || optionDisabled;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function ensureTimelineQuickSwitches() {
  const original = document.getElementById('radar-mode-chip');
  if (!original) return;

  let rangeButton = original;
  if (original.tagName !== 'BUTTON') {
    rangeButton = document.createElement('button');
    rangeButton.id = 'radar-mode-chip';
    rangeButton.type = 'button';
    rangeButton.className = `${original.className} radar-quick-chip`;
    rangeButton.textContent = original.textContent;
    original.replaceWith(rangeButton);
  } else {
    rangeButton.classList.add('radar-quick-chip');
  }

  if (!rangeButton.dataset.quickBound) {
    rangeButton.dataset.quickBound = '1';
    rangeButton.addEventListener('click', () => cycleSelect('radar-range', ['64','256']));
  }

  let heightButton = document.getElementById('radar-height-chip');
  if (!heightButton) {
    heightButton = document.createElement('button');
    heightButton.id = 'radar-height-chip';
    heightButton.type = 'button';
    heightButton.className = 'radar-mode-chip radar-height-chip radar-quick-chip';
    heightButton.addEventListener('click', () => cycleSelect('radar-height', ['3','2']));
    rangeButton.after(heightButton);
  }
}

function cycleSelect(selectId, values) {
  const select = document.getElementById(selectId);
  if (!select || select.disabled) return;
  const allowed = values.filter(value => {
    const option = [...select.options].find(item => item.value === value);
    return option && !option.disabled;
  });
  if (allowed.length < 2) return;
  const current = Math.max(0, allowed.indexOf(select.value));
  select.value = allowed[(current + 1) % allowed.length];
  select.dispatchEvent(new Event('change', { bubbles:true }));
  queueSync();
  setTimeout(queueSync, 160);
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
  rangeButton.title = `切換雷達覆蓋範圍，目前 ${range} km`;
  rangeButton.setAttribute('aria-label', rangeButton.title);

  if (!heightButton || !heightSelect) return;
  const heightAvailable = mode !== 'test' && range === '64' && !heightSelect.disabled && [...heightSelect.options].some(option => option.value === '2' && !option.disabled);
  heightButton.classList.toggle('hidden', !heightAvailable);
  heightButton.disabled = !heightAvailable;
  const height = heightSelect.value === '2' ? '2' : '3';
  const heightText = `${height} km高`;
  if (heightButton.textContent !== heightText) heightButton.textContent = heightText;
  heightButton.title = `切換雷達高度，目前 ${height} km`;
  heightButton.setAttribute('aria-label', heightButton.title);
}

function compactRadarStatusNote() {
  const toggle = document.getElementById('toggle-radar');
  const note = document.getElementById('radar-status-note');
  if (!toggle || !note || toggle.disabled) return;
  const height2 = document.querySelector('#radar-height option[value="2"]');
  const text = height2 && !height2.disabled
    ? 'HKO GIS 雷達 · 64 km 可選 2 / 3 km 高度'
    : 'HKO GIS 雷達';
  if (note.textContent !== text) note.textContent = text;
}

function restoreSettingsHeading() {
  const heading = document.querySelector('.settings-section-primary .panel-title');
  if (heading && heading.textContent !== '快速控制') heading.textContent = '快速控制';
}

function syncAll() {
  for (const selectId of Object.keys(SEGMENTED_CONTROLS)) {
    const select = document.getElementById(selectId);
    const group = document.querySelector(`[data-segmented-for="${selectId}"]`);
    if (select && group) syncSegmented(select, group);
  }
  restoreSettingsHeading();
  compactRadarStatusNote();
  syncTimelineQuickSwitches();
}

function init() {
  enhanceControls();
  ensureTimelineQuickSwitches();
  syncAll();

  document.addEventListener('change', event => {
    if (event.target instanceof HTMLSelectElement && SEGMENTED_CONTROLS[event.target.id]) {
      queueSync();
      setTimeout(queueSync, 120);
    }
  });

  const observer = new MutationObserver(queueSync);
  observer.observe(document.body, {
    subtree:true,
    childList:true,
    attributes:true,
    attributeFilter:['disabled','class']
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
else init();
