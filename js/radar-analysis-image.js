import {
  RADAR_ANALYSIS_SAMPLE_MAX_DIMENSION,
  analyzeRadarPixels
} from './radar-analysis.js';

export function resolveRadarAnalysisImageUrl(imageUrl, apiBase = '') {
  const value = String(imageUrl || '').trim();
  if (!value) return '';
  if (/^https?:/i.test(value)) return value;
  const base = String(apiBase || '').replace(/\/$/, '');
  return `${base}${value.startsWith('/') ? '' : '/'}${value}`;
}

export function loadRadarAnalysisImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('雷達分析影像載入失敗'));
    image.src = url;
  });
}

export function imageDataForRadarAnalysis(image, { maxDimension = RADAR_ANALYSIS_SAMPLE_MAX_DIMENSION } = {}) {
  const naturalWidth = Number(image?.naturalWidth || image?.width);
  const naturalHeight = Number(image?.naturalHeight || image?.height);
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    throw new Error('雷達分析影像尺寸無效');
  }
  const limit = Number.isFinite(Number(maxDimension)) && Number(maxDimension) > 0
    ? Number(maxDimension)
    : RADAR_ANALYSIS_SAMPLE_MAX_DIMENSION;
  const scale = Math.min(1, limit / Math.max(naturalWidth, naturalHeight));
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

export async function analyzeRadarFrameImage(frame, {
  apiBase = '',
  location = null,
  radiusKm = 2,
  rangeKm = null,
  heightKm = null,
  maxDimension = RADAR_ANALYSIS_SAMPLE_MAX_DIMENSION
} = {}) {
  if (!frame?.imageUrl) return null;
  const url = resolveRadarAnalysisImageUrl(frame.imageUrl, apiBase);
  if (!url) return null;
  const image = await loadRadarAnalysisImage(url);
  const imageData = imageDataForRadarAnalysis(image, { maxDimension });
  return analyzeRadarPixels(imageData, frame, { location, radiusKm, rangeKm, heightKm });
}
