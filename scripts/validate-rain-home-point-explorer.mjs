import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const home = readFileSync(new URL('../js/rain-home.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

for (const marker of [
  'bindChartExplorer(content, data.points)',
  "data-rain-home-readout",
  "data-rain-home-point",
  "data-rain-home-guide",
  "role=\"button\"",
  "tabindex=\"0\"",
  "aria-pressed=\"false\"",
  "event.key === 'Enter'",
  "event.key === 'ArrowLeft'",
  "event.key === 'ArrowRight'",
  "chart.addEventListener('pointerdown'",
  'selectNearestAtClientX',
  'findFirstWetSignalTransition(points)',
  '30 分鐘累積時窗',
  'mm / 30 min',
  '有效時間',
  'leadMinutes',
  'r=\"14\"'
]) {
  assert.ok(home.includes(marker), `Rain Home point explorer marker missing: ${marker}`);
}

assert.ok(!home.includes('6 分鐘雨量'), 'Rain Home must not relabel rolling 30-minute accumulation as 6-minute rainfall');
assert.ok(home.includes('數值代表 30 分鐘預測雨量'), 'rolling accumulation semantics are missing');

const shellVersion = sw.match(/const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa(\d+)'/);
assert.ok(shellVersion, 'PWA shell version marker is missing');
assert.ok(Number(shellVersion[1]) >= 27, `polished point explorer requires PWA generation at least pwa27, got pwa${shellVersion[1]}`);

console.log('Rain Home 16-point explorer + full-chart pointer selection validation passed');
