import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const home = readFileSync(new URL('../js/rain-home.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

for (const marker of [
  'bindChartExplorer(content, data.points)',
  "data-rain-home-readout",
  "data-rain-home-point",
  "role=\"button\"",
  "tabindex=\"0\"",
  "aria-pressed=\"false\"",
  "event.key === 'Enter'",
  "event.key === 'ArrowLeft'",
  "event.key === 'ArrowRight'",
  'firstWetIndex',
  '30 分鐘累積時窗',
  'mm / 30 min',
  '有效時間',
  'leadMinutes',
  'r=\"14\"'
]) {
  assert.ok(home.includes(marker), `Rain Home point explorer marker missing: ${marker}`);
}

assert.ok(!home.includes('6 分鐘雨量'), 'Rain Home must not relabel rolling 30-minute accumulation as 6-minute rainfall');
assert.ok(home.includes('每點代表該時刻前 30 分鐘累積雨量'), 'rolling accumulation semantics are missing');

const shellVersion = sw.match(/const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa(\d+)'/);
assert.ok(shellVersion, 'PWA shell version marker is missing');
assert.ok(Number(shellVersion[1]) >= 24, `point explorer requires PWA generation at least pwa24, got pwa${shellVersion[1]}`);

console.log('Rain Home 16-point explorer validation passed');
