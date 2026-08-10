const SEGMENTED_CONTROLS = [
  { id:'radar-range', labels:{ '64':'64 km', '256':'256 km' } },
  { id:'radar-height', labels:{ '2':'2 km', '3':'3 km' } },
  { id:'radar-data-mode', labels:{ live:'即時 HKO', test:'TEST' } },
  { id:'radar-speed', labels:{ '1100':'慢', '750':'標準', '500':'快' } },
  { id:'radius-select', labels:{ '1':'1 km', '2':'2 km', '3':'3 km', '5':'5 km' } }
];

let drawerObserver = null;

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

function syncAllSegmentedControls() {
  SEGMENTED_CONTROLS.forEach(syncSegmentedControl);
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
      syncAllSegmentedControls();
      setTimeout(syncAllSegmentedControls, 0);
    });
    group.append(button);
  });

  row.classList.add('has-segmented-control');
  select.classList.add('segmented-source');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  associatedLabel(select)?.removeAttribute('for');
  select.insertAdjacentElement('afterend', group);
  select.addEventListener('change', syncAllSegmentedControls);

  const stateObserver = new MutationObserver(syncAllSegmentedControls);
  stateObserver.observe(select, { attributes:true, subtree:true, attributeFilter:['disabled','selected'] });
  syncSegmentedControl(config);
}

function enhanceAvailableControls() {
  SEGMENTED_CONTROLS.forEach(enhanceSegmentedControl);
  syncAllSegmentedControls();
}

function initSegmentedSettings() {
  enhanceAvailableControls();
  const drawer = document.getElementById('settings-drawer');
  if (!drawer || drawerObserver) return;
  drawerObserver = new MutationObserver(enhanceAvailableControls);
  drawerObserver.observe(drawer, { childList:true, subtree:true });
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initSegmentedSettings, 0);
});
