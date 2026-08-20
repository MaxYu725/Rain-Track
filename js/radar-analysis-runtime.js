import {
  RADAR_ANALYSIS_SAMPLE_MAX_DIMENSION,
  analyzeRadarPixels,
  describeRadarAnalysis,
  summarizeRadarHistory
} from './radar-analysis.js';
import { state } from './state.js';

const analysisCache = new Map();
const imageCache = new Map();
let activeMode = 'off';
let warmToken = 0;
let currentFrameKey = '';

function frameKey(frame) {
  return `${state.radar.range}|${state.radar.height}|${frame?.time || ''}|${frame?.id || ''}`;
}

function resolveImageUrl(imageUrl) {
  return /^https?:/i.test(imageUrl)
    ? imageUrl
    : state.apiBase + (imageUrl.startsWith('/') ? '' : '/') + imageUrl;
}

function loadAnalysisImage(url) {
  if (imageCache.has(url)) return imageCache.get(url);
  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('雷達分析影像載入失敗'));
    image.src = url;
  }).catch(error => {
    imageCache.delete(url);
    throw error;
  });
  imageCache.set(url, promise);
  return promise;
}

function imageDataForAnalysis(image) {
  const naturalWidth = Number(image?.naturalWidth || image?.width);
  const naturalHeight = Number(image?.naturalHeight || image?.height);
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    throw new Error('雷達分析影像尺寸無效');
  }
  const scale = Math.min(1, RADAR_ANALYSIS_SAMPLE_MAX_DIMENSION / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently:true });
  if (!context) throw new Error('瀏覽器不支援雷達影像分析');
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

async function analyzeFrame(frame) {
  const key = frameKey(frame);
  if (!key || !frame?.imageUrl) return null;
  if (analysisCache.has(key)) return analysisCache.get(key);

  const promise = (async () => {
    const image = await loadAnalysisImage(resolveImageUrl(frame.imageUrl));
    const imageData = imageDataForAnalysis(image);
    return analyzeRadarPixels(imageData, frame, {
      location:state.selected,
      radiusKm:state.radiusKm,
      rangeKm:state.radar.range,
      heightKm:state.radar.height
    });
  })().catch(error => {
    analysisCache.delete(key);
    console.warn('Radar analysis skipped:', error?.message || error);
    return null;
  });
  analysisCache.set(key, promise);
  return promise;
}

function cachedAnalysisRows() {
  return state.radar.frames
    .map(frame => analysisCache.get(frameKey(frame)))
    .filter(value => value && typeof value.then !== 'function');
}

async function resolvedAnalysisRows() {
  const rows = [];
  for (const frame of state.radar.frames) {
    const cached = analysisCache.get(frameKey(frame));
    if (!cached) continue;
    try {
      const value = await cached;
      if (value) rows.push(value);
    } catch {}
  }
  return rows;
}

function ensureStyles() {
  if (document.getElementById('radar-analysis-style')) return;
  const style = document.createElement('style');
  style.id = 'radar-analysis-style';
  style.textContent = `
    .radar-analysis-card{position:absolute;z-index:1190;top:58px;left:12px;display:none;width:min(520px,calc(100% - 24px));padding:10px 12px;border:1px solid #364147;background:rgba(3,8,10,.9);box-shadow:0 4px 16px rgba(0,0,0,.38);backdrop-filter:blur(8px);pointer-events:none}
    .radar-analysis-card.visible{display:block}.radar-analysis-kicker{color:#76858c;font-size:.6rem;font-weight:650;letter-spacing:.07em}.radar-analysis-primary{margin-top:3px;color:#f1f7f9;font-size:.82rem;font-weight:650;line-height:1.35}.radar-analysis-nearby{margin-top:3px;color:#a9bac2;font-size:.72rem;line-height:1.35}.radar-analysis-motion{margin-top:6px;padding-top:6px;border-top:1px solid #263238;color:#80c7e9;font-size:.7rem;line-height:1.35}.radar-analysis-card.is-loading .radar-analysis-primary,.radar-analysis-card.is-loading .radar-analysis-nearby,.radar-analysis-card.is-loading .radar-analysis-motion{color:#7f8b90}
    @media(max-width:700px){.radar-analysis-card{top:51px;left:8px;width:calc(100% - 16px);padding:8px 10px}.radar-analysis-primary{font-size:.77rem}.radar-analysis-nearby,.radar-analysis-motion{font-size:.67rem}}
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
    <div class="radar-analysis-kicker">雷達判讀</div>
    <div class="radar-analysis-primary" data-radar-analysis-hk>正在分析香港雷達回波</div>
    <div class="radar-analysis-nearby" data-radar-analysis-nearby>正在分析所在地附近回波</div>
    <div class="radar-analysis-motion" data-radar-analysis-motion>正在觀察回波變化</div>`;
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
  const motion = card.querySelector('[data-radar-analysis-motion]');
  if (hk) hk.textContent = '正在分析香港雷達回波';
  if (nearby) nearby.textContent = `正在分析${state.selected?.name || '所在地'}附近回波`;
  if (motion) motion.textContent = '正在觀察回波變化';
}

async function renderAnalysis(frame) {
  if (activeMode !== 'radar' || !frame) return;
  const key = frameKey(frame);
  currentFrameKey = key;
  setCardVisible(true);
  renderLoading();

  const current = await analyzeFrame(frame);
  if (activeMode !== 'radar' || currentFrameKey !== key) return;
  const rows = await resolvedAnalysisRows();
  const history = summarizeRadarHistory(rows, { location:state.selected });
  const text = describeRadarAnalysis(current, history, { locationName:state.selected?.name || '所在地' });
  const card = ensureCard();
  if (!card || currentFrameKey !== key) return;
  card.classList.remove('is-loading');
  const hk = card.querySelector('[data-radar-analysis-hk]');
  const nearby = card.querySelector('[data-radar-analysis-nearby]');
  const motion = card.querySelector('[data-radar-analysis-motion]');
  if (hk) hk.textContent = text.hongKongText;
  if (nearby) nearby.textContent = text.nearbyText;
  if (motion) motion.textContent = text.motionText;
  card.dataset.analysisConfidence = text.confidence || 'low';
  card.dataset.analysisFocus = text.focus || 'insufficient';
}

async function warmRecentHistory() {
  const token = ++warmToken;
  const frames = state.radar.frames.slice(-6);
  for (const frame of frames) {
    if (token !== warmToken || activeMode !== 'radar') return;
    await analyzeFrame(frame);
  }
  if (token !== warmToken || activeMode !== 'radar') return;
  const current = state.radar.frames[state.radar.index];
  if (current) void renderAnalysis(current);
}

function resetForLocationChange() {
  analysisCache.clear();
  ++warmToken;
  const current = state.radar.frames[state.radar.index];
  if (activeMode === 'radar' && current) {
    void renderAnalysis(current);
    void warmRecentHistory();
  }
}

function initRadarAnalysis() {
  ensureCard();
  window.addEventListener('rain:map-mode-change', event => {
    activeMode = event.detail?.mode || 'off';
    const visible = activeMode === 'radar';
    setCardVisible(visible);
    if (!visible) {
      ++warmToken;
      currentFrameKey = '';
      return;
    }
    const current = state.radar.frames[state.radar.index];
    if (current) {
      void renderAnalysis(current);
      void warmRecentHistory();
    }
  });
  window.addEventListener('rain:radar-frame-change', event => {
    if (activeMode !== 'radar') return;
    const frame = event.detail?.frame;
    if (!frame) return;
    void renderAnalysis(frame);
    void warmRecentHistory();
  });
  window.addEventListener('rain:location-change', resetForLocationChange);
  window.addEventListener('rain:refresh', resetForLocationChange);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRadarAnalysis, { once:true });
} else {
  initRadarAnalysis();
}
