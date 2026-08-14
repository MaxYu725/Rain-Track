export {
  getForecastPlaybackState,
  setForecastPlaybackSpeed,
  stopForecastPlayback,
  toggleForecastPlayback
} from './forecast-map-timeline-core.js';

const MOBILE_FORECAST_MEDIA = '(max-width:700px)';
const FORECAST_SHEET_GAP_PX = 10;
const FORECAST_TOP_GAP_PX = 12;

let positionFrame = 0;
let sheetResizeObserver = null;
let sheetMutationObserver = null;

function ensureAvoidanceStyles() {
  if (document.getElementById('forecast-map-sheet-avoidance-style')) return;
  const style = document.createElement('style');
  style.id = 'forecast-map-sheet-avoidance-style';
  style.textContent = `
    @media(max-width:700px){
      #forecast-map-timeline.forecast-map-timeline{bottom:var(--forecast-timeline-bottom,calc(96px + var(--safe-bottom)))}
      #forecast-map-timeline.forecast-map-timeline.sheet-obscured{visibility:hidden;pointer-events:none}
    }
  `;
  document.head.append(style);
}

function scheduleForecastTimelinePosition() {
  if (positionFrame) cancelAnimationFrame(positionFrame);
  positionFrame = requestAnimationFrame(() => {
    positionFrame = 0;
    positionForecastTimeline();
  });
}

function resetForecastTimelinePosition(timeline) {
  timeline?.style.removeProperty('--forecast-timeline-bottom');
  timeline?.classList.remove('sheet-obscured');
}

function positionForecastTimeline() {
  const timeline = document.getElementById('forecast-map-timeline');
  if (!timeline) return;

  if (!window.matchMedia(MOBILE_FORECAST_MEDIA).matches || timeline.classList.contains('hidden')) {
    resetForecastTimelinePosition(timeline);
    return;
  }

  const mapContainer = document.getElementById('map-container');
  const forecastPanel = document.getElementById('forecast-panel');
  if (!mapContainer || !forecastPanel) {
    resetForecastTimelinePosition(timeline);
    return;
  }

  // Resolve the original mobile bottom value first so safe-area insets remain intact.
  timeline.style.removeProperty('--forecast-timeline-bottom');
  timeline.classList.remove('sheet-obscured');
  const baseBottom = Number.parseFloat(getComputedStyle(timeline).bottom) || 96;

  const mapRect = mapContainer.getBoundingClientRect();
  const sheetRect = forecastPanel.getBoundingClientRect();
  const timelineRect = timeline.getBoundingClientRect();
  const sheetOverMap = sheetRect.width > 0
    && sheetRect.height > 0
    && sheetRect.top < mapRect.bottom
    && sheetRect.bottom > mapRect.top;

  if (!sheetOverMap) return;

  const availableAboveSheet = sheetRect.top - mapRect.top - FORECAST_SHEET_GAP_PX;
  if (availableAboveSheet < timelineRect.height + FORECAST_TOP_GAP_PX) {
    timeline.classList.add('sheet-obscured');
    return;
  }

  const requiredBottom = mapRect.bottom - sheetRect.top + FORECAST_SHEET_GAP_PX;
  const maxBottom = Math.max(baseBottom, mapRect.height - timelineRect.height - FORECAST_TOP_GAP_PX);
  const targetBottom = Math.min(Math.max(baseBottom, requiredBottom), maxBottom);
  timeline.style.setProperty('--forecast-timeline-bottom', `${Math.round(targetBottom)}px`);
}

function initForecastSheetAvoidance() {
  ensureAvoidanceStyles();
  const timeline = document.getElementById('forecast-map-timeline');
  const forecastPanel = document.getElementById('forecast-panel');
  if (!timeline || !forecastPanel) return;

  if ('ResizeObserver' in window) {
    sheetResizeObserver = new ResizeObserver(scheduleForecastTimelinePosition);
    sheetResizeObserver.observe(forecastPanel);
    sheetResizeObserver.observe(timeline);
  }

  sheetMutationObserver = new MutationObserver(scheduleForecastTimelinePosition);
  sheetMutationObserver.observe(forecastPanel, {
    attributes:true,
    attributeFilter:['class','style','data-sheet']
  });

  window.addEventListener('resize', scheduleForecastTimelinePosition, { passive:true });
  window.visualViewport?.addEventListener('resize', scheduleForecastTimelinePosition, { passive:true });
  window.visualViewport?.addEventListener('scroll', scheduleForecastTimelinePosition, { passive:true });
  window.addEventListener('rain:map-mode-change', scheduleForecastTimelinePosition);
  scheduleForecastTimelinePosition();
}

document.addEventListener('DOMContentLoaded', initForecastSheetAvoidance, { once:true });
