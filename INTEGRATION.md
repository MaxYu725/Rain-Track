# Rain-Track → Weather App Integration Handoff

## 目的

Rain-Track 的獨立 PWA 已完成定點兩小時降雨、Live Radar，以及正式兩小時 Forecast Map。未來主要方向是把 Rain-Track 與 Storm-Track 的成熟能力整合到 `MaxYu725/Weather_Metro_App`，取代／重構 Weather App 現有 `tools` page，而不是把三個完整獨立前端彼此嵌套。

此文件只定義 Rain-Track 的整合邊界。Storm-Track 仍是獨立專案，不應把熱帶氣旋程式碼加入 Rain-Track。

## 目標架構

`Weather_Metro_App` 已是 Kotlin + Jetpack Compose 原生 Android app，並已有 `data / domain / ui` 分層。建議：

```text
Weather_Metro_App
  data/
    RainTrackApi / DTO / repository
    StormTrackApi / DTO / repository      (另一獨立整合)
  domain/
    PointRainForecast
    ForecastGrid / ForecastFrame
    RadarFrame / RadarProduct
  ui/
    native Compose rain / forecast-map / radar experience
```

Rain-Track PWA 保留作：

- reference implementation
- Worker API smoke-test client
- browser / PWA fallback
- 對照 Weather App native implementation 的行為基準

**不建議**在 Weather App 以 WebView 直接嵌入 Rain-Track PWA。這會重複 PWA lifecycle、定位、localStorage、Service Worker、Leaflet 地圖及設定狀態，並與 Weather App 現有 Compose architecture 衝突。

## Production backend

```text
Base URL: https://radar.max-yu.workers.dev
Worker: v2.4.4
Radar Contract: v1.0
```

Worker 目前允許跨來源 GET，因此原生 Android client 可以直接讀取，不需要依賴 Rain-Track GitHub Pages 前端。

## 建議優先整合的 API

### 1. Capabilities

```http
GET /api/capabilities
```

用途：

- Worker version
- `pointForecast`
- `nowcastGrid`
- `radarFrames`
- radar contract / ranges / heights / modes

Weather App 不應硬編碼「一定支援 2 km height」；應按 capabilities 啟用控制。

### 2. Point rainfall forecast

```http
GET /api/rain/point?lat=22.3023&lon=114.1746&radiusKm=2
```

目前 `radiusKm` UI 支援：

```text
1 / 2 / 3 / 5 km
```

重要回應欄位：

- `issueTime`
- `generatedAt`
- `location`
- `nearbyRadiusKm`
- `grid`
- `summary`
- `dataQuality.freshness`
- `dataQuality.spatial`
- `periods[].time`
- `periods[].leadMinutes`
- `periods[].amountMm`
- `periods[].nearbyMaxMm`
- `periods[].nearbyMeanMm`
- `periods[].nearestGridKm`
- `periods[].spatialSpreadMm`
- `periods[].level`

資料單位：`mm / 30 min`。

### 3. Full two-hour Forecast Map grid

```http
GET /api/rain/nowcast
```

Rain-Track 已正式用這個既有 endpoint 重建完整兩小時 Forecast Map；目前不需要新增另一個 backend endpoint。

用途：

- 完整 HKO gridded rainfall nowcast
- 4 個未來半小時累積雨量 frame
- +30 / +60 / +90 / +120 分鐘
- Canvas / native raster map rendering
- Forecast timeline

Weather App 可把它映射成：

```text
ForecastGrid
  issueTime
  unit = mm / 30 min
  latitudeAxis[]
  longitudeAxis[]
  frames[]
    time
    leadMinutes
    values[row-major]
```

### 4. Radar frames

```http
GET /api/radar/frames?range=64&height=2&mode=live
GET /api/radar/frames?range=64&height=3&mode=live
GET /api/radar/frames?range=256&height=3&mode=live
GET /api/radar/frames?range=64&height=3&mode=test
```

目前產品：

```text
64 km  → 2 km / 3 km height
256 km → 3 km height only
```

重要回應欄位：

- `contractVersion`
- `rangeKm`
- `heightKm`
- `mode`
- `issueTime`
- `cadenceMinutes`
- `frameCount`
- `renderMode`
- `frames[].time`
- `frames[].bounds`
- `frames[].imageUrl`

`imageUrl` 是 Worker-relative URL；native client 應相對 production Worker base URL resolve。

### 5. Radar image proxy

```http
GET /api/radar/image?id=...
```

不要由 Weather App 自行重建 HKO KML parsing 或直接信任任意 image URL。Worker 已限制可接受 HKO host / radar image path，並統一 proxy / cache 行為。

## Forecast Map contract — 必須保留

2026-08-14 真雨測試發現一個重要 upstream formatting 特性：HKO CSV 的 latitude / longitude 只保留到三位小數，相鄰座標差值可能在 `0.019 / 0.020` 之間交錯。

因此 Weather App **不可**：

```text
minLat + row * stepLat
minLon + col * stepLon
```

用單一 `stepLat / stepLon` 人工重建整條座標軸。

必須：

1. 從實際 points 收集 unique latitude / longitude。
2. latitude 由北至南排序，longitude 由西至東排序。
3. 以這兩條 observed axes 建立 row-major index。
4. 每個 frame 必須包含完整 `rows × cols` 唯一格點。
5. 缺格／重複格／缺少 +30/+60/+90/+120 任一時段時 fail closed。

`grid.stepLat / stepLon` 只應視為 metadata / diagnostics，不應成為 reconstruction source of truth。

這是 Weather App 整合時最重要的 Forecast Map regression contract。

## Forecast Map rendering 原則

Rain-Track web reference pipeline：

```text
/api/rain/nowcast
  → observed-axis normalization
  → row-major values
  → RGBA Canvas raster
  → Leaflet ImageOverlay
```

Weather App 不需要複製 Web Canvas / Leaflet；可以使用 native bitmap / map overlay，但應保留以下產品語義：

- `0 mm` / very-low threshold cell 可透明。
- 色階只影響 presentation，不改官方 rainfall values。
- 顯示單位必須是 `mm / 30 min`。
- 每個 Forecast frame 顯示完整有效時段，例如 `09:00–09:30`，不要只顯示一個時間而與 Radar scan time 混淆。
- 不自行插值成 HKO 未公開的 6 分鐘 Forecast frames。
- Radar 與 Forecast Map 應視為兩種不同產品，不應疊加後讓使用者誤認為同一時間維度。

Rain-Track 正式 UI 使用：

```text
關閉 / 雷達 / 2小時預報
```

作互斥模式，可直接作 native UX 參考。

## HKO source assumptions

### Point rainfall / Forecast Map

Worker 使用 HKO gridded rainfall nowcast CSV：

```text
https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast_tc.csv
```

Worker 已負責 CSV parser、official grid coverage、point interpolation、nearby samples、freshness / spatial quality assessment。

Rain-Track 前端則使用完整 `/api/rain/nowcast` points 做 Forecast Map normalization。Weather App 初次整合應消費 Worker response，**不要直接重新抓 HKO CSV 建第二套 backend parser**。

### Radar

Live radar 使用 HKO 現行 transparent GIS overlay：

- 64 km / 3 km：`R4_GIS_rad_064`
- 256 km / 3 km：`R4_GIS_rad_256`
- 64 km / 2 km：現行 64 km 2 km KML product

不要恢復：

- 舊 2019 `Radar_064.kml` / `Radar_256.kml` Live feed
- 包含 HKO 底圖、legend、logo、time label 的完整成品 JPEG Leaflet overlay

Radar scan time 是觀測時間；Forecast valid time 是未來預報時段，兩者不可直接比較。

個別 radar product 可能存在 blind sector / data void。不要在 native app 自行合成或插值不存在的 radar echo。

## Weather App state mapping

| Rain-Track PWA | Weather App 建議 |
|---|---|
| `localStorage` preferences | Android DataStore / existing app settings layer |
| Browser geolocation | Weather App existing fused location pipeline |
| `state.selected` | shared Weather App location/domain state |
| saved points | native persistence only if product still needs it |
| Service Worker cache | Weather App repository/cache policy |
| Leaflet map | native map choice to be decided during integration |
| Canvas Forecast raster | native bitmap / map overlay |
| PWA update lifecycle | Android app release lifecycle |

Weather App 已有定位、offline atomic cache、settings 及 native lifecycle；整合時應重用這些既有能力。

## UI migration priority

建議按價值移植：

1. 定點兩小時降雨摘要／時段。
2. 正式兩小時 Forecast Map + 4-frame有效時段 timeline。
3. Live Radar + timeline。
4. `關閉 / 雷達 / 2小時預報` 互斥模式。
5. 64 / 256 km、2 / 3 km、opacity、Live / TEST controls。
6. nearby radius / spatial-sensitivity explanation。
7. 進階 diagnostics 只保留開發／debug 需要的部分。

Rain-Track 的 mobile information density、segmented controls 及 timeline 可作 Compose UI 參考，但不必複製 DOM 結構。

## 與 Storm-Track 的整合原則

Rain-Track 與 Storm-Track 應在 Weather App 才匯合：

- Rain-Track Worker 繼續專責 point rainfall + Forecast grid + radar。
- Storm-Track Worker 繼續專責 tropical cyclone live/history data。
- 初期不要為了「一個 app」而先強行合併兩個 Cloudflare Workers。
- Weather App data layer 可以同時接兩個 backend，等 native integration 穩定後再評估 backend consolidation。

## 2026-08-14 wet-weather acceptance

已完成的真雨驗證包括：

- 定點 forecast window 能正常更新。
- Live radar 64 km / 2 km、64 km / 3 km、256 km / 3 km 正常切換。
- Forecast Map 真實 HKO grid 能渲染至 4/4 +120 分鐘。
- observed-axis rounding bug 已修正並加入 regression test。
- Forecast smooth rendering 在手機上比強制 pixelated rendering 可讀性更佳，因此正式版保持瀏覽器平滑縮放。
- 正式 `關閉 / 雷達 / 2小時預報` 互斥切換、Forecast timeline 及 legend 已通過 Android 真機測試。

## 封版原則

Rain-Track 現在再次視為 stable reference implementation。除非出現以下情況，否則不再主動增加獨立 PWA 功能：

- HKO upstream schema / URL 改變
- Worker API contract bug
- PWA startup / atomic update regression
- 真雨實測發現明顯 calculation / source-contract bug
- Weather App integration 發現缺少必要 backend field

其他新產品功能優先在 `Weather_Metro_App` 規劃。
