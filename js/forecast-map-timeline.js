export {
  getForecastPlaybackState,
  setForecastPlaybackSpeed,
  stopForecastPlayback,
  toggleForecastPlayback
} from './forecast-map-timeline-core.js';

function ensureMapFirstTimelinePosition() {
  if (document.getElementById('forecast-map-fullscreen-position-style')) return;
  const style = document.createElement('style');
  style.id = 'forecast-map-fullscreen-position-style';
  style.textContent = `
    @media(max-width:700px){
      #forecast-map-timeline.forecast-map-timeline{
        bottom:calc(14px + var(--safe-bottom))!important;
      }
    }
  `;
  document.head.append(style);
}

document.addEventListener('DOMContentLoaded', ensureMapFirstTimelinePosition, { once:true });
