import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const home = readFileSync(new URL('../js/rain-home.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

for (const marker of [
  'bindChartExplorer(content, data.points)',
  'data-rain-home-readout',
  'data-rain-home-point',
  'data-rain-home-guide',
  'role="button"',
  'tabindex="0"',
  'aria-pressed="false"',
  "event.key === 'Enter'",
  "event.key === 'ArrowLeft'",
  "event.key === 'ArrowRight'",
  "chart.addEventListener('pointerdown'",
  'selectNearestAtClientX',
  'readout.hidden = false',
  "guide.classList.add('is-active')",
  "const help = content.querySelector('.rain-home-chart-help:not(.is-partial)')",
  'if (help) help.hidden = true',
  '30 分鐘累積時窗',
  'mm / 30 min',
  '有效時間',
  'leadMinutes',
  'r="14"'
]) {
  assert.ok(home.includes(marker), `Rain Home point explorer marker missing: ${marker}`);
}

assert.ok(home.includes('data-rain-home-readout aria-live="polite" hidden'), 'chart inspector must be hidden until user interaction');
assert.ok(!home.includes('selectPoint(firstWet?.index ?? 0)'), 'chart inspector must not auto-select a point on first render');
assert.ok(!home.includes('6 分鐘雨量'), 'Rain Home must not relabel rolling 30-minute accumulation as 6-minute rainfall');
assert.ok(home.includes('每點為 30 分鐘累積雨量'), 'rolling accumulation semantics must remain visible once in the chart header');
assert.ok(home.includes('點按圖表查看各時間雨量'), 'complete chart should use a concise interaction hint before selection');
assert.ok(home.includes('.rain-home-chart-help[hidden]{display:none}'), 'complete interaction hint must leave no layout gap after selection');
assert.ok(home.includes('部分時間資料暫缺，圖表會以空白表示'), 'partial-data warning must remain available independently of the complete interaction hint');
assert.ok(!home.includes('rain-home-chart-caption'), 'normal chart should not duplicate accumulation semantics below the plot');
assert.ok(home.includes('.rain-home-chart-help{font-size:.7rem}'), 'mobile interaction hint must remain readable before selection');

const shellVersion = sw.match(/const CACHE_VERSION = 'point-rain-pwa-v1\.6\.4-pwa(\d+)'/);
assert.ok(shellVersion, 'PWA shell version marker is missing');
assert.ok(Number(shellVersion[1]) >= 38, `Rain Home final polish requires PWA generation at least pwa38, got pwa${shellVersion[1]}`);

console.log('Rain Home 16-point explorer + final interaction polish validation passed');
