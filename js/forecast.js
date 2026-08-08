import { state } from './state.js';
import { announce, setBadge, setMobileStatus, setSheetMode } from './ui.js';
import { escapeHtml, formatDateTime, formatPeriodWindow, formatRain, formatTime, isMobileLayout, rainLevel } from './utils.js';
import { renderPointLayers } from './map.js';

export function renderLoading(point, { retain = false } = {}) {
  if (retain && state.forecast) return;
  const content = document.getElementById('forecast-content');
  if (!content) return;
  document.getElementById('forecast-panel')?.classList.remove('dry-forecast');
  content.innerHTML = `<div class="location-row"><div><h1 class="location-name"></h1><div class="location-coord">${point.lat.toFixed(4)}°N, ${point.lon.toFixed(4)}°E</div></div></div><div class="sheet-peek-summary"><span>正在計算預報…</span><strong>請稍候</strong></div><div class="empty-state"><div class="spinner" aria-hidden="true"></div><div>正在計算未來兩小時雨量…</div></div>`;
  content.querySelector('.location-name').textContent = point.name;
  setMobileStatus('loading','正在載入預報');
}

export function renderForecast({ cacheNotice = '' } = {}) {
  const data = state.forecast;
  if (!data?.periods?.length) { renderError('沒有可用的定點預報'); return; }
  const content = document.getElementById('forecast-content');
  const panel = document.getElementById('forecast-panel');
  const quality = normalizeQuality(data);
  const periods = data.periods;
  const isDry = periods.every(period => (period.amountMm || 0) < .2 && (period.nearbyMaxMm || 0) < .2);
  const startWindow = getRainStartWindow(data, periods);
  const startText = startWindow ? `${formatTime(startWindow.start)}–${formatTime(startWindow.end)}` : '暫無';
  const issueText = data.issueTime ? formatDateTime(data.issueTime) : '時間不詳';
  const fetchedAt = state.forecastMeta.fetchedAt ? new Date(state.forecastMeta.fetchedAt).toISOString() : data.generatedAt;
  const fetchedText = fetchedAt ? formatTime(fetchedAt) : formatTime(new Date().toISOString());
  const validUntilText = getValidUntilText(periods);
  const nearbyPeak = Math.max(...periods.map(period => period.nearbyMaxMm || 0));
  const pointPeak = Math.max(...periods.map(period => period.amountMm || 0));
  const nearbyMessage = nearbyPeak >= .2 && nearbyPeak > pointPeak + .15
    ? `附近 ${data.nearbyRadiusKm || state.radiusKm} 公里最高預測 ${formatRain(nearbyPeak)} mm／30分鐘，比定點高 ${formatRain(nearbyPeak - pointPeak)} mm；雨區邊界可能接近。`
    : `附近 ${data.nearbyRadiusKm || state.radiusKm} 公里差異小。`;
  const trendMarkup = isDry
    ? `<div class="dry-state"><div class="dry-state-icon">${rainIconSvg('dry')}</div><div><div class="dry-state-title">未來兩小時雨量維持 0 mm</div><div class="dry-state-note">定點及附近 ${data.nearbyRadiusKm || state.radiusKm} 公里預報均未見明顯降雨。</div></div></div>`
    : `<div class="chart">${periods.map(renderChartColumn).join('')}</div>`;
  const cacheMarkup = cacheNotice ? `<div class="cache-notice">${escapeHtml(cacheNotice)}</div>` : '';
  const statusPills = buildStatusPills(quality);
  const summaryText = data.summary?.text || buildSummaryText(periods);
  const peekText = isDry ? '未來兩小時暫無明顯降雨' : summaryText;
  const now = Date.now();
  const nextFutureIndex = periods.findIndex(period => periodWindow(period).start > now);

  panel?.classList.toggle('dry-forecast', isDry);

  content.innerHTML = `
    <div class="location-row">
      <div><h1 id="location-name" class="location-name"></h1><div class="location-coord">${state.selected.lat.toFixed(4)}°N, ${state.selected.lon.toFixed(4)}°E</div></div>
      <div class="mini-actions">
        <button id="save-point-button" class="mini-btn" type="button" title="儲存位置" aria-label="儲存位置">${bookmarkSvg()}</button>
        <button id="share-point-button" class="mini-btn" type="button" title="分享位置" aria-label="分享位置">${shareSvg()}</button>
      </div>
    </div>
    <div id="forecast-updating" class="forecast-updating hidden"><span class="mini-spinner" aria-hidden="true"></span>正在更新資料</div>
    <div class="sheet-peek-summary"><span>${escapeHtml(peekText)}</span><strong>${formatRain(data.summary?.totalMm)} mm · ${escapeHtml(startText)}</strong></div>
    ${cacheMarkup}
    <div class="summary-card ${escapeHtml(quality.freshness.status)}">
      <div class="summary-main">${escapeHtml(summaryText)}</div>
      <div class="summary-meta">
        <span>預報基準 ${escapeHtml(issueText)}</span>
        <span>有效至 ${escapeHtml(validUntilText)}</span>
        <span class="meta-detail">本頁取得 ${escapeHtml(fetchedText)}</span>
        ${statusPills}
      </div>
    </div>
    <div class="mobile-data-alert ${escapeHtml(quality.freshness.status)}">${quality.freshness.status === 'normal' ? '' : `⚠ ${escapeHtml(quality.freshness.label)}${Number.isFinite(quality.freshness.sourceAgeMinutes) ? ` · ${quality.freshness.sourceAgeMinutes} 分鐘` : ''}`}</div>
    <div class="metrics">
      <div class="metric metric-primary"><div class="metric-value">${formatRain(data.summary?.totalMm)} mm</div><div class="metric-label">兩小時總雨量</div></div>
      <div class="metric metric-detail"><div class="metric-value">${formatRain(data.summary?.peakMm)} mm</div><div class="metric-label">最高／30分鐘</div></div>
      <div class="metric metric-primary"><div class="metric-value">${escapeHtml(startText)}</div><div class="metric-label">可能開始時段</div></div>
      <div class="metric metric-detail"><div class="metric-value">${escapeHtml(validUntilText)}</div><div class="metric-label">預報有效至</div></div>
    </div>
    <div class="section-head period-head"><h2 class="section-title">未來兩小時</h2><div class="section-note">每格為30分鐘累計雨量</div></div>
    <div class="period-grid ${isDry ? 'dry-period-grid' : ''}">${periods.map((period, index) => renderPeriodCard(period, index, !isDry, isDry, now, nextFutureIndex)).join('')}</div>
    <div class="section-head trend-head"><h2 class="section-title">雨量趨勢</h2><div class="section-note">${isDry ? '乾燥模式' : '固定雨量級別'}</div></div>
    ${trendMarkup}
    <div class="nearby-card"><strong>附近雨勢：</strong>${escapeHtml(nearbyMessage)}<br><span class="quality-note"><strong>${escapeHtml(quality.spatial.label)}：</strong>${escapeHtml(quality.spatial.note)}</span></div>
    <div class="source-note">資料來源：香港天文台「香港網格點降雨臨近預報」。時段顯示為半小時累計區間；定點值由相鄰四個官方網格作雙線性插值，屬自動預報結果，不是街道級實測。資料更新狀態與附近差異分開顯示，並不代表預報保證準確。</div>`;

  document.getElementById('location-name').textContent = state.selected.name;
  renderPointLayers();
  const seriousFreshness = ['stale','expired'].includes(quality.freshness.status);
  const titleSummary = seriousFreshness
    ? quality.freshness.label
    : isDry ? '暫無明顯降雨' : `預報至 ${validUntilText}`;
  document.getElementById('mobile-title-sub').textContent = `${state.selected.name} · ${titleSummary}`;
  document.getElementById('save-point-button')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('rain:save-point')));
  document.getElementById('share-point-button')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('rain:share-point')));

  const mobileState = quality.freshness.status === 'expired' || quality.freshness.status === 'stale'
    ? 'error'
    : quality.freshness.status === 'delayed' || quality.spatial.status === 'sensitive' ? 'loading' : 'ok';
  const mobileLabel = quality.freshness.status !== 'normal' ? quality.freshness.label : quality.spatial.status === 'sensitive' ? quality.spatial.label : quality.freshness.label;
  setMobileStatus(mobileState, mobileLabel);
  setBadge('point','ok','POINT');
  setBadge('hko', quality.freshness.status === 'expired' || quality.freshness.status === 'stale' ? 'error' : quality.freshness.status === 'delayed' ? 'loading' : 'ok', 'HKO');
  updateDataStatusDetail(data, quality, issueText, fetchedText, validUntilText, cacheNotice);
  applyAutomaticSheetMode(isDry, quality, periods);
  announce(`${state.selected.name}預報已更新。${summaryText}`);
}

function buildStatusPills(quality) {
  const chips = [];
  if (quality.freshness.status !== 'normal') {
    chips.push(`<span class="quality-pill ${escapeHtml(quality.freshness.status)} desktop-status-chip"><span class="quality-dot"></span>${escapeHtml(quality.freshness.label)}</span>`);
  }
  if (quality.spatial.status === 'sensitive') {
    chips.push(`<span class="quality-pill location-sensitive desktop-status-chip"><span class="quality-dot"></span>${escapeHtml(quality.spatial.label)}</span>`);
  }
  if (!chips.length) {
    chips.push(`<span class="quality-pill normal desktop-status-chip"><span class="quality-dot"></span>${escapeHtml(quality.freshness.label)}</span>`);
    chips.push(`<span class="quality-pill normal desktop-status-chip"><span class="quality-dot"></span>${escapeHtml(quality.spatial.label)}</span>`);
  }
  return chips.join('');
}

function applyAutomaticSheetMode(isDry, quality, periods) {
  if (!isMobileLayout() || state.sheet.userMode) return;
  const hasRain = periods.some(period => (period.amountMm || 0) >= .2 || (period.nearbyMaxMm || 0) >= .2);
  const seriousFreshness = quality.freshness.status === 'stale' || quality.freshness.status === 'expired';
  const spatialWarning = quality.spatial.status === 'sensitive';
  const mode = isDry && !hasRain && !seriousFreshness && !spatialWarning ? 'peek' : 'half';
  setSheetMode(mode, { persist:false, offset:false });
}

function normalizeQuality(data) {
  const raw = data.dataQuality || {};
  const freshness = raw.freshness || {
    status: ['expired','stale','delayed'].includes(raw.status) ? raw.status : 'normal',
    label: ['expired','stale','delayed'].includes(raw.status) ? raw.label : '資料更新正常',
    note: raw.note || '官方網格資料更新時間正常。',
    sourceAgeMinutes: raw.sourceAgeMinutes ?? null
  };
  const spatial = raw.spatial || {
    status: raw.status === 'location-sensitive' ? 'sensitive' : 'stable',
    label: raw.status === 'location-sensitive' ? '雨區邊界接近' : '附近差異小',
    note: raw.status === 'location-sensitive' ? raw.note : '定點與附近網格的預報變化相對平順。',
    nearbyDeltaMaxMm: raw.nearbyDeltaMaxMm ?? 0
  };
  if (spatial.status === 'stable' && spatial.label === '位置變化穩定') spatial.label = '附近差異小';
  if (spatial.status === 'sensitive' && spatial.label === '位置較敏感') spatial.label = '雨區邊界接近';
  return { freshness, spatial };
}

function getRainStartWindow(data, periods) {
  if (data.summary?.rainStartWindowStart && data.summary?.rainStartWindowEnd) return { start:data.summary.rainStartWindowStart, end:data.summary.rainStartWindowEnd };
  const first = periods.find(period => period.amountMm >= .2);
  if (!first?.time) return null;
  const end = new Date(first.time);
  return { start:new Date(end.getTime() - 30 * 60 * 1000).toISOString(), end:end.toISOString() };
}

function getValidUntilText(periods) {
  const last = periods.at(-1);
  return last?.time ? formatTime(last.time) : '—';
}

function buildSummaryText(periods) {
  const wet = periods.filter(period => period.amountMm >= .2);
  if (!wet.length) return periods.some(period => period.nearbyMaxMm >= .2)
    ? '定點未來兩小時暫未見明顯降雨，但附近地區可能有雨。'
    : '未來兩小時暫未預測有明顯降雨。';
  const firstWindow = formatPeriodWindow(wet[0].time);
  const peak = periods.reduce((best, period) => period.amountMm > best.amountMm ? period : best, periods[0]);
  return `可能於 ${firstWindow} 期間開始有雨，較強時段約為 ${formatPeriodWindow(peak.time)}。`;
}

function periodWindow(period) {
  const end = new Date(period.time).getTime();
  return { start:end - 30 * 60 * 1000, end };
}

function periodPhase(period, index, now, nextFutureIndex) {
  const window = periodWindow(period);
  if (now >= window.start && now < window.end) return '進行中';
  if (now >= window.end) return '已過';
  if (index === nextFutureIndex) return '下一時段';
  return '其後';
}

function renderPeriodCard(period, index = 0, showNearby = true, dryMode = false, now = Date.now(), nextFutureIndex = -1) {
  const wet = period.amountMm >= .2 ? ' wet' : '';
  const phase = periodPhase(period, index, now, nextFutureIndex);
  const nearby = showNearby ? `<div class="period-nearby">附近最高 ${formatRain(period.nearbyMaxMm)}</div>` : '';
  const icon = dryMode ? '' : `<div class="weather-icon">${rainIconSvg(period.level)}</div>`;
  const amount = dryMode
    ? `<div class="period-amount dry-label">無雨</div>`
    : `<div class="period-amount">${formatRain(period.amountMm)} <span class="period-unit">mm</span></div>`;
  return `<div class="period-card${wet}${dryMode ? ' dry-card' : ''}"><div class="period-relative">${escapeHtml(formatPeriodWindow(period.time))}</div><div class="period-time">${escapeHtml(phase)}</div>${icon}${amount}${nearby}</div>`;
}

function renderChartColumn(period) {
  const height = rainBarHeight(period.amountMm);
  const level = period.level || rainLevel(period.amountMm);
  return `<div class="chart-col"><div class="chart-value">${formatRain(period.amountMm)}</div><div class="chart-bar-wrap"><div class="chart-bar ${escapeHtml(level)}" style="height:${height}px"></div></div><div class="chart-time">${escapeHtml(formatTime(period.time))}</div></div>`;
}

function rainBarHeight(value) {
  const amount = Math.max(0, Number(value) || 0);
  if (amount <= 0) return 2;
  if (amount < .5) return Math.round(5 + amount / .5 * 13);
  if (amount < 2) return Math.round(18 + (amount - .5) / 1.5 * 18);
  if (amount < 10) return Math.round(36 + (amount - 2) / 8 * 30);
  return 72;
}

function rainIconSvg(level) {
  if (level === 'dry') return `<svg viewBox="0 0 60 50" aria-hidden="true"><path d="M30 6C24 15 17 22 17 31a13 13 0 0 0 26 0C43 22 36 15 30 6z" fill="none" stroke="#9db0bc" stroke-width="3"/><line x1="15" y1="10" x2="45" y2="42" stroke="#9db0bc" stroke-width="3.5" stroke-linecap="round"/></svg>`;
  const drops = { light:1, moderate:2, heavy:3, 'very-heavy':4 }[level] ?? 1;
  let shapes = '';
  const startX = 30 - (drops - 1) * 7;
  for (let index = 0; index < drops; index++) {
    const x = startX + index * 14, y = index % 2 ? 12 : 8, scale = level === 'very-heavy' ? 1.06 : 1;
    shapes += `<path d="M ${x} ${y} C ${x-5*scale} ${y+8*scale}, ${x-8*scale} ${y+12*scale}, ${x-8*scale} ${y+19*scale} A ${8*scale} ${8*scale} 0 0 0 ${x+8*scale} ${y+19*scale} C ${x+8*scale} ${y+12*scale}, ${x+5*scale} ${y+8*scale}, ${x} ${y} Z" fill="#168bd2" opacity="${.72 + index * .07}"/>`;
  }
  return `<svg viewBox="0 0 60 50" aria-hidden="true">${shapes}</svg>`;
}

function bookmarkSvg() {
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6.5 3.5h11v17l-5.5-3.7-5.5 3.7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
}

function shareSvg() {
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 15V4m0 0L8 8m4-4 4 4M6 11v8h12v-8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function renderError(message) {
  const content = document.getElementById('forecast-content');
  document.getElementById('forecast-panel')?.classList.remove('dry-forecast');
  content.innerHTML = `<div class="location-row"><div><h1 id="location-name" class="location-name"></h1><div class="location-coord">${state.selected.lat.toFixed(4)}°N, ${state.selected.lon.toFixed(4)}°E</div></div></div><div class="empty-state"><div class="error-symbol" aria-hidden="true">!</div><strong>未能取得定點預報</strong><div class="error-message">${escapeHtml(message)}</div><button id="retry-forecast-button" class="wide-btn retry-button" type="button">重新載入</button></div>`;
  document.getElementById('location-name').textContent = state.selected.name;
  document.getElementById('retry-forecast-button')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('rain:refresh')));
  setMobileStatus('error','未能取得預報');
  document.getElementById('data-status-detail').textContent = `定點預報讀取失敗：${message}`;
  setBadge('point','error','POINT');
  announce(`未能取得${state.selected.name}預報：${message}`);
}

function updateDataStatusDetail(data, quality, issueText, fetchedText, validUntilText, cacheNotice) {
  const detail = document.getElementById('data-status-detail');
  if (!detail) return;
  const age = Number.isFinite(quality.freshness.sourceAgeMinutes) ? `${quality.freshness.sourceAgeMinutes} 分鐘` : '不詳';
  detail.innerHTML = `<div class="status-detail-block"><strong>${escapeHtml(quality.freshness.label)}</strong><span>預報基準：${escapeHtml(issueText)}</span><span>預報有效至：${escapeHtml(validUntilText)}</span><span>本頁取得：${escapeHtml(fetchedText)}</span><span>資料時差：${escapeHtml(age)}</span><small>${escapeHtml(quality.freshness.note)}</small></div><div class="status-detail-block"><strong>${escapeHtml(quality.spatial.label)}</strong><small>${escapeHtml(quality.spatial.note)}</small></div>${cacheNotice ? `<div class="status-detail-block warning"><strong>快取資料</strong><small>${escapeHtml(cacheNotice)}</small></div>` : ''}`;
}
