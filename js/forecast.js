import { state } from './state.js';
import { announce, setBadge, setMobileStatus } from './ui.js';
import { escapeHtml, formatDateTime, formatPeriodWindow, formatRain, formatTime, rainLevel } from './utils.js';
import { keepSelectedVisible, renderPointLayers } from './map.js';

export function renderLoading(point, { retain = false } = {}) {
  if (retain && state.forecast) return;
  const content = document.getElementById('forecast-content');
  if (!content) return;
  content.innerHTML = `<div class="location-row"><div><h1 class="location-name"></h1><div class="location-coord">${point.lat.toFixed(4)}°N, ${point.lon.toFixed(4)}°E</div></div></div><div class="sheet-peek-summary"><span>正在計算預報…</span><strong>請稍候</strong></div><div class="empty-state"><div class="spinner" aria-hidden="true"></div><div>正在計算未來兩小時雨量…</div></div>`;
  content.querySelector('.location-name').textContent = point.name;
  setMobileStatus('loading','正在載入預報');
}

export function renderForecast({ cacheNotice = '' } = {}) {
  const data = state.forecast;
  if (!data?.periods?.length) { renderError('沒有可用的定點預報'); return; }
  const content = document.getElementById('forecast-content');
  const quality = normalizeQuality(data);
  const periods = data.periods;
  const isDry = periods.every(period => (period.amountMm || 0) < .2 && (period.nearbyMaxMm || 0) < .2);
  const startWindow = getRainStartWindow(data, periods);
  const startText = startWindow ? `${formatTime(startWindow.start)}–${formatTime(startWindow.end)}` : '暫無';
  const issueText = data.issueTime ? formatDateTime(data.issueTime) : '時間不詳';
  const fetchedText = data.generatedAt ? formatTime(data.generatedAt) : formatTime(new Date().toISOString());
  const nearbyPeak = Math.max(...periods.map(period => period.nearbyMaxMm || 0));
  const pointPeak = Math.max(...periods.map(period => period.amountMm || 0));
  const nearbyMessage = nearbyPeak >= .2 && nearbyPeak > pointPeak + .15
    ? `附近 ${data.nearbyRadiusKm || state.radiusKm} 公里最高預測 ${formatRain(nearbyPeak)} mm／30分鐘，比定點高 ${formatRain(nearbyPeak - pointPeak)} mm；雨區邊界可能接近。`
    : `附近 ${data.nearbyRadiusKm || state.radiusKm} 公里的預報與定點差異不大。`;
  const trendMarkup = isDry
    ? `<div class="dry-state"><div class="dry-state-icon">${rainIconSvg('dry')}</div><div><div class="dry-state-title">未來兩小時雨量維持 0 mm</div><div class="dry-state-note">定點及附近 ${data.nearbyRadiusKm || state.radiusKm} 公里預報均未見明顯降雨。</div></div></div>`
    : `<div class="chart">${periods.map(renderChartColumn).join('')}</div>`;
  const cacheMarkup = cacheNotice ? `<div class="cache-notice">${escapeHtml(cacheNotice)}</div>` : '';
  const spatialClass = quality.spatial.status === 'sensitive' ? 'location-sensitive' : 'normal';

  content.innerHTML = `
    <div class="location-row">
      <div><h1 id="location-name" class="location-name"></h1><div class="location-coord">${state.selected.lat.toFixed(4)}°N, ${state.selected.lon.toFixed(4)}°E</div></div>
      <div class="mini-actions"><button id="save-point-button" class="mini-btn" type="button" title="儲存位置" aria-label="儲存位置">＋</button><button id="share-point-button" class="mini-btn" type="button" title="分享位置" aria-label="分享位置">⇧</button></div>
    </div>
    <div id="forecast-updating" class="forecast-updating hidden"><span class="mini-spinner" aria-hidden="true"></span>正在更新資料</div>
    <div class="sheet-peek-summary"><span>${escapeHtml(data.summary?.text || buildSummaryText(periods))}</span><strong>${formatRain(data.summary?.totalMm)} mm · ${escapeHtml(startText)}</strong></div>
    ${cacheMarkup}
    <div class="summary-card ${escapeHtml(quality.freshness.status)}">
      <div class="summary-main">${escapeHtml(data.summary?.text || buildSummaryText(periods))}</div>
      <div class="summary-meta">
        <span class="meta-detail">預報基準 ${escapeHtml(issueText)}</span>
        <span class="meta-detail">本頁取得 ${escapeHtml(fetchedText)}</span>
        <span class="quality-pill ${escapeHtml(quality.freshness.status)}"><span class="quality-dot"></span>${escapeHtml(quality.freshness.label)}</span>
        <span class="quality-pill ${escapeHtml(spatialClass)}"><span class="quality-dot"></span>${escapeHtml(quality.spatial.label)}</span>
      </div>
    </div>
    <div class="mobile-data-alert ${escapeHtml(quality.freshness.status)}">${quality.freshness.status === 'normal' ? '' : `⚠ ${escapeHtml(quality.freshness.label)}${Number.isFinite(quality.freshness.sourceAgeMinutes) ? `（${quality.freshness.sourceAgeMinutes} 分鐘）` : ''}`}</div>
    <div class="metrics">
      <div class="metric metric-primary"><div class="metric-value">${formatRain(data.summary?.totalMm)} mm</div><div class="metric-label">兩小時總雨量</div></div>
      <div class="metric metric-detail"><div class="metric-value">${formatRain(data.summary?.peakMm)} mm</div><div class="metric-label">最高／30分鐘</div></div>
      <div class="metric metric-primary"><div class="metric-value">${escapeHtml(startText)}</div><div class="metric-label">可能開始時段</div></div>
      <div class="metric metric-detail"><div class="metric-value">${Number.isFinite(quality.freshness.sourceAgeMinutes) ? `${quality.freshness.sourceAgeMinutes} 分鐘` : '—'}</div><div class="metric-label">資料時差</div></div>
    </div>
    <div class="section-head"><h2 class="section-title">未來兩小時</h2><div class="section-note">每格為半小時累計雨量</div></div>
    <div class="period-grid">${periods.map(period => renderPeriodCard(period, !isDry)).join('')}</div>
    <div class="section-head"><h2 class="section-title">雨量趨勢</h2><div class="section-note">${isDry ? '乾燥模式' : '固定雨量級別'}</div></div>
    ${trendMarkup}
    <div class="nearby-card"><strong>附近雨勢：</strong>${escapeHtml(nearbyMessage)}<br><span class="quality-note"><strong>${escapeHtml(quality.spatial.label)}：</strong>${escapeHtml(quality.spatial.note)}</span></div>
    <div class="source-note">資料來源：香港天文台「香港網格點降雨臨近預報」。時段顯示為半小時累計區間；定點值由相鄰四個官方網格作雙線性插值，屬自動預報結果，不是街道級實測。資料更新狀態與位置穩定度分開顯示，並不代表預報保證準確。</div>`;

  document.getElementById('location-name').textContent = state.selected.name;
  renderPointLayers();
  document.getElementById('mobile-title-sub').textContent = `${state.selected.name} · ${quality.freshness.label}`;
  document.getElementById('save-point-button')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('rain:save-point')));
  document.getElementById('share-point-button')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('rain:share-point')));

  const mobileState = quality.freshness.status === 'expired' || quality.freshness.status === 'stale'
    ? 'error'
    : quality.freshness.status === 'delayed' || quality.spatial.status === 'sensitive' ? 'loading' : 'ok';
  const mobileLabel = quality.freshness.status !== 'normal' ? quality.freshness.label : quality.spatial.status === 'sensitive' ? quality.spatial.label : quality.freshness.label;
  setMobileStatus(mobileState, mobileLabel);
  setBadge('point','ok','POINT');
  setBadge('hko', quality.freshness.status === 'expired' || quality.freshness.status === 'stale' ? 'error' : quality.freshness.status === 'delayed' ? 'loading' : 'ok', 'HKO');
  updateDataStatusDetail(data, quality, issueText, fetchedText, cacheNotice);
  requestAnimationFrame(() => keepSelectedVisible(false));
  announce(`${state.selected.name}預報已更新。${data.summary?.text || buildSummaryText(periods)}`);
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
    label: raw.status === 'location-sensitive' ? '位置較敏感' : '位置變化穩定',
    note: raw.status === 'location-sensitive' ? raw.note : '定點與附近網格的預報變化相對平順。',
    nearbyDeltaMaxMm: raw.nearbyDeltaMaxMm ?? 0
  };
  return { freshness, spatial };
}

function getRainStartWindow(data, periods) {
  if (data.summary?.rainStartWindowStart && data.summary?.rainStartWindowEnd) return { start:data.summary.rainStartWindowStart, end:data.summary.rainStartWindowEnd };
  const first = periods.find(period => period.amountMm >= .2);
  if (!first?.time) return null;
  const end = new Date(first.time);
  return { start:new Date(end.getTime() - 30 * 60 * 1000).toISOString(), end:end.toISOString() };
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

function renderPeriodCard(period, showNearby = true) {
  const wet = period.amountMm >= .2 ? ' wet' : '';
  const nearby = showNearby ? `<div class="period-nearby">附近最高 ${formatRain(period.nearbyMaxMm)}</div>` : '';
  return `<div class="period-card${wet}"><div class="period-time">${escapeHtml(formatPeriodWindow(period.time))}</div><div class="weather-icon">${rainIconSvg(period.level)}</div><div class="period-amount">${formatRain(period.amountMm)} <span class="period-unit">mm</span></div>${nearby}</div>`;
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

export function renderError(message) {
  const content = document.getElementById('forecast-content');
  content.innerHTML = `<div class="location-row"><div><h1 id="location-name" class="location-name"></h1><div class="location-coord">${state.selected.lat.toFixed(4)}°N, ${state.selected.lon.toFixed(4)}°E</div></div></div><div class="empty-state"><div class="error-symbol" aria-hidden="true">!</div><strong>未能取得定點預報</strong><div class="error-message">${escapeHtml(message)}</div><button id="retry-forecast-button" class="wide-btn retry-button" type="button">重新載入</button></div>`;
  document.getElementById('location-name').textContent = state.selected.name;
  document.getElementById('retry-forecast-button')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('rain:refresh')));
  setMobileStatus('error','未能取得預報');
  document.getElementById('data-status-detail').textContent = `定點預報讀取失敗：${message}`;
  setBadge('point','error','POINT');
  announce(`未能取得${state.selected.name}預報：${message}`);
}

function updateDataStatusDetail(data, quality, issueText, fetchedText, cacheNotice) {
  const detail = document.getElementById('data-status-detail');
  if (!detail) return;
  const age = Number.isFinite(quality.freshness.sourceAgeMinutes) ? `${quality.freshness.sourceAgeMinutes} 分鐘` : '不詳';
  detail.innerHTML = `<div class="status-detail-block"><strong>${escapeHtml(quality.freshness.label)}</strong><span>預報基準：${escapeHtml(issueText)}</span><span>本頁取得：${escapeHtml(fetchedText)}</span><span>資料時差：${escapeHtml(age)}</span><small>${escapeHtml(quality.freshness.note)}</small></div><div class="status-detail-block"><strong>${escapeHtml(quality.spatial.label)}</strong><small>${escapeHtml(quality.spatial.note)}</small></div>${cacheNotice ? `<div class="status-detail-block warning"><strong>快取資料</strong><small>${escapeHtml(cacheNotice)}</small></div>` : ''}`;
}
