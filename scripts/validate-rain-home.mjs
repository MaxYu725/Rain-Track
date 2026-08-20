import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const home = readFileSync(new URL('../js/rain-home.js', import.meta.url), 'utf8');
const time = readFileSync(new URL('../js/rain-home-time.js', import.meta.url), 'utf8');
const state = readFileSync(new URL('../js/state.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../js/rain-home-shell.js', import.meta.url), 'utf8');
const smoke = readFileSync(new URL('../js/forecast-map-smoke.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

assert.match(api, /fetchSwirlsPointSeries/);
assert.match(api, /\/api\/rain\/swirls\/point-series/);
assert.ok(!api.includes('fetchSwirlsPointFrame'), 'Rain Home API must not expose the 16-frame fallback helper');
assert.ok(!api.includes("cache:'no-store'"), 'generic browser API requests must not force no-store');
assert.ok(api.includes('SWIRLS_SERIES_TRANSPORT_RETRY_DELAY_MS = 450'), 'point-series must use one small bounded transport retry delay');
assert.ok(api.includes('isTransientTransportError'), 'point-series retry must be limited to transport failures');
assert.ok(api.includes('Number.isFinite(Number(error.status))'), 'HTTP failures must not enter the transport retry path');
assert.ok(api.includes('await waitForTransportRetry(options.signal)'), 'transport retry must remain abort-aware');
const seriesFunction = api.match(/export async function fetchSwirlsPointSeries[\s\S]*?\n\}/)?.[0] || '';
assert.ok(seriesFunction, 'fetchSwirlsPointSeries body missing');
assert.equal((seriesFunction.match(/await api\(path, requestOptions\)/g) || []).length, 2, 'point-series must make at most two transport attempts');

assert.match(app, /const RAIN_HOME_OWNS_FORECAST = document\.body\.classList\.contains\('rain-home-v2'\)/);
assert.match(app, /RAIN_HOME_OWNS_FORECAST \? Promise\.resolve\(\) : loadPointForecast\(\{ force:false \}\)/);
assert.match(app, /async function loadPointForecast[\s\S]*?if \(RAIN_HOME_OWNS_FORECAST\) return;/);
assert.match(app, /if \(!RAIN_HOME_OWNS_FORECAST\) setupRefreshLifecycle\(\)/);
assert.match(app, /if \(!RAIN_HOME_OWNS_FORECAST\) window\.addEventListener\('rain:refresh'/);
assert.match(app, /refresh-button[\s\S]*?RAIN_HOME_OWNS_FORECAST \? requestHomeRefresh\(\) : refresh\(false\)/);
assert.match(app, /if \(!RAIN_HOME_OWNS_FORECAST\) void loadPointForecast\(\{ force:false \}\)/);
assert.match(app, /function setupRefreshLifecycle\(\) \{\n  if \(RAIN_HOME_OWNS_FORECAST\) return;/);
assert.match(app, /function scheduleRefresh\(\) \{\n  if \(RAIN_HOME_OWNS_FORECAST\) return;/);

assert.match(home, /FRAME_COUNT\s*=\s*16/);
assert.match(home, /RAIN_HOME_CADENCE_MINUTES/);
assert.match(home, /Number\(data\.accumulationMinutes\) !== 30/);
assert.match(home, /expectedRainHomeLeadMinutes/);
assert.match(home, /每點為 30 分鐘累積雨量/);
assert.match(home, /rainfallScaleMax/);
assert.match(home, /rainfallTickStep/);
assert.match(home, /rainfallTickValues/);
assert.match(home, /rain-home-timing/);
assert.match(home, /rain-home-chart-summary/);
assert.match(home, /rain-home-unavailable-zone/);
assert.match(home, /預報由 \$\{firstAvailableClock\} 開始/);
assert.match(home, /data-rain-home-readout aria-live="polite" hidden/);
assert.match(home, /readout\.hidden = false/);
assert.match(home, /guide\.classList\.add\('is-active'\)/);
assert.ok(home.includes("title = nowInsideFirstWindow ? '目前預報窗有雨訊號' : '短時預報有雨訊號'"));
assert.match(home, /endRatio <= 0\.7/);
assert.match(home, /峰值後逐步減弱/);

// Product-language invariants.
assert.ok(!home.includes('<div class="rain-home-verdict-kicker">未來 2 小時</div>'), 'normal Rain Home summary must not repeat the two-hour horizon kicker');
assert.ok(!home.includes('每 6 分鐘一點 · 每點為 30 分鐘累積雨量'), 'chart header must avoid repeating cadence details already encoded by the axis');
assert.match(home, /const terminalPeak = data\.complete && Number\(peak\.frameIndex\) === FRAME_COUNT - 1/);
assert.match(home, /預報結束時仍呈上升/);
assert.match(home, /截至 \$\{peakClock\}，30 分鐘累積預測雨量升至約 \$\{peakRain\} mm/);
assert.match(home, /`至 \$\{peakClock\} 升至 \$\{peakRain\} mm \/ 30 min`/);
assert.match(home, /chartMarkup\(data\.points, data\.runTime, \{ seriesComplete:data\.complete \}\)/);
assert.ok(home.includes('點按圖表查看各時間雨量'), 'complete series must use a concise chart interaction hint before selection');
assert.ok(home.includes('部分時間資料暫缺，圖表會以空白表示'), 'partial series must explain gaps in user language');
assert.ok(!home.includes('缺失 frame 不會以直線跨接'), 'implementation terminology must not be visible in the chart help');
assert.ok(!home.includes('rain-home-chart-caption'), 'normal chart must not repeat accumulation semantics in a second caption row');
assert.ok(!home.includes('開始出現訊號'), 'headline must use human weather language instead of signal-analysis language');
assert.ok(!home.includes('香港有效時間優先'), 'internal presentation principles must not be user-facing copy');
assert.ok(!home.includes('rain-home-peak-label'), 'peak text annotation must stay outside the plotted curve');

// Current-aware forecast semantics.
assert.ok(home.includes('const firstFutureIndex = points.findIndex'), 'summary must locate the first still-valid forecast point');
assert.ok(home.includes('const relevantPoints = firstFutureIndex >= 0 ? points.slice(firstFutureIndex) : []'), 'past valid times must not drive current forecast wording');
assert.ok(home.includes("title:'等待下一輪預報'"), 'expired forecast runs need an explicit terminal presentation');
assert.ok(home.includes('const firstWindowStart = first.windowStart || data.runTime'), 'first +30 sample must be interpreted as an accumulation window');
assert.ok(home.includes('`${formatClock(firstWindowStart)}–${formatClock(firstWindowEnd)} 預報窗有雨`'), 'first-window rain must be described by the forecast window');
assert.ok(home.includes("title = '目前預報仍有雨訊號'"), 'wet signal spanning now must not be presented as a future onset');
assert.ok(!home.includes('`最早 ${formatClock(first.validTime)} 可能有雨`'), 'window end must not be mislabeled as earliest onset');
assert.ok(!home.includes('`最早可用時間 ${formatClock(first.validTime)} 可能有雨`'), 'partial data must not invent an onset from a rolling window end');

// Bounded load recovery invariants.
assert.ok(home.includes('SERIES_FALLBACK_CACHE_MS = 12 * 60 * 1000'), 'session fallback must have a strict short lifetime');
assert.ok(home.includes("SERIES_SESSION_PREFIX = 'rain-home-series-v1:'"), 'session fallback key must be versioned');
assert.ok(home.includes('sessionStorage.getItem(sessionSeriesKey(key))'), 'Rain Home must be able to recover a recent successful series after reload');
assert.ok(home.includes('sessionStorage.setItem(sessionSeriesKey(key)'), 'successful series must populate the short session fallback');
assert.ok(home.includes('seriesStillRelevant'), 'cached series must still overlap the forecast horizon');
assert.ok(home.includes('const fallback = sessionFallback || readSessionSeries(key)'), 'failed current fetch may use one recent successful series');
assert.ok(home.includes('短暫連線問題已嘗試重新連線'), 'terminal error copy must reflect the bounded transport retry');

// Fifth-pass mobile readability invariants.
assert.ok(home.includes('@media(max-width:700px)'), 'Rain Home must retain an explicit mobile presentation breakpoint');
assert.ok(home.includes('.rain-home-location{padding:2px 0 13px}'), 'mobile location block must use tighter vertical spacing');
assert.ok(home.includes('.rain-home-summary{padding:19px 0 16px}'), 'mobile weather summary must use tighter vertical spacing');
assert.ok(home.includes('.rain-home-chart-summary{display:none}'), 'mobile chart must not repeat the peak summary already explained above the chart');
assert.ok(home.includes('.rain-home-axis-label{font-size:14px}'), 'mobile rainfall scale labels must be enlarged');
assert.ok(home.includes('.rain-home-axis-clock{font-size:16px}'), 'mobile clock labels must be enlarged');
assert.ok(home.includes('.rain-home-axis-lead{font-size:13px}'), 'mobile lead labels must be enlarged');
assert.ok(home.includes('.rain-home-unavailable-label{display:none}'), 'redundant first-forecast text must be hidden on mobile');
assert.ok(home.includes('const height = 300'), 'fifth-pass chart geometry must remain taller for mobile readability');

// Final Rain Home interaction invariants.
assert.ok(home.includes("const help = content.querySelector('.rain-home-chart-help:not(.is-partial)')"), 'complete-series help must be independently hideable after interaction');
assert.ok(home.includes('if (help) help.hidden = true'), 'interaction hint must disappear after the inspector opens');
assert.ok(home.includes('.rain-home-chart-help[hidden]{display:none}'), 'hidden interaction help must not retain layout space');

assert.match(home, /setRainMapMode\('forecast'\)/);
assert.match(home, /查看 2 小時雨區/);
assert.ok(!home.includes('loadSeriesViaFrames'), 'Rain Home must not reconstruct a series through 16 /point requests');
assert.ok(!home.includes('fetchSwirlsPointFrame'), 'Rain Home must have exactly one SWIRLS client path');
assert.ok(!home.includes("window.addEventListener('online'"), 'network recovery must not create an online-event retry loop');
assert.ok(!home.includes('data-rain-home-retry'), 'terminal error state must not create a hidden retry path');
assert.ok(home.includes("window.addEventListener('rain:location-change'"), 'location change must be an explicit fetch trigger');
assert.ok(home.includes("document.getElementById('refresh-button')?.addEventListener('click'"), 'user refresh must be an explicit fetch trigger');
assert.ok(home.includes('observer = new MutationObserver(restoreOwnedView)'), 'DOM ownership observer must only restore rendered state');

const restoreBody = home.match(/function restoreOwnedView\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.ok(restoreBody, 'restoreOwnedView body missing');
assert.ok(!restoreBody.includes('requestSeries'), 'MutationObserver callback must never trigger a network request');
assert.ok(!restoreBody.includes('fetchSwirlsPointSeries'), 'MutationObserver callback must never fetch SWIRLS');

assert.ok(state.includes("new CustomEvent('rain:location-change'"), 'state.selected changes must emit an explicit location event');
assert.match(time, /RAIN_HOME_FIRST_LEAD_MINUTES\s*=\s*30/);
assert.match(time, /RAIN_HOME_CADENCE_MINUTES\s*=\s*6/);
assert.match(time, /RAIN_HOME_HORIZON_MINUTES\s*=\s*120/);

for (const marker of [
  "localStorage.removeItem('hkRainSheetMode')",
  "localStorage.removeItem('hkRainSheetUserMode')",
  'panelHasLegacySheetState',
  'bodyHasLegacySheetState',
  'new MutationObserver(restorePanelIfNeeded)',
  'new MutationObserver(restoreBodyIfNeeded)',
  "attributeFilter:['class', 'style', 'data-sheet']"
]) assert.ok(shell.includes(marker), `Rain Home shell cleanup marker missing: ${marker}`);

assert.ok(!shell.includes('new MutationObserver(stripLegacySheetState)'), 'an observer must never call the mutating cleanup function unconditionally');
const stripShell = shell.match(/function stripLegacySheetState\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.ok(stripShell, 'stripLegacySheetState body missing');
assert.ok(stripShell.includes('if (panel && panelHasLegacySheetState(panel))'), 'panel mutations must be guarded by actual legacy state');
assert.ok(stripShell.includes("if (panel.hasAttribute('data-sheet')) panel.removeAttribute('data-sheet')"), 'data-sheet removal must be conditional');
assert.ok(stripShell.includes("if (panel.style.getPropertyValue('height')) panel.style.removeProperty('height')"), 'style removal must be conditional');
assert.ok(stripShell.includes('if (bodyHasLegacySheetState())'), 'body class cleanup must be conditional');

assert.match(smoke, /import '\.\/rain-home\.js';/);
assert.match(smoke, /import '\.\/rain-home-shell\.js';/);
const shellVersion = sw.match(/const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa(\d+)'/);
assert.ok(shellVersion && Number(shellVersion[1]) >= 49, 'Rain Home reliability fix requires PWA generation at least pwa49');

console.log('Rain Home bounded transport recovery + current-aware forecast semantics validation passed');
