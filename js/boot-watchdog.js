(() => {
  const BOOT_TIMEOUT_MS = 5000;
  const FALLBACK_START_MS = 800;
  const API_BASE = 'https://radar.max-yu.workers.dev';
  const RAIN_THRESHOLD_MM = 0.2;
  let recoveryStarted = false;
  let lastBootError = '';
  let fallbackController = null;
  let fallbackToken = 0;
  let fallbackPoint = null;

  function clearBootQuery() {
    try {
      const url = new URL(location.href);
      if (!url.searchParams.has('_boot')) return;
      url.searchParams.delete('_boot');
      history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {}
  }

  function recordBootError(value) {
    if (lastBootError) return;
    lastBootError = String(value || '').trim().slice(0, 220);
  }

  window.addEventListener('error', event => {
    const target = event?.target;
    if (target && target !== window) {
      const source = target.src || target.href || target.tagName || 'resource';
      recordBootError(`資源載入失敗：${source}`);
      return;
    }
    recordBootError(event?.message || event?.error?.message);
  }, true);
  window.addEventListener('unhandledrejection', event => recordBootError(event?.reason?.message || event?.reason));

  function root() {
    return document.querySelector('.rain-home-root');
  }

  function rainHomeReady() {
    const current = root();
    return Boolean(
      document.body?.classList.contains('rain-home-v2') &&
      current &&
      !current.hasAttribute('data-rain-home-first-paint')
    );
  }

  function fullRainHomeReady() {
    const current = root();
    return rainHomeReady() && !current?.hasAttribute('data-rain-critical-fallback');
  }

  function criticalFallbackActive() {
    const current = root();
    return Boolean(current?.hasAttribute('data-rain-critical-fallback') || current?.hasAttribute('data-rain-home-first-paint'));
  }

  function readInitialPoint() {
    try {
      const params = new URLSearchParams(location.search);
      const lat = Number(params.get('lat'));
      const lon = Number(params.get('lon'));
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon, name:(params.get('name') || '分享位置').trim() || '分享位置' };
      }
    } catch {}
    try {
      const stored = JSON.parse(localStorage.getItem('hkRainLastPoint') || 'null');
      if (stored && Number.isFinite(Number(stored.lat)) && Number.isFinite(Number(stored.lon))) {
        return { lat:Number(stored.lat), lon:Number(stored.lon), name:String(stored.name || '上次位置') };
      }
    } catch {}
    return { lat:22.3023, lon:114.1746, name:'香港天文台' };
  }

  function savePoint(point) {
    try { localStorage.setItem('hkRainLastPoint', JSON.stringify(point)); } catch {}
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  }

  function formatClock(value) {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) return '—';
    try {
      return new Intl.DateTimeFormat('zh-HK', {
        hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Asia/Hong_Kong'
      }).format(new Date(time));
    } catch {
      const date = new Date(time);
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
  }

  function formatRain(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    if (number < 0.05) return '0';
    if (number < 10) return number.toFixed(1).replace(/\.0$/, '');
    return String(Math.round(number));
  }

  function injectFallbackStyles() {
    if (document.getElementById('rain-critical-fallback-style')) return;
    const style = document.createElement('style');
    style.id = 'rain-critical-fallback-style';
    style.textContent = `
      .rain-critical-root{max-width:720px;margin:0 auto;padding:2px 0 28px;color:#fff}
      .rain-critical-location{padding:2px 0 17px;border-bottom:1px solid #252525}
      .rain-critical-kicker{color:#929ca1;font-size:.72rem;font-weight:650;letter-spacing:.08em}
      .rain-critical-name{margin:6px 0 0;font-size:clamp(1.55rem,5vw,2.35rem);font-weight:480;letter-spacing:-.03em;line-height:1.12}
      .rain-critical-coord{margin-top:7px;color:#6f787c;font-size:.7rem;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
      .rain-critical-summary{padding:24px 0 20px}.rain-critical-summary h1{margin:0;font-size:clamp(1.75rem,6vw,2.8rem);font-weight:350;letter-spacing:-.04em;line-height:1.12}.rain-critical-summary p{margin:11px 0 0;color:#b8c0c4;line-height:1.62}
      .rain-critical-loading{display:flex;align-items:center;gap:12px;min-height:180px;color:#90999e}.rain-critical-spinner{width:28px;height:28px;border:2px solid #313a3e;border-top-color:#1ba1e2;border-radius:50%;animation:spin .8s linear infinite}
      .rain-critical-chart-wrap{padding:12px 9px 10px;border:1px solid #232d32;background:#070a0c}.rain-critical-chart{display:block;width:100%;height:auto;color:#1ba1e2}.rain-critical-grid{stroke:#242c30;stroke-width:1}.rain-critical-line{fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.rain-critical-area{fill:currentColor;opacity:.09}.rain-critical-dot{fill:#070a0c;stroke:currentColor;stroke-width:2;cursor:pointer}.rain-critical-dot.selected{fill:currentColor;stroke-width:3}.rain-critical-axis{fill:#7e898e;font-size:11px;font-family:system-ui,sans-serif}.rain-critical-clock{fill:#adb6ba;font-size:10px}.rain-critical-readout{display:flex;justify-content:space-between;gap:14px;margin-top:10px;padding:11px 10px;border-top:1px solid #27343a;background:#0a1013}.rain-critical-readout strong{font-size:.9rem}.rain-critical-readout small{display:block;margin-top:4px;color:#7c898f}.rain-critical-value{font-size:1.2rem;font-weight:700;white-space:nowrap}
      .rain-critical-meta{margin-top:10px;color:#778187;font-size:.69rem}.rain-critical-error{margin-top:22px;padding:15px;border:1px solid #5d3a23;background:#160e08;color:#e9c29b;line-height:1.55}.rain-critical-error button{margin-top:10px;min-height:40px;padding:0 12px;border:1px solid #815538;background:#21130b;color:#f0ceb1}
      @media(prefers-reduced-motion:reduce){.rain-critical-spinner{animation:none!important}}
    `;
    document.head.append(style);
  }

  function renderCriticalLoading(point) {
    const content = document.getElementById('forecast-content');
    if (!content) return;
    injectFallbackStyles();
    content.innerHTML = `
      <section class="rain-home-root rain-critical-root" data-rain-critical-fallback>
        <div class="rain-critical-location">
          <div class="rain-critical-kicker">目前位置預報</div>
          <h2 class="rain-critical-name">${escapeHtml(point.name || '目前位置')}</h2>
          <div class="rain-critical-coord">${Number(point.lat).toFixed(4)}°N, ${Number(point.lon).toFixed(4)}°E</div>
        </div>
        <div class="rain-critical-loading" role="status" aria-live="polite">
          <span class="rain-critical-spinner" aria-hidden="true"></span>
          <div><strong>正在直接讀取 SWIRLS</strong><div>載入目前定位的未來兩小時雨勢…</div></div>
        </div>
      </section>`;
    const subtitle = document.getElementById('mobile-title-sub');
    if (subtitle) subtitle.textContent = `${point.name} · 正在載入`;
  }

  function normalizePoints(data) {
    const points = Array.isArray(data?.points) ? data.points : [];
    return points
      .map(point => ({
        frameIndex:Number(point.frameIndex),
        leadMinutes:Number(point.leadMinutes),
        amountMm:Number(point.amountMm),
        validTime:point.validTime,
        windowStart:point.windowStart,
        windowEnd:point.windowEnd || point.validTime
      }))
      .filter(point => Number.isFinite(point.leadMinutes) && point.leadMinutes >= 0 && point.leadMinutes <= 120 && Number.isFinite(point.amountMm) && point.amountMm >= 0 && Number.isFinite(Date.parse(point.validTime || '')))
      .sort((a, b) => a.leadMinutes - b.leadMinutes);
  }

  function analyze(points) {
    const firstWetIndex = points.findIndex(point => point.amountMm >= RAIN_THRESHOLD_MM);
    if (firstWetIndex < 0) {
      return { title:'未來 2 小時暫無明顯降雨', detail:'目前定位點的 SWIRLS 雨量訊號維持接近 0 mm。', short:'暫無明顯降雨' };
    }
    const first = points[firstWetIndex];
    const previous = points[firstWetIndex - 1];
    const peak = points.reduce((best, point) => point.amountMm > best.amountMm ? point : best, points[0]);
    const title = firstWetIndex === 0 || !previous
      ? '未來 30 分鐘內可能有雨'
      : `約 ${formatClock(previous.validTime)}–${formatClock(first.validTime)} 開始見到降雨訊號`;
    return {
      title,
      detail:`較強的 30 分鐘累積雨量時窗約在 ${formatClock(peak.validTime)} 前後，最高約 ${formatRain(peak.amountMm)} mm / 30 min。`,
      short:firstWetIndex === 0 ? '30 分鐘內可能有雨' : '稍後可能有雨',
      selected:firstWetIndex
    };
  }

  function niceCeiling(value) {
    if (!Number.isFinite(value) || value <= 1) return 1;
    if (value <= 2) return 2;
    if (value <= 5) return 5;
    if (value <= 10) return 10;
    if (value <= 20) return 20;
    if (value <= 50) return 50;
    return Math.ceil(value / 25) * 25;
  }

  function chartMarkup(points, selectedIndex) {
    const width = 700, height = 250;
    const pad = { left:42, right:12, top:12, bottom:48 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const yMax = niceCeiling(Math.max(...points.map(point => point.amountMm)));
    const x = lead => pad.left + plotW * Math.max(0, Math.min(120, Number(lead))) / 120;
    const y = value => pad.top + plotH * (1 - Math.min(yMax, Math.max(0, Number(value))) / yMax);
    const line = points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.leadMinutes).toFixed(1)} ${y(point.amountMm).toFixed(1)}`).join(' ');
    const firstX = x(points[0].leadMinutes), lastX = x(points.at(-1).leadMinutes), baseY = pad.top + plotH;
    const area = `${line} L ${lastX.toFixed(1)} ${baseY.toFixed(1)} L ${firstX.toFixed(1)} ${baseY.toFixed(1)} Z`;
    const grids = [0,.25,.5,.75,1].map(ratio => {
      const yy = pad.top + plotH * (1 - ratio);
      return `<line class="rain-critical-grid" x1="${pad.left}" y1="${yy}" x2="${width-pad.right}" y2="${yy}"></line>`;
    }).join('');
    const labels = [0,30,60,90,120].map(lead => {
      const xx = x(lead).toFixed(1);
      const anchor = lead === 0 ? 'start' : lead === 120 ? 'end' : 'middle';
      if (lead === 0) return `<text class="rain-critical-axis" x="${xx}" y="${height-14}" text-anchor="${anchor}">現在</text>`;
      const point = points.find(item => item.leadMinutes === lead);
      return `<text class="rain-critical-axis" x="${xx}" y="${height-27}" text-anchor="${anchor}"><tspan x="${xx}">+${lead}</tspan><tspan class="rain-critical-clock" x="${xx}" dy="13">${escapeHtml(formatClock(point?.validTime))}</tspan></text>`;
    }).join('');
    const dots = points.map((point, index) => `<circle class="rain-critical-dot${index === selectedIndex ? ' selected' : ''}" cx="${x(point.leadMinutes).toFixed(1)}" cy="${y(point.amountMm).toFixed(1)}" r="${index === selectedIndex ? 5 : 3}" tabindex="0" role="button" data-critical-point="${index}" aria-label="${escapeHtml(`${formatClock(point.validTime)}，${formatRain(point.amountMm)} mm / 30 min`)}"></circle>`).join('');
    return `<div class="rain-critical-chart-wrap"><svg class="rain-critical-chart" viewBox="0 0 ${width} ${height}" aria-label="SWIRLS 未來兩小時定位雨量">${grids}<path class="rain-critical-area" d="${area}"></path><path class="rain-critical-line" d="${line}"></path>${dots}${labels}</svg><div class="rain-critical-readout" data-critical-readout></div><div class="rain-critical-meta">每 6 分鐘預測 · 數值代表 30 分鐘預測雨量</div></div>`;
  }

  function readoutMarkup(point) {
    return `<div><strong>${escapeHtml(formatClock(point.validTime))} · +${point.leadMinutes} 分</strong><small>30 分鐘累積時窗 ${escapeHtml(formatClock(point.windowStart))}–${escapeHtml(formatClock(point.windowEnd))}</small></div><div class="rain-critical-value">${escapeHtml(formatRain(point.amountMm))} <small>mm / 30 min</small></div>`;
  }

  function wireChart(points, selectedIndex) {
    const content = document.getElementById('forecast-content');
    const readout = content?.querySelector('[data-critical-readout]');
    const dots = [...(content?.querySelectorAll('[data-critical-point]') || [])];
    const select = index => {
      const normalized = Math.max(0, Math.min(points.length - 1, Number(index) || 0));
      dots.forEach((dot, dotIndex) => {
        dot.classList.toggle('selected', dotIndex === normalized);
        dot.setAttribute('r', dotIndex === normalized ? '5' : '3');
      });
      if (readout) readout.innerHTML = readoutMarkup(points[normalized]);
    };
    dots.forEach(dot => {
      dot.addEventListener('click', () => select(dot.dataset.criticalPoint));
      dot.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(dot.dataset.criticalPoint); }
      });
    });
    select(selectedIndex);
  }

  function renderCriticalForecast(point, data, points) {
    const content = document.getElementById('forecast-content');
    if (!content) return;
    const analysis = analyze(points);
    const selectedIndex = Number.isFinite(analysis.selected) ? analysis.selected : 0;
    content.innerHTML = `
      <section class="rain-home-root rain-critical-root" data-rain-critical-fallback>
        <div class="rain-critical-location"><div class="rain-critical-kicker">目前位置預報</div><h2 class="rain-critical-name">${escapeHtml(point.name || '目前位置')}</h2><div class="rain-critical-coord">${Number(point.lat).toFixed(4)}°N, ${Number(point.lon).toFixed(4)}°E</div></div>
        <div class="rain-critical-summary"><h1>${escapeHtml(analysis.title)}</h1><p>${escapeHtml(analysis.detail)}</p></div>
        ${chartMarkup(points, selectedIndex)}
        <div class="rain-critical-meta">預報基準 ${escapeHtml(formatClock(data?.runTime))} · Classic fallback；完整介面載入後會自動接管</div>
      </section>`;
    wireChart(points, selectedIndex);
    const subtitle = document.getElementById('mobile-title-sub');
    if (subtitle) subtitle.textContent = `${point.name} · ${analysis.short}`;
  }

  function renderCriticalError(point, error) {
    const content = document.getElementById('forecast-content');
    if (!content) return;
    content.innerHTML = `
      <section class="rain-home-root rain-critical-root" data-rain-critical-fallback>
        <div class="rain-critical-location"><div class="rain-critical-kicker">目前位置預報</div><h2 class="rain-critical-name">${escapeHtml(point.name || '目前位置')}</h2></div>
        <div class="rain-critical-error" role="alert"><strong>SWIRLS 暫時未能載入</strong><div>${escapeHtml(error?.message || String(error))}</div><button type="button" data-critical-retry>重新讀取</button></div>
      </section>`;
    content.querySelector('[data-critical-retry]')?.addEventListener('click', () => runCriticalForecast(point));
  }

  async function runCriticalForecast(point = fallbackPoint || readInitialPoint()) {
    fallbackPoint = point;
    const token = ++fallbackToken;
    fallbackController?.abort();
    fallbackController = new AbortController();
    renderCriticalLoading(point);
    const timeout = setTimeout(() => fallbackController?.abort(), 12000);
    try {
      const url = `${API_BASE}/api/rain/swirls/point-series?lat=${encodeURIComponent(point.lat)}&lon=${encodeURIComponent(point.lon)}`;
      const response = await fetch(url, { cache:'no-store', signal:fallbackController.signal, headers:{ Accept:'application/json' } });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      const points = normalizePoints(data);
      if (points.length < 2) throw new Error('SWIRLS 沒有返回足夠的定位時間點');
      if (token !== fallbackToken || fullRainHomeReady()) return;
      renderCriticalForecast(point, data, points);
    } catch (error) {
      if (token !== fallbackToken || fullRainHomeReady()) return;
      if (error?.name === 'AbortError') renderCriticalError(point, new Error('連線逾時，請重新讀取'));
      else renderCriticalError(point, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  function toggleCriticalDrawer(force) {
    const drawer = document.getElementById('settings-drawer');
    if (!drawer) return;
    const open = typeof force === 'boolean' ? force : !drawer.classList.contains('open');
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.getElementById('drawer-backdrop')?.classList.toggle('hidden', !open);
    document.body.classList.toggle('drawer-open', open);
  }

  function locateCritical() {
    if (!navigator.geolocation) {
      renderCriticalError(fallbackPoint || readInitialPoint(), new Error('此瀏覽器未提供定位功能'));
      return;
    }
    navigator.geolocation.getCurrentPosition(position => {
      const point = { lat:position.coords.latitude, lon:position.coords.longitude, name:'目前位置' };
      fallbackPoint = point;
      savePoint(point);
      runCriticalForecast(point);
    }, error => renderCriticalError(fallbackPoint || readInitialPoint(), new Error(error?.message || '定位失敗')), {
      enableHighAccuracy:false, timeout:8000, maximumAge:120000
    });
  }

  function bindCriticalControls() {
    const intercept = (id, action) => {
      document.getElementById(id)?.addEventListener('click', event => {
        if (!criticalFallbackActive()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        action();
      }, true);
    };
    intercept('refresh-button', () => runCriticalForecast(fallbackPoint || readInitialPoint()));
    intercept('locate-button', locateCritical);
    intercept('drawer-button', () => toggleCriticalDrawer());
    intercept('mobile-status', () => toggleCriticalDrawer(true));
    document.getElementById('drawer-close')?.addEventListener('click', event => {
      if (!criticalFallbackActive()) return;
      event.preventDefault(); event.stopImmediatePropagation(); toggleCriticalDrawer(false);
    }, true);
    document.getElementById('drawer-backdrop')?.addEventListener('click', event => {
      if (!criticalFallbackActive()) return;
      event.preventDefault(); event.stopImmediatePropagation(); toggleCriticalDrawer(false);
    }, true);
  }

  async function recoverCurrentShell(button) {
    if (recoveryStarted) return;
    recoveryStarted = true;
    if (button) {
      button.disabled = true;
      button.textContent = '正在重新載入…';
    }
    const url = new URL(location.href);
    url.searchParams.set('_boot', Date.now().toString(36));
    location.replace(url.toString());
  }

  function showBootRecovery() {
    if (rainHomeReady()) return;
    const content = document.getElementById('forecast-content');
    if (!content || content.querySelector('[data-rain-boot-recovery]')) return;
    const detail = lastBootError
      ? `<div class="error-message">啟動錯誤：${escapeHtml(lastBootError)}</div>`
      : '<div class="error-message">前端模組未完成載入。Classic fallback 亦未能啟動。</div>';
    content.innerHTML = `<div class="empty-state" data-rain-boot-recovery role="alert"><div class="error-symbol" aria-hidden="true">!</div><strong>Rain Home 未完成啟動</strong>${detail}<button class="wide-btn retry-button" type="button" data-rain-boot-reload>重新載入</button></div>`;
    content.querySelector('[data-rain-boot-reload]')?.addEventListener('click', event => recoverCurrentShell(event.currentTarget));
  }

  function startCriticalLayer() {
    clearBootQuery();
    fallbackPoint = readInitialPoint();
    bindCriticalControls();
    setTimeout(() => {
      if (!fullRainHomeReady()) runCriticalForecast(fallbackPoint);
    }, FALLBACK_START_MS);
    setTimeout(showBootRecovery, BOOT_TIMEOUT_MS);
  }

  document.documentElement.dataset.rainBootWatchdog = 'active';
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startCriticalLayer, { once:true });
  else startCriticalLayer();
})();
