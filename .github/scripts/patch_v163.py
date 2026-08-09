from pathlib import Path
import hashlib


def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:80]!r}')
    text = text.replace(old, new, count)
    p.write_text(text)

# Version / PWA cache
replace('js/config.js', "export const APP_VERSION = '1.6.2';", "export const APP_VERSION = '1.6.3';")
replace('index.html', '<title>香港定點雨量預報 v1.6.2</title>', '<title>香港定點雨量預報 v1.6.3</title>')
replace('service-worker.js', "const CACHE_VERSION = 'point-rain-pwa-v1.6.2-gis1';", "const CACHE_VERSION = 'point-rain-pwa-v1.6.3';")

# Forecast owns forecast freshness only when radar is not active, and exposes a restorer.
replace(
    'js/forecast.js',
    "  const mobileState = quality.freshness.status === 'expired' || quality.freshness.status === 'stale'\n    ? 'error'\n    : quality.freshness.status === 'delayed' || quality.spatial.status === 'sensitive' ? 'loading' : 'ok';\n  const mobileLabel = quality.freshness.status !== 'normal' ? quality.freshness.label : quality.spatial.status === 'sensitive' ? quality.spatial.label : quality.freshness.label;\n  setMobileStatus(mobileState, mobileLabel);",
    "  if (!state.layers.radar) updateForecastMobileStatus(data);"
)
replace(
    'js/forecast.js',
    "function buildStatusPills(quality) {",
    "export function updateForecastMobileStatus(data = state.forecast) {\n  if (!data) return;\n  const quality = normalizeQuality(data);\n  const mobileState = quality.freshness.status === 'expired' || quality.freshness.status === 'stale'\n    ? 'error'\n    : quality.freshness.status === 'delayed' || quality.spatial.status === 'sensitive' ? 'loading' : 'ok';\n  const mobileLabel = quality.freshness.status !== 'normal'\n    ? `預報${quality.freshness.label}`\n    : quality.spatial.status === 'sensitive' ? quality.spatial.label : '預報資料更新正常';\n  setMobileStatus(mobileState, mobileLabel);\n}\n\nfunction buildStatusPills(quality) {"
)

# Radar owns the top mobile status while enabled.
replace(
    'js/radar.js',
    "import { state } from './state.js';\nimport { clamp, formatDateTime, isMobileLayout } from './utils.js';\nimport { setBadge, setSheetMode, toast } from './ui.js';",
    "import { state } from './state.js';\nimport { updateForecastMobileStatus } from './forecast.js';\nimport { clamp, formatDateTime, isMobileLayout } from './utils.js';\nimport { setBadge, setMobileStatus, setSheetMode, toast } from './ui.js';"
)
replace(
    'js/radar.js',
    "const RECENT_PRELOAD_COUNT = 12;",
    "const RECENT_PRELOAD_COUNT = 12;\nconst RADAR_FRESH_NORMAL_MINUTES = 15;\nconst RADAR_FRESH_MAX_MINUTES = 30;"
)
replace(
    'js/radar.js',
    "    setBadge('radar','ok','RADAR');\n    scheduleRadarRefresh();",
    "    setBadge('radar','ok','RADAR');\n    updateRadarMobileStatus();\n    scheduleRadarRefresh();"
)
replace(
    'js/radar.js',
    "      setBadge('radar','ok','RADAR');\n      scheduleRadarRefresh();",
    "      setBadge('radar','ok','RADAR');\n      updateRadarMobileStatus({ refreshFailed:true });\n      scheduleRadarRefresh();"
)
replace(
    'js/radar.js',
    "  setBadge('radar', state.worker.capabilities.radarFrames ? 'empty' : 'disabled', 'RADAR');\n\n  if (restoreSheet",
    "  setBadge('radar', state.worker.capabilities.radarFrames ? 'empty' : 'disabled', 'RADAR');\n  updateForecastMobileStatus();\n\n  if (restoreSheet"
)
replace(
    'js/radar.js',
    "  if (data?.cadenceMinutes) panel?.setAttribute('data-cadence', String(data.cadenceMinutes));\n  updatePlayButton();",
    "  const legend = document.getElementById('radar-legend');\n  if (legend) legend.classList.toggle('hidden', !hasFrames || !state.layers.radar || radarMode === 'test');\n  if (data?.cadenceMinutes) panel?.setAttribute('data-cadence', String(data.cadenceMinutes));\n  updateRadarAgeLabel();\n  updatePlayButton();"
)
replace(
    'js/radar.js',
    "  const latest = document.getElementById('radar-latest-button');\n  if (latest) latest.disabled = !state.radar.frames.length || state.radar.index === state.radar.frames.length - 1;\n}",
    "  const latest = document.getElementById('radar-latest-button');\n  if (latest) latest.disabled = !state.radar.frames.length || state.radar.index === state.radar.frames.length - 1;\n  updateRadarAgeLabel();\n}"
)
replace(
    'js/radar.js',
    "function setRadarMode(value) {",
    "function latestRadarAgeMinutes() {\n  const latest = state.radar.frames.at(-1);\n  const time = latest?.time ? Date.parse(latest.time) : NaN;\n  if (!Number.isFinite(time)) return null;\n  return Math.max(0, Math.round((Date.now() - time) / 60000));\n}\n\nfunction updateRadarAgeLabel() {\n  const label = document.getElementById('radar-age-label');\n  if (!label) return;\n  if (radarMode === 'test') { label.textContent = 'TEST'; return; }\n  const age = latestRadarAgeMinutes();\n  label.textContent = Number.isFinite(age) ? `最新 ${age === 0 ? '剛剛' : `${age} 分鐘前`}` : '最新時間不詳';\n}\n\nfunction updateRadarMobileStatus({ refreshFailed = false } = {}) {\n  if (!state.layers.radar) return;\n  if (radarMode === 'test') {\n    setMobileStatus('ok', '雷達 TEST 模式');\n    setBadge('radar','ok','RADAR');\n    return;\n  }\n  const age = latestRadarAgeMinutes();\n  if (!Number.isFinite(age)) {\n    setMobileStatus('loading', '雷達時間不詳');\n    setBadge('radar','loading','RADAR');\n    return;\n  }\n  if (refreshFailed) {\n    setMobileStatus('loading', `雷達暫未更新 · ${age}分鐘前`);\n    setBadge('radar','loading','RADAR');\n    return;\n  }\n  if (age <= RADAR_FRESH_NORMAL_MINUTES) {\n    setMobileStatus('ok', age === 0 ? '雷達剛更新' : `雷達 ${age}分鐘前`);\n    setBadge('radar','ok','RADAR');\n  } else if (age <= RADAR_FRESH_MAX_MINUTES) {\n    setMobileStatus('loading', `雷達更新稍有延遲 · ${age}分鐘`);\n    setBadge('radar','loading','RADAR');\n  } else {\n    setMobileStatus('error', `雷達資料過舊 · ${age}分鐘`);\n    setBadge('radar','error','RADAR');\n  }\n}\n\nfunction setRadarMode(value) {"
)
replace(
    'js/radar.js',
    "      counter.textContent = '0/0';\n      head.append(counter);",
    "      counter.textContent = '0/0';\n      const age = document.createElement('span');\n      age.id = 'radar-age-label';\n      age.className = 'radar-age-label';\n      age.textContent = '最新 —';\n      head.append(age);\n      head.append(counter);"
)
replace(
    'js/radar.js',
    "    const control = timeline.querySelector('.timeline-control');",
    "    const control = timeline.querySelector('.timeline-control');\n    if (control && !document.getElementById('radar-legend')) {\n      const legend = document.createElement('div');\n      legend.id = 'radar-legend';\n      legend.className = 'radar-legend hidden';\n      legend.innerHTML = '<span class=\"radar-legend-title\">雷達回波</span><span>較弱</span><span class=\"radar-legend-scale\" aria-hidden=\"true\"></span><span>較強</span>';\n      control.before(legend);\n    }"
)
replace(
    'js/radar.js',
    ".radar-head-left{display:inline-flex;align-items:center;gap:7px;min-width:0}.radar-mode-chip{padding:2px 5px;border:1px solid #3d5664;color:#9bdcff;font-size:.66rem;line-height:1.2}.radar-mode-chip.test{border-color:#8b6b20;color:#ffd06a}.radar-frame-counter{margin-left:auto;color:#818181;font-size:.68rem}",
    ".radar-head-left{display:inline-flex;align-items:center;gap:7px;min-width:0}.radar-mode-chip{padding:2px 5px;border:1px solid #3d5664;color:#9bdcff;font-size:.66rem;line-height:1.2}.radar-mode-chip.test{border-color:#8b6b20;color:#ffd06a}.radar-age-label{margin-left:auto;color:#9a9a9a;font-size:.66rem;white-space:nowrap}.radar-frame-counter{color:#818181;font-size:.68rem}.radar-legend{display:flex;align-items:center;gap:6px;margin:7px 0 4px;color:#909090;font-size:.62rem}.radar-legend.hidden{display:none}.radar-legend-title{color:#bdbdbd;margin-right:2px}.radar-legend-scale{width:86px;height:5px;border-radius:2px;background:linear-gradient(90deg,#00b9df 0%,#00c96b 35%,#d6d600 60%,#f28b20 78%,#d73545 100%)}"
)
replace(
    'js/radar.js',
    "@media(max-width:700px){.radar-timeline{bottom:calc(96px + var(--safe-bottom))}.radar-timeline-btn{height:34px}.radar-head-left{gap:5px}.radar-mode-chip{font-size:.62rem}.timeline-head{align-items:center}.timeline-control{gap:6px}}",
    "@media(max-width:700px){.radar-timeline{bottom:calc(96px + var(--safe-bottom))}.radar-timeline-btn{height:34px}.radar-head-left{gap:5px}.radar-mode-chip{font-size:.62rem}.radar-age-label{font-size:.6rem}.radar-legend{gap:5px;margin-top:6px}.radar-legend-scale{width:68px}.timeline-head{align-items:center}.timeline-control{gap:6px}}"
)

# Docs
replace('README.md', '# 香港定點雨量預報 v1.6.2', '# 香港定點雨量預報 v1.6.3')
readme = Path('README.md')
text = readme.read_text()
marker = '## v1.6.2 Radar Rendering Fix'
section = """## v1.6.3 Radar UX Refinement\n\n- 雷達開啟時，手機頂部狀態改由雷達最新幀控制，不再把定點預報的 freshness 誤當成雷達延遲。\n- 雷達正常時顯示「雷達 N分鐘前」；15–30分鐘顯示雷達更新稍有延遲；背景更新失敗時明確顯示保留上一幀。\n- 關閉雷達後立即恢復定點預報 freshness 狀態；Bottom Sheet 仍獨立顯示預報資料年齡。\n- 時間軸新增「最新 N 分鐘前」資訊，歷史幀時間與資料新鮮度分開。\n- Live 模式加入精簡「雷達回波」弱→強示意色帶；TEST 模式不顯示該圖例。\n- Service Worker 快取更新至 `point-rain-pwa-v1.6.3`。\n\n"""
if marker not in text: raise SystemExit('README marker missing')
readme.write_text(text.replace(marker, section + marker, 1))

changelog = Path('CHANGELOG.md')
text = changelog.read_text()
marker = '# Changelog\n\n'
section = """## v1.6.3 Radar UX Refinement\n\n- 分離雷達與定點預報的手機 freshness 顯示，避免把預報延遲誤解為雷達延遲。\n- 雷達狀態以最新幀時間計算，加入正常、稍有延遲、過舊及背景刷新失敗狀態。\n- 關閉雷達後恢復定點預報狀態。\n- 雷達時間軸加入最新幀年齡及精簡回波強弱示意圖例。\n- App / PWA cache 更新至 v1.6.3；Worker 維持 v2.4.3。\n\n"""
if marker not in text: raise SystemExit('CHANGELOG marker missing')
changelog.write_text(text.replace(marker, marker + section, 1))

# Recompute checksum manifest for its existing file list.
sums = Path('SHA256SUMS.txt')
lines = []
for line in sums.read_text().splitlines():
    if not line.strip():
        continue
    _, filename = line.split(None, 1)
    p = Path(filename)
    if not p.exists():
        raise SystemExit(f'checksum path missing: {filename}')
    digest = hashlib.sha256(p.read_bytes()).hexdigest()
    lines.append(f'{digest}  {filename}')
sums.write_text('\n'.join(lines) + '\n')

print('v1.6.3 patch complete')
