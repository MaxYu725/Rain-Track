# Rain-Track → Weather App Integration Handoff

## 目的

Rain-Track 的獨立 PWA 已達穩定基線。未來主要方向是把 Rain-Track 與 Storm-Track 的成熟能力整合到 `MaxYu725/Weather_Metro_App`，取代／重構 Weather App 現有 `tools` page，而不是繼續把三個完整獨立前端彼此嵌套。

此文件只定義 Rain-Track 的整合邊界。Storm-Track 仍是獨立專案，不應把熱帶氣旋程式碼加入 Rain-Track。

## 目標架構

`Weather_Metro_App` 已是 Kotlin + Jetpack Compose 原生 Android app，並已有明確的 `data / domain / ui` 分層。因此建議：

```text
Weather_Metro_App
  data/
    RainTrackApi / DTO / repository
    StormTrackApi / DTO / repository      (另一獨立整合)
  domain/
    PointRainForecast
    RadarFrame / RadarProduct
  ui/
    native Compose rain / radar experience
```

Rain-Track PWA 應保留作：

- reference implementation
- Worker API smoke-test client
- browser / PWA fallback
- 對照 Weather App native implementation 的行為基準

**不建議**在 Weather App 以 WebView 直接嵌入 Rain-Track PWA。這會重複 PWA lifecycle、定位、localStorage、Service Worker、地圖及設定狀態，並與 Weather App 現有 Compose architecture 衝突。

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

Weather App 不應硬編碼「一定支援 2 km height」；應像 Rain-Track 一樣按 capabilities 啟用控制。

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

### 3. Radar frames

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

### 4. Radar image proxy

```http
GET /api/radar/image?id=...
```

不要由 Weather App 自行重建 HKO KML parsing 或直接信任任意 image URL。Worker 已限制可接受 HKO host / radar image path，並統一 proxy / cache 行為。

## HKO source assumptions

### Point rainfall

Worker 使用 HKO gridded rainfall nowcast CSV：

```text
https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast_tc.csv
```

Worker 已負責：

- CSV parser
- official grid coverage
- bilinear interpolation
- nearby samples
- freshness / spatial quality assessment

Weather App 初次整合時應消費 Worker 的 domain-ready response，**不要在 Android app 再複製一套 CSV parser / interpolation**。

### Radar

Live radar 使用 HKO 現行 GIS transparent overlay：

- 64 km / 3 km：`R4_GIS_rad_064`
- 256 km / 3 km：`R4_GIS_rad_256`
- 64 km / 2 km：現行 64 km 2 km KML product

不要恢復：

- 舊 2019 `Radar_064.kml` / `Radar_256.kml` Live feed
- 包含 HKO 底圖、legend、logo、time label 的完整成品 JPEG Leaflet overlay

## Weather App state mapping

Rain-Track web state 不應原樣搬到 Android：

| Rain-Track PWA | Weather App 建議 |
|---|---|
| `localStorage` preferences | Android DataStore / existing app settings layer |
| Browser geolocation | Weather App existing fused location pipeline |
| `state.selected` | shared Weather App location/domain state |
| saved points | native persistence only if product still needs it |
| Service Worker cache | Weather App repository/cache policy |
| Leaflet map | native map choice to be decided during integration |
| PWA update lifecycle | Android app release lifecycle |

Weather App 已有定位、offline atomic cache、settings 及 native lifecycle；Rain-Track 整合時應重用這些既有能力，不應再次建立第二套。

## UI migration priority

第一階段不需要 1:1 複製整個 PWA。建議按價值移植：

1. 定點兩小時降雨摘要／時段。
2. Rain radar 地圖及 timeline。
3. 64 / 256 km、2 / 3 km、opacity、Live / TEST controls。
4. nearby radius / spatial-sensitivity explanation。
5. 進階 diagnostics 只保留開發／debug 需要的部分。

Rain-Track 設定頁的 segmented controls、timeline quick switches 及手機資訊密度可作 Compose UI 參考，但不必複製 DOM 結構。

## 與 Storm-Track 的整合原則

Rain-Track 與 Storm-Track 應在 Weather App 才匯合：

- Rain-Track Worker 繼續專責 point rainfall + radar。
- Storm-Track Worker 繼續專責 tropical cyclone live/history data。
- 初期不要為了「一個 app」而先強行合併兩個 Cloudflare Workers。
- Weather App data layer 可以同時接兩個 backend，等 native integration 穩定後再評估 backend consolidation 是否真正有價值。

這樣可以避免一個 source 失效或 contract 改動影響另一個功能。

## Wet-weather deferred acceptance

以下是真實降雨出現後才有價值的 observational test，**不是 Rain-Track 封版 blocker**：

- 實際開始下雨時間是否落在 forecast 30-minute window 的合理範圍。
- `amountMm` 與使用者體感／官方觀測是否方向一致。
- `nearbyMaxMm` 在局部驟雨或雨區邊界是否提供額外資訊。
- `dataQuality.spatial` 是否會在明顯雨區梯度時觸發。
- Live radar 回波接近／離開所選位置時，與 point forecast 的時序是否合理。
- 強對流快速生成／消散時是否需要日後增加 nowcast uncertainty 文案。

若上述測試只發現 calibration / wording 問題，應在 Weather App native integration 階段處理；只有發現 Worker calculation / source contract 錯誤才需要回到 Rain-Track Worker 修正。

## 封版原則

Rain-Track 現在可視為 stable reference implementation。除非出現以下情況，否則不再主動增加獨立 PWA 功能：

- HKO upstream schema / URL 改變
- Worker API contract bug
- PWA startup / atomic update regression
- 真雨實測發現明顯計算錯誤
- Weather App integration 發現缺少必要 backend field

其他新產品功能優先在 `Weather_Metro_App` 規劃。
