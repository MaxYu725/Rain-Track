from pathlib import Path
import hashlib


def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:100]!r}')
    p.write_text(text.replace(old, new, count))

# ---------------------------------------------------------------------------
# App / PWA version
# ---------------------------------------------------------------------------
replace('js/config.js', "export const APP_VERSION = '1.6.3';", "export const APP_VERSION = '1.6.4';")
replace('index.html', '<title>香港定點雨量預報 v1.6.3</title>', '<title>香港定點雨量預報 v1.6.4</title>')
replace('service-worker.js', "const CACHE_VERSION = 'point-rain-pwa-v1.6.3';", "const CACHE_VERSION = 'point-rain-pwa-v1.6.4';")

# ---------------------------------------------------------------------------
# Settings UI: height is feature-gated by Worker capabilities
# ---------------------------------------------------------------------------
replace(
    'index.html',
    '            <div class="setting-row"><label for="radar-range">覆蓋範圍</label><select id="radar-range"><option value="64">64 公里</option><option value="256">256 公里</option></select></div>\n            <div class="setting-row range-setting"><label for="radar-opacity">透明度</label>',
    '            <div class="setting-row"><label for="radar-range">覆蓋範圍</label><select id="radar-range"><option value="64">64 公里</option><option value="256">256 公里</option></select></div>\n            <div id="radar-height-row" class="setting-row hidden"><label for="radar-height">雷達高度</label><select id="radar-height" disabled><option value="3">3 公里</option><option value="2">2 公里（只限64 km）</option></select></div>\n            <div class="setting-row range-setting"><label for="radar-opacity">透明度</label>'
)

# ---------------------------------------------------------------------------
# State: remember preferred 64 km height; 256 km always starts at 3 km
# ---------------------------------------------------------------------------
replace(
    'js/state.js',
    "function loadRadarOpacity() {",
    "function loadRadarHeight(range = loadRadarRange()) {\n  return range === 64 && localStorage.getItem('hkRainRadarHeight') === '2' ? 2 : 3;\n}\n\nfunction loadRadarOpacity() {"
)
replace(
    'js/state.js',
    "  radar: { frames:[], index:0, range:loadRadarRange(), opacity:loadRadarOpacity(), layer:null },",
    "  radar: { frames:[], index:0, range:loadRadarRange(), height:loadRadarHeight(), opacity:loadRadarOpacity(), layer:null },"
)

# ---------------------------------------------------------------------------
# API: additive height query; old Workers ignore it, so rollout is safe
# ---------------------------------------------------------------------------
replace(
    'js/api.js',
    "export function fetchRadarFrames(range, mode = 'live', options = {}) {\n  const normalizedMode = mode === 'test' ? 'test' : 'live';\n  return api(`/api/radar/frames?range=${encodeURIComponent(range)}&mode=${normalizedMode}`, options);\n}",
    "export function fetchRadarFrames(range, mode = 'live', height = 3, options = {}) {\n  const normalizedMode = mode === 'test' ? 'test' : 'live';\n  const normalizedHeight = Number(height) === 2 ? 2 : 3;\n  return api(`/api/radar/frames?range=${encodeURIComponent(range)}&height=${normalizedHeight}&mode=${normalizedMode}`, options);\n}"
)

# ---------------------------------------------------------------------------
# App bindings
# ---------------------------------------------------------------------------
replace(
    'js/app.js',
    "import { changeRadarRange, setRadarIndex, setRadarOpacity, toggleRadar, updateRadarCapability } from './radar.js';",
    "import { changeRadarHeight, changeRadarRange, setRadarIndex, setRadarOpacity, toggleRadar, updateRadarCapability } from './radar.js';"
)
replace(
    'js/app.js',
    "  const radarRange = document.getElementById('radar-range'); if (radarRange) radarRange.value = String(state.radar.range);\n  const radarOpacity",
    "  const radarRange = document.getElementById('radar-range'); if (radarRange) radarRange.value = String(state.radar.range);\n  const radarHeight = document.getElementById('radar-height'); if (radarHeight) radarHeight.value = String(state.radar.height);\n  const radarOpacity"
)
replace(
    'js/app.js',
    "  document.getElementById('radar-range')?.addEventListener('change', event => changeRadarRange(event.target.value));\n  document.getElementById('radar-opacity')",
    "  document.getElementById('radar-range')?.addEventListener('change', event => changeRadarRange(event.target.value));\n  document.getElementById('radar-height')?.addEventListener('change', event => changeRadarHeight(event.target.value));\n  document.getElementById('radar-opacity')"
)

# ---------------------------------------------------------------------------
# Radar frontend: capability-gated height selector and product label
# ---------------------------------------------------------------------------
replace(
    'js/radar.js',
    "  setBadge('radar', state.worker.capabilities.radarFrames ? 'empty' : 'disabled', 'RADAR');\n}",
    "  setBadge('radar', state.worker.capabilities.radarFrames ? 'empty' : 'disabled', 'RADAR');\n  syncRadarHeightUi();\n}"
)
replace(
    'js/radar.js',
    "    const data = await fetchRadarFrames(state.radar.range, radarMode);\n    validateRadarResponse(data);\n    state.radar.frames = data.frames;",
    "    const data = await fetchRadarFrames(state.radar.range, radarMode, state.radar.height);\n    validateRadarResponse(data);\n    if (Number(data.heightKm) === 2 || Number(data.heightKm) === 3) state.radar.height = Number(data.heightKm);\n    state.radar.frames = data.frames;\n    syncRadarHeightUi();"
)
replace(
    'js/radar.js',
    "    modeChip.textContent = radarMode === 'test' ? 'TEST' : `${state.radar.range} km`;",
    "    modeChip.textContent = radarModeChipText();"
)
replace(
    'js/radar.js',
    "export function changeRadarRange(value) {\n  state.radar.range = String(value) === '256' ? 256 : 64;\n  localStorage.setItem('hkRainRadarRange', String(state.radar.range));\n  const modeChip = document.getElementById('radar-mode-chip');\n  if (modeChip && radarMode !== 'test') modeChip.textContent = `${state.radar.range} km`;\n  if (state.layers.radar) loadRadarFrames({ preserveTime:false });\n}\n\nexport function setRadarOpacity(value) {",
    "export function changeRadarRange(value) {\n  state.radar.range = String(value) === '256' ? 256 : 64;\n  localStorage.setItem('hkRainRadarRange', String(state.radar.range));\n  if (state.radar.range === 64) {\n    state.radar.height = localStorage.getItem('hkRainRadarHeight') === '2' ? 2 : 3;\n  } else {\n    state.radar.height = 3;\n  }\n  syncRadarHeightUi();\n  if (state.layers.radar) loadRadarFrames({ preserveTime:false });\n}\n\nexport function changeRadarHeight(value) {\n  const requested = String(value) === '2' ? 2 : 3;\n  const available = availableRadarHeights(state.radar.range);\n  if (!available.includes(requested) || radarMode === 'test') {\n    state.radar.height = available.includes(3) ? 3 : (available[0] || 3);\n    syncRadarHeightUi();\n    return;\n  }\n  state.radar.height = requested;\n  if (state.radar.range === 64) localStorage.setItem('hkRainRadarHeight', String(requested));\n  syncRadarHeightUi();\n  if (state.layers.radar) loadRadarFrames({ preserveTime:false });\n}\n\nexport function setRadarOpacity(value) {"
)
replace(
    'js/radar.js',
    "function setRadarMode(value) {\n  radarMode = value === 'test' ? 'test' : 'live';\n  localStorage.setItem('hkRainRadarMode', radarMode);\n  stopPlayback();\n  const select = document.getElementById('radar-data-mode');\n  if (select) select.value = radarMode;\n  if (state.layers.radar) loadRadarFrames({ preserveTime:false });\n  else configureTimeline(null);\n}",
    "function availableRadarHeights(range = state.radar.range) {\n  const map = state.worker.radarContract?.heightsKmByRange;\n  const raw = map?.[String(range)] ?? map?.[range];\n  if (!Array.isArray(raw)) return [3];\n  const values = [...new Set(raw.map(Number).filter(value => value === 2 || value === 3))];\n  return values.length ? values : [3];\n}\n\nfunction supportsRadarHeightSelection() {\n  return availableRadarHeights(64).includes(2);\n}\n\nfunction radarModeChipText() {\n  if (radarMode === 'test') return 'TEST';\n  return supportsRadarHeightSelection()\n    ? `${state.radar.range} km · ${state.radar.height} km高`\n    : `${state.radar.range} km`;\n}\n\nfunction syncRadarHeightUi() {\n  const row = document.getElementById('radar-height-row');\n  const select = document.getElementById('radar-height');\n  const supported = supportsRadarHeightSelection();\n  row?.classList.toggle('hidden', !supported);\n  if (!select) return;\n\n  if (!supported) {\n    state.radar.height = 3;\n    select.value = '3';\n    select.disabled = true;\n  } else {\n    const available = availableRadarHeights(state.radar.range);\n    if (!available.includes(state.radar.height)) {\n      const preferred = state.radar.range === 64 && localStorage.getItem('hkRainRadarHeight') === '2' ? 2 : 3;\n      state.radar.height = available.includes(preferred) ? preferred : (available.includes(3) ? 3 : available[0]);\n    }\n    select.value = String(state.radar.height);\n    select.disabled = radarMode === 'test' || available.length < 2;\n    const option2 = select.querySelector('option[value=\"2\"]');\n    if (option2) option2.disabled = !available.includes(2);\n  }\n\n  const modeChip = document.getElementById('radar-mode-chip');\n  if (modeChip) modeChip.textContent = radarModeChipText();\n}\n\nfunction setRadarMode(value) {\n  radarMode = value === 'test' ? 'test' : 'live';\n  localStorage.setItem('hkRainRadarMode', radarMode);\n  stopPlayback();\n  const select = document.getElementById('radar-data-mode');\n  if (select) select.value = radarMode;\n  syncRadarHeightUi();\n  if (state.layers.radar) loadRadarFrames({ preserveTime:false });\n  else configureTimeline(null);\n}"
)
replace(
    'js/radar.js',
    "      ? `Worker 已提供雷達幀；契約版本 ${state.worker.radarContract?.version || '不詳'}。Live 模式使用 HKO GIS 透明雷達回波，保留現有地圖及定點標記。`",
    "      ? `Worker 已提供雷達幀；契約版本 ${state.worker.radarContract?.version || '不詳'}。Live 模式使用 HKO GIS 透明雷達回波${supportsRadarHeightSelection() ? '，64 km 可選 2 / 3 km 高度' : ''}。`"
)

# ---------------------------------------------------------------------------
# Worker v2.4.4: add 64 km / 2 km product while preserving contract v1.0
# ---------------------------------------------------------------------------
replace('worker.js', 'Hong Kong Point Rainfall Forecast Worker v2.4.3', 'Hong Kong Point Rainfall Forecast Worker v2.4.4')
replace('worker.js', "const VERSION = '2.4.3';", "const VERSION = '2.4.4';")
replace('worker.js', 'GET /api/radar/frames?range=64|256&mode=live|test', 'GET /api/radar/frames?range=64|256&height=2|3&mode=live|test')
replace('worker.js', 'GET /probe/radar?range=64|256&mode=live|test', 'GET /probe/radar?range=64|256&height=2|3&mode=live|test')
replace(
    'worker.js',
    "const RADAR_CONTRACT = Object.freeze({",
    "const RADAR_2KM_64 = Object.freeze({\n  kmlRoot: 'https://www.hko.gov.hk/wxinfo/radars/radar_064_kml/Radar_064k.kml',\n  product: '64 km range, 2 km height, GIS overlay',\n  fallbackBounds: { north: 22.87890, south: 21.72777, east: 114.79378, west: 113.54956 }\n});\n\nconst RADAR_CONTRACT = Object.freeze({"
)
replace(
    'worker.js',
    "  endpoint: '/api/radar/frames?range=64|256&mode=live|test',\n  imageEndpoint:",
    "  endpoint: '/api/radar/frames?range=64|256&height=2|3&mode=live|test',\n  imageEndpoint:"
)
replace(
    'worker.js',
    "  rangesKm: [64, 256],\n  modes: ['live', 'test'],",
    "  rangesKm: [64, 256],\n  heightsKmByRange: { 64: [2, 3], 256: [3] },\n  defaultHeightKm: 3,\n  modes: ['live', 'test'],"
)
replace(
    'worker.js',
    "    rangeKm: '64|256',\n    mode: 'live|test',",
    "    rangeKm: '64|256',\n    heightKm: '2|3',\n    mode: 'live|test',"
)
replace('worker.js', "'/api/radar/frames?range=64&mode=live',", "'/api/radar/frames?range=64&height=3&mode=live',")
replace('worker.js', "'/probe/radar?range=64&mode=live'", "'/probe/radar?range=64&height=3&mode=live'")
replace(
    'worker.js',
    "      if (url.pathname === '/api/radar/frames') {\n        return await handleRadarFrames(normalizeRange(url.searchParams.get('range')), normalizeRadarMode(url.searchParams.get('mode')), false);\n      }\n      if (url.pathname === '/probe/radar') {\n        return await handleRadarFrames(normalizeRange(url.searchParams.get('range')), normalizeRadarMode(url.searchParams.get('mode')), true);\n      }",
    "      if (url.pathname === '/api/radar/frames') {\n        const range = normalizeRange(url.searchParams.get('range'));\n        const height = normalizeRadarHeight(url.searchParams.get('height'), range);\n        return await handleRadarFrames(range, height, normalizeRadarMode(url.searchParams.get('mode')), false);\n      }\n      if (url.pathname === '/probe/radar') {\n        const range = normalizeRange(url.searchParams.get('range'));\n        const height = normalizeRadarHeight(url.searchParams.get('height'), range);\n        return await handleRadarFrames(range, height, normalizeRadarMode(url.searchParams.get('mode')), true);\n      }"
)
replace(
    'worker.js',
    "function normalizeRadarMode(value) {\n  return String(value).toLowerCase() === 'test' ? 'test' : 'live';\n}",
    "function normalizeRadarHeight(value, range) {\n  return range === 64 && String(value) === '2' ? 2 : 3;\n}\n\nfunction radarSource(range, height = 3) {\n  return range === 64 && height === 2 ? RADAR_2KM_64 : RADAR[range];\n}\n\nfunction normalizeRadarMode(value) {\n  return String(value).toLowerCase() === 'test' ? 'test' : 'live';\n}"
)
replace('worker.js', "'User-Agent': 'Mozilla/5.0 (compatible; HK-Point-Rain-Worker/2.4.2)'", "'User-Agent': 'Mozilla/5.0 (compatible; HK-Point-Rain-Worker/2.4.4)'")
replace(
    'worker.js',
    "async function handleRadarFrames(range, mode, probe) {\n  if (mode === 'test') return handleTestRadarFrames(range, probe);\n\n  const source = RADAR[range];",
    "async function handleRadarFrames(range, height, mode, probe) {\n  if (mode === 'test') return handleTestRadarFrames(range, height, probe);\n\n  const source = radarSource(range, height);"
)
replace(
    'worker.js',
    "    mode: 'live',\n    product: source.product,",
    "    mode: 'live',\n    rangeKm: range,\n    heightKm: height,\n    product: source.product,"
)
replace('worker.js', 'frames = await collectKmlFrames(source.kmlRoot, range, diagnostics);', 'frames = await collectKmlFrames(source.kmlRoot, source, diagnostics);')
replace(
    'worker.js',
    "    rangeKm: range,\n    mode: 'live',",
    "    rangeKm: range,\n    heightKm: height,\n    mode: 'live',"
)
replace(
    'worker.js',
    "function handleTestRadarFrames(range, probe) {\n  const bounds = RADAR[range].fallbackBounds;",
    "function handleTestRadarFrames(range, height, probe) {\n  const bounds = radarSource(range, height).fallbackBounds;"
)
replace(
    'worker.js',
    "    rangeKm: range,\n    mode: 'test',",
    "    rangeKm: range,\n    heightKm: height,\n    mode: 'test',"
)
replace(
    'worker.js',
    "async function collectKmlFrames(rootUrl, range, diagnostics) {",
    "async function collectKmlFrames(rootUrl, source, diagnostics) {"
)
replace('worker.js', 'const bounds = parseBounds(block) || RADAR[range].fallbackBounds;', 'const bounds = parseBounds(block) || source.fallbackBounds;')

# ---------------------------------------------------------------------------
# Documentation
# ---------------------------------------------------------------------------
replace('README.md', '# 香港定點雨量預報 v1.6.3', '# 香港定點雨量預報 v1.6.4')
replace('README.md', '前端 v1.6.2 的定點預報仍兼容 Worker v2.3 或以上；要啟用即時雨量雷達，建議將 Repository 的最新 `worker.js` v2.4.3 部署到 `https://radar.max-yu.workers.dev`。', '前端 v1.6.4 的定點預報仍兼容 Worker v2.3 或以上；要啟用 64 km 的 2 / 3 km 雷達高度切換，需部署 Repository 的最新 `worker.js` v2.4.4 到 `https://radar.max-yu.workers.dev`。')
readme = Path('README.md')
text = readme.read_text()
marker = '## v1.6.3 Radar UX Refinement\n'
section = """## v1.6.4 Radar Height Products\n\n- 64 km Live 雷達新增 2 km／3 km 高度選擇；256 km 維持 3 km。\n- 2 km 使用 HKO 官方 `radar_064_kml/Radar_064k.kml` 及其 current NetworkLink，實際雷達幀為 800×800 透明 palette PNG。\n- 2 km GroundOverlay 使用官方 KML bounds `22.87890 / 21.72777 / 114.79378 / 113.54956`，與 3 km 產品分開處理。\n- Worker v2.4.4 在 Radar Contract v1.0 加入 additive `heightKm`、`heightsKmByRange` 與 `defaultHeightKm`；舊前端仍可繼續使用預設 3 km。\n- 前端只有在 Worker 宣告高度能力時才顯示「雷達高度」，因此可先部署 Pages、後部署 Worker。\n- 切到 256 km 時自動使用 3 km；返回 64 km 時恢復使用者上次的 64 km 高度偏好。\n- App / PWA cache 更新至 v1.6.4；Worker 更新至 v2.4.4。\n\n"""
if marker not in text: raise SystemExit('README marker missing')
readme.write_text(text.replace(marker, section + marker, 1))

changelog = Path('CHANGELOG.md')
text = changelog.read_text()
marker = '# Changelog\n\n'
section = """## v1.6.4 Radar Height Products\n\n- 新增 HKO 64 km／2 km 高度透明 GIS 雷達產品，保留既有 64 km／3 km 及 256 km／3 km。\n- Worker 升級至 v2.4.4；`/api/radar/frames` 新增 `height=2|3`，回應新增 `heightKm`，Radar Contract v1.0 以 additive 欄位宣告各範圍可用高度。\n- 前端新增 capability-gated 高度選擇；舊 Worker 不支援時保持預設 3 km 並隱藏高度控制。\n- 256 km 固定 3 km；切回 64 km 可恢復上次選擇的 2 / 3 km 高度。\n- App / PWA cache 更新至 v1.6.4。\n\n"""
if marker not in text: raise SystemExit('CHANGELOG marker missing')
changelog.write_text(text.replace(marker, marker + section, 1))

# Recompute existing checksum manifest.
sums = Path('SHA256SUMS.txt')
lines = []
for line in sums.read_text().splitlines():
    if not line.strip():
        continue
    _, filename = line.split(None, 1)
    p = Path(filename)
    if not p.exists():
        raise SystemExit(f'checksum path missing: {filename}')
    lines.append(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {filename}')
sums.write_text('\n'.join(lines) + '\n')

# Sanity assertions for the intended feature shape.
worker = Path('worker.js').read_text()
radar = Path('js/radar.js').read_text()
assert "const VERSION = '2.4.4';" in worker
assert 'Radar_064k.kml' in worker
assert 'heightsKmByRange' in worker
assert 'heightKm: height' in worker
assert 'changeRadarHeight' in radar
assert 'supportsRadarHeightSelection' in radar
assert "APP_VERSION = '1.6.4'" in Path('js/config.js').read_text()
print('v1.6.4 radar height patch complete')
