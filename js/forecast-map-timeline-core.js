import { FORECAST_RAIN_SCALE } from './forecast-map-renderer.js';
import { getForecastMapFrameSummaries, getForecastMapRuntimeSnapshot, setForecastMapIndex } from './forecast-map-runtime.js';
import { toast } from './ui.js';

const HK_TIME = new Intl.DateTimeFormat('zh-HK', {
  timeZone:'Asia/Hong_Kong',
  hour:'2-digit',
  minute:'2-digit',
  hour12:false
});
const HK_DATE_TIME = new Intl.DateTimeFormat('zh-HK', {
  timeZone:'Asia/Hong_Kong',
  day:'2-digit',
  month:'2-digit',
  hour:'2-digit',
  minute:'2-digit',
  hour12:false
});
const DEFAULT_PLAYBACK_DELAY = 1000;
const PLAYBACK_DELAYS = Object.freeze([1600, 1000, 650]);

let ready = false;
let playbackTimer = null;
let playbackActive = false;
let playbackGeneration = 0;
let playbackDelay = normalizePlaybackDelay(localStorage.getItem('hkRainForecastSpeed'));

function validDate(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeText(value) {
  const date = validDate(value);
  return date ? HK_TIME.format(date) : '—';
}

function windowText(window) {
  const start = validDate(window?.start);
  const end = validDate(window?.end);
  if (!start || !end) return '有效時段不詳';
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Hong_Kong', year:'numeric', month:'2-digit', day:'2-digit' }).format(start)
    === new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Hong_Kong', year:'numeric', month:'2-digit', day:'2-digit' }).format(end);
  return sameDay ? `${HK_TIME.format(start)}–${HK_TIME.format(end)}` : `${HK_DATE_TIME.format(start)}–${HK_DATE_TIME.format(end)}`;
}

function rgbaCss(rgba) {
  const [r,g,b,a = 255] = rgba || [];
  return `rgba(${Number(r)||0},${Number(g)||0},${Number(b)||0},${Math.max(0, Math.min(255, Number(a)||0)) / 255})`;
}

function normalizePlaybackDelay(value) {
  const number = Number(value);
  return PLAYBACK_DELAYS.includes(number) ? number : DEFAULT_PLAYBACK_DELAY;
}

function ensureStyles() {
  if (document.getElementById('forecast-map-timeline-style')) return;
  const style = document.createElement('style');
  style.id = 'forecast-map-timeline-style';
  style.textContent = `
    .forecast-map-timeline{z-index:760}.forecast-map-timeline .timeline-head{gap:7px}.forecast-map-head{display:flex;align-items:center;gap:7px;min-width:0}.forecast-map-unit{padding:2px 5px;border:1px solid #3d5664;color:#9bdcff;font-size:.64rem;white-space:nowrap}.forecast-map-window{margin-left:auto;color:#d9d9d9;font-size:.72rem;white-space:nowrap}.forecast-map-counter{color:#818181;font-size:.68rem;white-space:nowrap}.forecast-frame-control{display:flex;align-items:stretch;gap:5px;margin:8px 0 7px}.forecast-play-button{flex:0 0 42px;min-width:42px;border:1px solid #3f464a;background:#090b0c;color:#d7e9f2;font-size:.8rem;box-shadow:inset 0 -2px 0 #1a779f}.forecast-play-button.playing{background:#08202c;color:#fff;box-shadow:inset 0 -2px 0 #22a7e0}.forecast-frame-buttons{display:flex;flex:1 1 auto;min-width:0;gap:5px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x proximity;scrollbar-width:thin;padding-bottom:2px}.forecast-frame-button{flex:0 0 72px;min-width:0;height:38px;padding:3px 4px;border:1px solid #3f464a;background:#090b0c;color:#9da7ac;font-size:.68rem;white-space:nowrap;scroll-snap-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.05}.forecast-frame-button small{margin-top:3px;color:#68747a;font-size:.54rem}.forecast-frame-button.loaded small{color:#8299a4}.forecast-frame-button.active{border-color:#277ca6;background:#08202c;color:#f4fbff;box-shadow:inset 0 -2px 0 #22a7e0}.forecast-frame-button.active small{color:#92daf8}.forecast-frame-button:active{background:#123347}.forecast-map-legend{display:flex;align-items:center;gap:5px;color:#8f969a;font-size:.61rem}.forecast-map-legend-title{margin-right:2px;color:#c0c5c8}.forecast-map-scale{display:flex;width:105px;height:6px;overflow:hidden;border-radius:2px}.forecast-map-scale i{display:block;flex:1;height:100%}.forecast-map-issued{margin-top:5px;color:#777f83;font-size:.6rem;line-height:1.3}.forecast-map-timeline.is-switching .forecast-frame-button{pointer-events:none;opacity:.72}
    @media(max-width:700px){.forecast-map-timeline{bottom:calc(96px + var(--safe-bottom))}.forecast-map-head{gap:5px}.forecast-map-unit{font-size:.57rem}.forecast-map-window{font-size:.64rem}.forecast-frame-control{gap:4px;margin-top:7px}.forecast-play-button{flex-basis:38px;min-width:38px}.forecast-frame-buttons{gap:4px}.forecast-frame-button{flex-basis:64px;height:36px;font-size:.63rem}.forecast-map-scale{width:82px}.forecast-map-issued{font-size:.56rem}}
  `;
  document.head.append(style);
}

function ensureTimeline() {
  let panel = document.getElementById('forecast-map-timeline');
  if (panel) return panel;
  const radar = document.getElementById('radar-timeline');
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer) return null;

  panel = document.createElement('section');
  panel.id = 'forecast-map-timeline';
  panel.className = 'radar-timeline forecast-map-timeline map-hud hidden';
  panel.setAttribute('aria-label', '未來兩小時降雨預報時間軸');
  panel.innerHTML = `
    <div class="timeline-head">
      <span class="forecast-map-head"><span id="forecast-map-title">兩小時預報</span><span id="forecast-map-unit" class="forecast-map-unit">mm / 30分鐘</span></span>
      <span id="forecast-map-window" class="forecast-map-window">—</span>
      <span id="forecast-map-counter" class="forecast-map-counter">0/0</span>
    </div>
    <div class="forecast-frame-control">
      <button id="forecast-play-button" class="forecast-play-button" type="button" aria-label="播放兩小時預報" title="自動播放">▶</button>
      <div id="forecast-frame-buttons" class="forecast-frame-buttons" role="group" aria-label="選擇預報有效時段"></div>
    </div>
    <div class="forecast-map-legend">
      <span class="forecast-map-legend-title">30分鐘累積雨量</span>
      <span>0.05</span>
      <span id="forecast-map-scale" class="forecast-map-scale" aria-hidden="true"></span>
      <span>10+ mm</span>
    </div>
    <div id="forecast-map-issued" class="forecast-map-issued">HKO 預報更新 —</div>`;
  (radar || mapContainer.lastElementChild)?.insertAdjacentElement(radar ? 'afterend' : 'beforebegin', panel);

  const scale = panel.querySelector('#forecast-map-scale');
  FORECAST_RAIN_SCALE.forEach(stop => {
    const segment = document.createElement('i');
    segment.style.background = rgbaCss(stop.rgba);
    scale?.append(segment);
  });
  return panel;
}

function updatePlaybackButton() {
  const button = document.getElementById('forecast-play-button');
  if (!button) return;
  button.textContent = playbackActive ? '❚❚' : '▶';
  button.classList.toggle('playing', playbackActive);
  button.setAttribute('aria-label', playbackActive ? '暫停兩小時預報' : '播放兩小時預報');
  button.title = playbackActive ? '暫停自動播放' : '自動播放';
}

function notifyPlaybackChange() {
  window.dispatchEvent(new CustomEvent('rain:forecast-playback-change', {
    detail:{ playing:playbackActive, delay:playbackDelay }
  }));
}

export function getForecastPlaybackState() {
  return { playing:playbackActive, delay:playbackDelay };
}

export function setForecastPlaybackSpeed(value) {
  playbackDelay = normalizePlaybackDelay(value);
  localStorage.setItem('hkRainForecastSpeed', String(playbackDelay));
  notifyPlaybackChange();
  return playbackDelay;
}

export function stopForecastPlayback() {
  const wasPlaying = playbackActive;
  playbackActive = false;
  playbackGeneration += 1;
  if (playbackTimer) clearTimeout(playbackTimer);
  playbackTimer = null;
  updatePlaybackButton();
  if (wasPlaying) notifyPlaybackChange();
}

function schedulePlaybackStep(generation, delay = playbackDelay) {
  if (!playbackActive || generation !== playbackGeneration) return;
  if (playbackTimer) clearTimeout(playbackTimer);
  playbackTimer = setTimeout(() => runPlaybackStep(generation), delay);
}

async function runPlaybackStep(generation) {
  if (!playbackActive || generation !== playbackGeneration) return;
  const snapshot = getForecastMapRuntimeSnapshot();
  if (!snapshot.ready || !snapshot.visible || snapshot.frameCount < 2) {
    stopForecastPlayback();
    return;
  }

  const nextIndex = snapshot.index >= snapshot.frameCount - 1 ? 0 : snapshot.index + 1;
  const success = await setFrame(nextIndex, { fromPlayback:true });
  if (!success || !playbackActive || generation !== playbackGeneration) return;
  const linger = nextIndex === snapshot.frameCount - 1 ? Math.round(playbackDelay * 1.5) : playbackDelay;
  schedulePlaybackStep(generation, linger);
}

export function toggleForecastPlayback(force) {
  const shouldPlay = typeof force === 'boolean' ? force : !playbackActive;
  if (!shouldPlay) {
    stopForecastPlayback();
    return false;
  }

  const snapshot = getForecastMapRuntimeSnapshot();
  if (!snapshot.ready || !snapshot.visible || snapshot.frameCount < 2) return false;
  if (playbackActive) return true;

  playbackActive = true;
  playbackGeneration += 1;
  const generation = playbackGeneration;
  updatePlaybackButton();
  notifyPlaybackChange();
  schedulePlaybackStep(generation, 250);
  return true;
}

function renderTimeline() {
  const panel = ensureTimeline();
  if (!panel) return;
  const snapshot = getForecastMapRuntimeSnapshot();
  const frames = getForecastMapFrameSummaries();
  if (!snapshot.ready || !snapshot.visible || !frames.length) {
    panel.classList.add('hidden');
    stopForecastPlayback();
    return;
  }

  panel.classList.remove('hidden');
  const swirls = snapshot.source === 'swirls';
  const selected = frames[snapshot.index] || frames[0];
  const title = panel.querySelector('#forecast-map-title');
  if (title) title.textContent = swirls ? '兩小時預報 · 6分鐘步進' : '兩小時預報 · 30分鐘後備';
  const unit = panel.querySelector('#forecast-map-unit');
  if (unit) unit.textContent = 'mm / 30分鐘';
  const windowLabel = panel.querySelector('#forecast-map-window');
  if (windowLabel) windowLabel.textContent = windowText(selected?.window);
  const counter = panel.querySelector('#forecast-map-counter');
  if (counter) counter.textContent = `${snapshot.index + 1}/${frames.length}`;
  const issued = panel.querySelector('#forecast-map-issued');
  if (issued) {
    issued.textContent = swirls
      ? `HKO SWIRLS 基準 ${timeText(snapshot.issueTime)} · 每6分鐘一格 · 每格為30分鐘累積 · 已載入 ${snapshot.loadedFrameCount}/${frames.length}`
      : `HKO 30分鐘後備預報 ${timeText(snapshot.issueTime)} · SWIRLS 暫不可用`;
  }

  const buttons = panel.querySelector('#forecast-frame-buttons');
  if (buttons) {
    buttons.replaceChildren(...frames.map((frame, frameIndex) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'forecast-frame-button';
      button.classList.toggle('loaded', Boolean(frame.loaded));
      button.dataset.forecastIndex = String(frameIndex);

      const time = document.createElement('span');
      time.textContent = timeText(frame.time);
      const lead = document.createElement('small');
      lead.textContent = Number.isFinite(frame.leadMinutes) ? `+${frame.leadMinutes} 分` : '—';
      button.append(time, lead);

      button.title = `預報有效 ${windowText(frame.window)}${swirls ? '；30分鐘累積雨量' : ''}`;
      button.setAttribute('aria-label', button.title);
      const selectedFrame = frameIndex === snapshot.index;
      button.classList.toggle('active', selectedFrame);
      button.setAttribute('aria-pressed', selectedFrame ? 'true' : 'false');
      return button;
    }));
  }
  updatePlaybackButton();
}

async function setFrame(frameIndex, { fromPlayback = false } = {}) {
  const panel = ensureTimeline();
  if (!panel) return false;
  if (!fromPlayback) stopForecastPlayback();
  panel.classList.add('is-switching');
  panel.setAttribute('aria-busy', 'true');
  try {
    await setForecastMapIndex(frameIndex);
    renderTimeline();
    panel.querySelector(`[data-forecast-index="${frameIndex}"]`)?.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
    return true;
  } catch (error) {
    if (fromPlayback) stopForecastPlayback();
    if (error?.name !== 'AbortError') toast(`預報時段載入失敗：${error?.message || error}`);
    renderTimeline();
    return false;
  } finally {
    panel.classList.remove('is-switching');
    panel.setAttribute('aria-busy', 'false');
  }
}

function setVisibleForMode(mode) {
  const panel = ensureTimeline();
  if (!panel) return;
  if (mode === 'forecast') renderTimeline();
  else {
    stopForecastPlayback();
    panel.classList.add('hidden');
  }
}

function initForecastTimeline() {
  if (ready) return;
  ready = true;
  ensureStyles();
  const panel = ensureTimeline();
  panel?.addEventListener('click', event => {
    const play = event.target.closest('#forecast-play-button');
    if (play && !play.disabled) {
      toggleForecastPlayback();
      return;
    }
    const button = event.target.closest('[data-forecast-index]');
    if (!button || button.disabled) return;
    setFrame(Number(button.dataset.forecastIndex));
  });
  window.addEventListener('rain:map-mode-change', event => setVisibleForMode(event.detail?.mode));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopForecastPlayback();
  });
}

document.addEventListener('DOMContentLoaded', initForecastTimeline, { once:true });
