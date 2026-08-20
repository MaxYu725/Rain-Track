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
assert.match(home, /title = Number\(first\.frameIndex\) === 0 \? '30 分鐘內可能有雨' : '稍後可能有雨'/);
assert.match(home, /endRatio <= 0\.7/);
assert.match(home, /峰值後逐步減弱/);

// Fourth-pass product-language invariants.
assert.ok(!home.includes('<div class="rain-home-verdict-kicker">未來 2 小時</div>'), 'normal Rain Home summary must not repeat the two-hour horizon kicker');
assert.ok(!home.includes('每 6 分鐘一點 · 每點為 30 分鐘累積雨量'), 'chart header must avoid repeating cadence details already encoded by the axis');
assert.match(home, /const terminalPeak = data\.complete && Number\(peak\.frameIndex\) === FRAME_COUNT - 1/);
assert.match(home, /預報結束時仍呈上升/);
assert.match(home, /截至 \$\{peakClock\}，30 分鐘累積預測雨量升至約 \$\{peakRain\} mm/);
assert.match(home, /`至 \$\{peakClock\} 升至 \$\{peakRain\} mm \/ 30 min`/);
assert.match(home, /chartMarkup\(data\.points, data\.runTime, \{ seriesComplete:data\.complete \}\)/);
assert.ok(home.includes('點按圖表查看各時間雨量'), 'complete series must use a concise chart interaction hint');
assert.ok(home.includes('部分時間資料暫缺，圖表會以空白表示'), 'partial series must explain gaps in user language');
assert.ok(!home.includes('缺失 frame 不會以直線跨接'), 'implementation terminology must not be visible in the chart help');
assert.ok(!home.includes('rain-home-chart-caption'), 'normal chart must not repeat accumulation semantics in a second caption row');
assert.ok(!home.includes('開始出現訊號'), 'headline must use human weather language instead of signal-analysis language');
assert.ok(!home.includes('香港有效時間優先'), 'internal presentation principles must not be user-facing copy');
assert.ok(!home.includes('rain-home-peak-label'), 'peak text annotation must stay outside the plotted curve');

// Fifth-pass mobile readability invariants.
assert.ok(home.includes('@media(max-width:700px)'), 'Rain Home must retain an explicit mobile presentation breakpoint');
assert.ok(home.includes('.rain-home-location{padding:2px 0 13px}'), 'mobile location block must use tighter vertical spacing');
assert.ok(home.includes('.rain-home-summary{padding:19px 0 16px}'), 'mobile weather summary must use tighter vertical spacing');
assert.ok(home.includes('.rain-home-chart-summary{margin-bottom:8px;color:#75838a;font-size:.69rem;font-weight:520}'), 'mobile chart summary must stay visually secondary');
assert.ok(home.includes('.rain-home-axis-label{font-size:14px}'), 'mobile rainfall scale labels must be enlarged');
assert.ok(home.includes('.rain-home-axis-clock{font-size:16px}'), 'mobile clock labels must be enlarged');
assert.ok(home.includes('.rain-home-axis-lead{font-size:13px}'), 'mobile lead labels must be enlarged');
assert.ok(home.includes('.rain-home-unavailable-label{display:none}'), 'redundant first-forecast text must be hidden on mobile');
assert.ok(home.includes('const height = 300'), 'fifth-pass chart geometry must be taller for mobile readability');

assert.match(home, /setRainMapMode\('forecast'\)/);
assert.match(home, /查看 2 小時雨區/);
assert.ok(!home.includes('loadSeriesViaFrames'), 'Rain Home must not reconstruct a series through 16 /point requests');
assert.ok(!home.includes('fetchSwirlsPointFrame'), 'Rain Home must have exactly one SWIRLS client path');
assert.ok(!home.includes("window.addEventListener('online'"), 'network recovery must not trigger an automatic retry');
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
assert.match(sw, /const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa(\d+)'/);

console.log('Rain Home zero-base architecture + fifth-pass mobile presentation validation passed');
