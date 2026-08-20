import { describeRadarAnalysis } from './radar-analysis.js';
import { analyzeRadarFrameImage } from './radar-analysis-image.js';
import { state } from './state.js';

const analysisCache = new Map();
let activeMode = 'off';
let currentFrameKey = '';

function frameKey(frame) {
  return `${state.radar.range}|${state.radar.height}|${frame?.time || ''}|${frame?.id || ''}`;
}

async function analyzeFrame(frame) {
  const key = frameKey(frame);
  if (!key || !frame?.imageUrl) return null;
  if (analysisCache.has(key)) return analysisCache.get(key);

  const promise = analyzeRadarFrameImage(frame, {
    apiBase:state.apiBase,
    location:state.selected,
    radiusKm:state.radiusKm,
    rangeKm:state.radar.range,
    heightKm:state.radar.height
  }).catch(error => {
    analysisCache.delete(key);
    console.warn('Radar analysis skipped:', error?.message || error);
    return null;
  });
  analysisCache.set(key, promise);
  return promise;
}

function ensureStyles() {
  if (document.getElementById('radar-analysis-style')) return;
  const style = document.createElement('style');
  style.id = 'radar-analysis-style';
  style.textContent = `
    .radar-analysis-card{position:absolute;z-index:1190;top:58px;left:12px;display:none;width:min(520px,calc(100% - 24px));padding:9px 12px;border:1px solid #364147;background:rgba(3,8,10,.9);box-shadow:0 4px 16px rgba(0,0,0,.38);backdrop-filter:blur(8px);pointer-events:none}
    .radar-analysis-card.visible{display:block}.radar-analysis-kicker{color:#76858c;font-size:.6rem;font-weight:650;letter-spacing:.07em}.radar-analysis-primary{margin-top:3px;color:#f1f7f9;font-size:.82rem;font-weight:650;line-height:1.35}.radar-analysis-nearby{margin-top:3px;color:#a9bac2;font-size:.72rem;line-height:1.35}.radar-analysis-card.is-loading .radar-analysis-primary,.radar-analysis-card.is-loading .radar-analysis-nearby{color:#7f8b90}
    @media(max-width:700px){.radar-analysis-card{top:51px;left:8px;width:calc(100% - 16px);padding:8px 10px}.radar-analysis-primary{font-size:.77rem}.radar-analysis-nearby{font-size:.67rem}}
  `;
  document.head.append(style);
}

function ensureCard() {
  let card = document.getElementById('radar-analysis-card');
  if (card) return card;
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer) return null;
  ensureStyles();
  card = document.createElement('section');
  card.id = 'radar-analysis-card';
  card.className = 'radar-analysis-card';
  card.setAttribute('aria-live', 'polite');
  card.innerHTML = `
    <div class="radar-analysis-kicker">目前回波</div>
    <div class="radar-analysis-primary" data-radar-analysis-hk>正在分析香港目前回波</div>
    <div class="radar-analysis-nearby" data-radar-analysis-nearby>正在分析所在地附近目前回波</div>`;
  mapContainer.append(card);
  return card;
}

function setCardVisible(visible) {
  const card = ensureCard();
  if (!card) return;
  card.classList.toggle('visible', Boolean(visible));
  card.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function renderLoading() {
  const card = ensureCard();
  if (!card) return;
  card.classList.add('is-loading');
  const hk = card.querySelector('[data-radar-analysis-hk]');
  const nearby = card.querySelector('[data-radar-analysis-nearby]');
  if (hk) hk.textContent = '正在分析香港目前回波';
  if (nearby) nearby.textContent = `正在分析${state.selected?.name || '所在地'}附近目前回波`;
}

async function renderAnalysis(frame) {
  if (activeMode !== 'radar' || !frame) return;
  const key = frameKey(frame);
  currentFrameKey = key;
  setCardVisible(true);
  renderLoading();

  const current = await analyzeFrame(frame);
  if (activeMode !== 'radar' || currentFrameKey !== key) return;
  const text = describeRadarAnalysis(current, { locationName:state.selected?.name || '所在地' });
  const card = ensureCard();
  if (!card || currentFrameKey !== key) return;
  card.classList.remove('is-loading');
  const hk = card.querySelector('[data-radar-analysis-hk]');
  const nearby = card.querySelector('[data-radar-analysis-nearby]');
  if (hk) hk.textContent = text.hongKongText;
  if (nearby) nearby.textContent = text.nearbyText;
}

function resetForLocationChange() {
  analysisCache.clear();
  const current = state.radar.frames[state.radar.index];
  if (activeMode === 'radar' && current) void renderAnalysis(current);
}

function initRadarAnalysis() {
  ensureCard();
  window.addEventListener('rain:map-mode-change', event => {
    activeMode = event.detail?.mode || 'off';
    const visible = activeMode === 'radar';
    setCardVisible(visible);
    if (!visible) {
      currentFrameKey = '';
      return;
    }
    const current = state.radar.frames[state.radar.index];
    if (current) void renderAnalysis(current);
  });
  window.addEventListener('rain:radar-frame-change', event => {
    if (activeMode !== 'radar') return;
    const frame = event.detail?.frame;
    if (!frame) return;
    void renderAnalysis(frame);
  });
  window.addEventListener('rain:location-change', resetForLocationChange);
  window.addEventListener('rain:refresh', resetForLocationChange);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRadarAnalysis, { once:true });
} else {
  initRadarAnalysis();
}
