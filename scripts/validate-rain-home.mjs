import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
const home = readFileSync(new URL('../js/rain-home.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../js/rain-home-shell.js', import.meta.url), 'utf8');
const smoke = readFileSync(new URL('../js/forecast-map-smoke.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

assert.match(api, /fetchSwirlsPointSeries/);
assert.match(api, /\/api\/rain\/swirls\/point-series/);
assert.match(api, /fetchSwirlsPointFrame/);
assert.match(home, /FRAME_COUNT\s*=\s*16/);
assert.match(home, /cadenceMinutes\)\s*!==\s*6/);
assert.match(home, /accumulationMinutes\)\s*!==\s*30/);
assert.match(home, /每 6 分鐘一點/);
assert.match(home, /每點代表該時刻前 30 分鐘累積雨量/);
assert.match(home, /setRainMapMode\('forecast'\)/);
assert.match(home, /查看 2 小時雨區/);

for (const marker of [
  "localStorage.removeItem('hkRainSheetMode')",
  "localStorage.removeItem('hkRainSheetUserMode')",
  "document.getElementById('sheet-handle')?.remove()",
  "document.getElementById('forecast-toggle')?.remove()",
  "panel.removeAttribute('data-sheet')",
  "document.body.classList.remove('sheet-peek-active', 'sheet-expanded-active')",
  "attributeFilter:['class', 'style', 'data-sheet']"
]) {
  assert.ok(shell.includes(marker), `Rain Home shell cleanup marker missing: ${marker}`);
}

assert.match(smoke, /import '\.\/rain-home\.js';/);
assert.match(smoke, /import '\.\/rain-home-shell\.js';/);
assert.match(sw, /'\.\/js\/rain-home\.js'/);
assert.match(sw, /'\.\/js\/rain-home-shell\.js'/);
assert.match(sw, /point-rain-pwa-v1\.6\.4-pwa22/);

console.log('Rain Home v2 integration + bottom-sheet removal validation passed');
