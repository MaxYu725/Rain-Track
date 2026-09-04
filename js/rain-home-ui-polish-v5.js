import './rain-home-ui-polish.js';

function injectStyles() {
  if (document.getElementById('rain-home-ui-polish-v5-style')) return;
  const style = document.createElement('style');
  style.id = 'rain-home-ui-polish-v5-style';
  style.textContent = `
    .rain-home-root[data-rain-home-ui-polish-v5="1"].is-dry-chart .rain-home-intensity-legend,
    .rain-home-root[data-rain-home-ui-polish-v5="1"].is-dry-chart .rain-home-chart-scroll{display:none!important}
    .rain-home-root[data-rain-home-ui-polish-v5="1"] .rain-home-dry-timeline{display:none}
    .rain-home-root[data-rain-home-ui-polish-v5="1"].is-dry-chart .rain-home-dry-timeline{display:block;padding:7px 2px 2px}
    .rain-home-dry-timeline-points{position:relative;display:grid;grid-template-columns:repeat(16,minmax(0,1fr));align-items:center;height:34px}
    .rain-home-dry-timeline-points::before{content:"";position:absolute;left:2px;right:2px;top:50%;height:2px;transform:translateY(-50%);background:#148dc5;opacity:.9}
    .rain-home-dry-timeline-point{position:relative;z-index:1;width:100%;height:34px;padding:0;border:0;background:transparent;color:inherit}
    .rain-home-dry-timeline-point::before{content:"";position:absolute;left:50%;top:50%;width:7px;height:7px;transform:translate(-50%,-50%);border:2px solid #1ba1e2;border-radius:50%;background:#061018}
    .rain-home-dry-timeline-point.selected::before{width:11px;height:11px;background:#1ba1e2;box-shadow:0 0 0 3px rgba(27,161,226,.12)}
    .rain-home-dry-timeline-labels{position:relative;height:34px;margin-top:0;color:#76858c;font-variant-numeric:tabular-nums}
    .rain-home-dry-timeline-label{position:absolute;top:0;display:flex;flex-direction:column;gap:1px;white-space:nowrap;font-size:.61rem;line-height:1.15}
    .rain-home-dry-timeline-label strong{color:#9eabb1;font-size:.68rem;font-weight:620}
    .rain-home-dry-timeline-label[data-edge="start"]{left:0;text-align:left}
    .rain-home-dry-timeline-label[data-edge="middle"]{transform:translateX(-50%);text-align:center}
    .rain-home-dry-timeline-label[data-edge="end"]{right:0;text-align:right}
    .rain-home-root[data-rain-home-ui-polish-v5="1"].is-dry-chart .rain-home-chart-wrap{padding-top:7px}
    .rain-home-root[data-rain-home-ui-polish-v5="1"].is-dry-chart .rain-home-chart-help{margin-top:1px}

    @media(max-width:700px){
      body.rain-home-v2:not(.rain-map-view) #locate-button{display:none!important}
      .rain-home-root[data-rain-home-ui-polish-v5="1"] .rain-home-location{padding-bottom:7px}
      .rain-home-root[data-rain-home-ui-polish-v5="1"] .rain-home-location-coord{display:none}
      .rain-home-root[data-rain-home-ui-polish-v5="1"] .rain-home-locate{min-height:36px;padding:0 10px;font-size:.82rem}
      .rain-home-root[data-rain-home-ui-polish-v5="1"].is-dry-chart .rain-home-chart-wrap{padding:6px 7px 5px}
      .rain-home-root[data-rain-home-ui-polish-v5="1"].is-dry-chart .rain-home-chart-help{font-size:.6rem}
    }
  `;
  document.head.append(style);
}

function clockFromHit(hit) {
  const label = String(hit?.getAttribute('aria-label') || '');
  return label.match(/\b\d{1,2}:\d{2}\b/)?.[0] || '';
}

function leadFromDot(dot) {
  const value = Number(dot?.dataset?.leadMinutes);
  return Number.isFinite(value) ? value : null;
}

function selectedIndex(chart) {
  return [...chart.querySelectorAll('.rain-home-dot')].findIndex(dot => dot.classList.contains('selected'));
}

function syncSelection(timeline, chart) {
  const selected = selectedIndex(chart);
  timeline.querySelectorAll('.rain-home-dry-timeline-point').forEach((button, index) => {
    button.classList.toggle('selected', index === selected);
    button.setAttribute('aria-pressed', index === selected ? 'true' : 'false');
  });
}

function buildDryTimeline(root) {
  const chart = root.querySelector('.rain-home-chart');
  const wrap = chart?.closest('.rain-home-chart-wrap');
  if (!chart || !wrap || !root.classList.contains('is-dry-chart')) return;

  const hits = [...chart.querySelectorAll('[data-rain-home-point]')];
  const dots = [...chart.querySelectorAll('.rain-home-dot')];
  if (!hits.length || hits.length !== dots.length) return;

  const rows = hits.map((hit, index) => ({
    hit,
    dot:dots[index],
    clock:clockFromHit(hit),
    lead:leadFromDot(dots[index])
  }));
  if (rows.some(row => row.lead === null)) return;

  const signature = rows.map(row => `${row.lead}:${row.clock}`).join('|');
  let timeline = wrap.querySelector('.rain-home-dry-timeline');
  if (!timeline) {
    timeline = document.createElement('div');
    timeline.className = 'rain-home-dry-timeline';
    timeline.setAttribute('aria-label', '未來兩小時雨量時間線');
    const scroll = wrap.querySelector('.rain-home-chart-scroll');
    if (scroll) scroll.before(timeline);
    else wrap.prepend(timeline);
  }

  if (timeline.dataset.signature !== signature) {
    const points = document.createElement('div');
    points.className = 'rain-home-dry-timeline-points';
    rows.forEach((row, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rain-home-dry-timeline-point';
      button.setAttribute('aria-label', row.hit.getAttribute('aria-label') || `${row.clock} +${row.lead}`);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        row.hit.click();
        timeline.querySelectorAll('.rain-home-dry-timeline-point').forEach((node, nodeIndex) => node.classList.toggle('selected', nodeIndex === index));
      });
      points.append(button);
    });

    const labels = document.createElement('div');
    labels.className = 'rain-home-dry-timeline-labels';
    const majorLeads = [30, 60, 90, 120];
    majorLeads.forEach((lead, index) => {
      const row = rows.find(item => item.lead === lead);
      if (!row) return;
      const label = document.createElement('span');
      label.className = 'rain-home-dry-timeline-label';
      label.dataset.edge = index === 0 ? 'start' : index === majorLeads.length - 1 ? 'end' : 'middle';
      if (index > 0 && index < majorLeads.length - 1) label.style.left = `${index * 100 / (majorLeads.length - 1)}%`;
      const clock = document.createElement('strong');
      clock.textContent = row.clock;
      const leadText = document.createElement('span');
      leadText.textContent = `+${lead}`;
      label.append(clock, leadText);
      labels.append(label);
    });

    timeline.replaceChildren(points, labels);
    timeline.dataset.signature = signature;
  }

  syncSelection(timeline, chart);
}

function apply(root) {
  if (!root || root.dataset?.viewKind !== 'ready') return;
  root.dataset.rainHomeUiPolishV5 = '1';
  buildDryTimeline(root);
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    apply(document.querySelector('.rain-home-root[data-view-kind="ready"]'));
  });
}

function init() {
  injectStyles();
  schedule();
  requestAnimationFrame(schedule);
  setTimeout(schedule, 280);
  const content = document.getElementById('forecast-content');
  if (content) new MutationObserver(schedule).observe(content, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['class'] });
  window.addEventListener('rain:location-change', schedule);
  window.addEventListener('rain:refresh', schedule);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
}
