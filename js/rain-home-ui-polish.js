export function splitNowNextTimingText(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const parts = text.split(/\s+·\s+/).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return [];
  return [
    { label:'現在', text:parts[0] },
    { label:'接下來', text:parts.slice(1).join(' · ') }
  ];
}

export function observedRadarLooksDry(classNames) {
  const names = Array.isArray(classNames) ? classNames : [];
  if (!names.length) return false;
  return names.every(value => !/\blevel-[1-5]\b/.test(String(value || '')));
}

function injectStyles() {
  if (document.getElementById('rain-home-ui-polish-v2-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-home-ui-polish-v2-style';
  style.textContent = `
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-location{padding-bottom:15px}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-summary{padding:22px 0 20px}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-verdict{max-width:620px;font-size:clamp(1.9rem,5.3vw,2.65rem);font-weight:390;line-height:1.06}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-detail{max-width:620px;margin-top:12px;color:#9aa6ac;line-height:1.55}

    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-timing[data-rain-home-timing-polished="1"]{
      display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:14px;color:#aab7bd;font-size:.76rem;font-weight:540;line-height:1.38
    }
    .rain-home-now-next-item{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:7px;padding:8px 9px;border:1px solid #1c292f;background:#050a0d}
    .rain-home-now-next-label{color:#7f949e;font-size:.64rem;font-weight:720;letter-spacing:.06em;white-space:nowrap}
    .rain-home-now-next-copy{min-width:0;color:#aab7bd}

    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-observed{margin-bottom:12px}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-observed.is-dry{padding:9px 10px 8px}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-observed.is-dry .rain-home-observed-summary{margin-top:4px}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-observed.is-dry .rain-home-observed-track,
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-observed.is-dry .rain-home-observed-legend{display:none}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-observed.is-dry .rain-home-observed-times{margin-top:6px;padding-top:6px;border-top:1px solid #162126}

    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-chart-section{padding-top:16px}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-chart-wrap{padding:10px 9px 9px}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-chart-scroll{width:100%;overflow:visible!important;padding-bottom:0!important}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-chart-scroll::-webkit-scrollbar{display:none}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-chart-scroll .rain-home-chart{display:block;width:100%!important;max-width:100%!important;height:auto!important;touch-action:pan-y!important}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-chart-scroll-hint{display:none!important}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-chart-y-gutter{display:none!important}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-chart[data-rain-home-fixed-y-axis="2"] .rain-home-axis-label{opacity:1!important}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-unavailable-zone{opacity:.006}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-first-lead{opacity:.28}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-intensity-legend{margin-bottom:6px}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-chart-help{margin-top:5px}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-chart-readout{min-height:58px;margin-top:8px;padding:9px 11px}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-meta{margin-top:10px}
    .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-primary-action{margin-top:18px}

    @media(max-width:700px){
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-summary{padding:16px 0 14px}
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-verdict{font-size:clamp(1.75rem,7.7vw,2.25rem)}
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-detail{font-size:.86rem;line-height:1.52}
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-timing[data-rain-home-timing-polished="1"]{grid-template-columns:1fr;margin-top:11px}
      .rain-home-now-next-item{padding:7px 8px}
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-chart-section{padding-top:14px}
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-chart-wrap{padding:9px 7px 8px}
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-axis-label{font-size:12px}
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-axis-clock{font-size:13px}
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-axis-lead{font-size:11px}
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-chart-readout{grid-template-columns:minmax(0,1fr) auto!important;gap:8px 12px}
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-readout-value{text-align:right!important}
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-readout-unit{display:block!important;margin-left:0!important}
    }

    @media(max-width:390px){
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-chart-readout{grid-template-columns:minmax(0,1fr) auto!important}
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-readout-time{font-size:.82rem}
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-readout-window{font-size:.62rem}
      .rain-home-root[data-rain-home-ui-polish="2"] .rain-home-readout-value{font-size:1.08rem}
    }
  `;
  document.head.append(style);
}

function polishTiming(root) {
  const timing = root.querySelector('.rain-home-timing');
  if (!timing || timing.querySelector('.rain-home-now-next-item')) return;
  const rows = splitNowNextTimingText(timing.textContent);
  if (rows.length !== 2) return;
  const aria = rows.map(row => row.text).join(' · ');
  timing.replaceChildren(...rows.map(row => {
    const item = document.createElement('span');
    item.className = 'rain-home-now-next-item';
    const label = document.createElement('span');
    label.className = 'rain-home-now-next-label';
    label.textContent = row.label;
    const copy = document.createElement('span');
    copy.className = 'rain-home-now-next-copy';
    copy.textContent = row.text;
    item.append(label, copy);
    return item;
  }));
  timing.dataset.rainHomeTimingPolished = '1';
  timing.setAttribute('aria-label', aria);
}

function polishRadar(root) {
  const observed = root.querySelector('[data-rain-home-observed-radar]');
  if (!observed) return;
  const classes = [...observed.querySelectorAll('.rain-home-observed-segment')].map(node => node.className);
  observed.classList.toggle('is-dry', observedRadarLooksDry(classes));
}

function polishChart(root) {
  const chart = root.querySelector('.rain-home-chart');
  if (!chart) return;
  chart.closest('.rain-home-chart-wrap')?.setAttribute('data-rain-home-fit-chart', '1');
  [...chart.querySelectorAll('.rain-home-axis-lead')].forEach(label => {
    if (String(label.textContent || '').trim() === '基準') label.closest('text')?.setAttribute('display', 'none');
  });
  chart.querySelector('.rain-home-unavailable-label')?.setAttribute('display', 'none');
}

export function polishRainHomeRoot(root) {
  if (!root || root.dataset?.viewKind !== 'ready') return false;
  root.dataset.rainHomeUiPolish = '2';
  polishTiming(root);
  polishRadar(root);
  polishChart(root);
  return true;
}

let scheduled = false;
function schedulePolish() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const root = document.querySelector('.rain-home-root[data-view-kind="ready"]');
    if (root) polishRainHomeRoot(root);
  });
}

function initRainHomeUiPolish() {
  injectStyles();
  schedulePolish();
  const content = document.getElementById('forecast-content');
  if (content) {
    const observer = new MutationObserver(schedulePolish);
    observer.observe(content, { childList:true, subtree:true, characterData:true });
  }
  window.addEventListener('rain:location-change', schedulePolish);
  window.addEventListener('rain:refresh', schedulePolish);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initRainHomeUiPolish, { once:true });
  else initRainHomeUiPolish();
}
