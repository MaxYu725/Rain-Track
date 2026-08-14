# Rain-Track — 香港定點雨量與兩小時預報地圖

Rain-Track 是香港定點未來兩小時雨量、HKO 雷達觀測與兩小時格點預報地圖 PWA。專案目前再次進入 **stable / maintenance mode**；下一個主要產品階段是把已驗證能力整合到 `Weather_Metro_App`，而不是繼續擴充獨立 PWA。

## 穩定基線 — 2026-08-14

- App UI：`v1.6.4`（Forecast Map extension）
- PWA App Shell generation：`point-rain-pwa-v1.6.4-pwa17`
- Worker：`v2.5.0`
- Radar Contract：`v1.0`
- Forecast Map feature baseline：`a4544663abb01ddfba90d35ecb0f55dbb3498c5c`
- SWIRLS Worker source baseline：`c95d82b10370d834fdb4ec8a64d571bcf8e145c6`
- 正式 Worker：`https://radar.max-yu.workers.dev`
- 前端：GitHub Pages，由 `main` repository root 發布

2026-08-14 真雨實測已完成：定點預報、Live Radar、正式兩小時 Forecast Map、4-frame timeline、Radar / Forecast 互斥切換及手機 rendering 均已在 Android 實機驗證。同日 Worker `v2.5.0` 已正式部署，SWIRLS 16-frame runtime 與既有 Point / Nowcast / 三組 Live Radar 均通過 production smoke。

## 已完成能力

### 定點雨量預報

- HKO 未來兩小時 gridded rainfall nowcast。
- 定點雙線性插值。
- 1 / 2 / 3 / 5 km 附近雨勢比較。
- 降雨開始時段、較強時段、總雨量及資料新鮮度。
- 雨區邊界／附近差異提示。
- 定位、香港地區搜尋、儲存及分享位置。
- 網絡失敗時保留最近成功預報。

### HKO Live Radar

正式 Live source 使用 HKO 現行透明 GIS radar overlay：

- 64 km / 2 km height
- 64 km / 3 km height
- 256 km / 3 km height
- 最多約 20 幀供前端動畫使用
- 約每 6 分鐘一幀
- 播放／暫停、最新幀、slider、透明度及 freshness
- TEST synthetic radar，可在無雨日驗證 UI / animation flow

Radar 顯示的是**觀測／過去掃描**，不是未來兩小時預報。個別產品可能存在上游 blind sector / data void；Rain-Track 不會自行補畫雷達回波。

**不要重新使用**舊 `Radar_064.kml` / `Radar_256.kml` 作 Live source，亦不要把包含底圖、legend、logo 的完整 HKO 成品 JPEG 當 Leaflet georeferenced overlay。現行方向是透明 GIS radar image 疊在 CARTO / OSM 底圖之上。

### 兩小時 Forecast Map

正式 Forecast Map 直接使用現有 Worker：

```http
GET /api/rain/nowcast
```

前端把官方完整 gridded nowcast normalization 成 4 個未來 30 分鐘累積雨量 frame，並以 Canvas raster + Leaflet overlay 顯示：

- +30 / +60 / +90 / +120 分鐘
- 單位：`mm / 30 min`
- 4 個可直接選取的有效時段
- 明確顯示 `開始–結束` window、HKO issue time、frame counter 與半小時雨量 legend
- 與 Radar 使用正式三段模式：`關閉 / 雷達 / 2小時預報`
- Radar 與 Forecast Map 永遠互斥，避免把觀測回波與未來預報誤讀為同一產品

### SWIRLS 6 分鐘預報資料層

Worker `v2.5.0` 另加入經驗證的 HKO SWIRLS raw forecast runtime，作為未來 Weather App 更細時間軸的 backend contract：

```http
GET /probe/swirls
GET /api/rain/swirls/frame?frame=0..15
```

目前 contract：

- 16 個 forecast frame
- 6 分鐘 cadence
- 約 +30 至 +120 分鐘 forecast horizon
- 每個 frame 代表 30 分鐘累積雨量
- 單位：`mm / 30 min`
- 每個 frame 為 `121 × 121`，共 `14,641` cells
- index / MDL publication rollover mismatch 會 bypass cache 重試一次；仍不一致則 fail closed
- index 與 MDL 正常 cache TTL 為 45 秒，upstream timeout 為 12 秒

SWIRLS frame 是**預報資料**；Live Radar 仍然是**觀測資料**。目前獨立 Rain-Track PWA 的 Forecast Map 保持既有 4-frame `/api/rain/nowcast` UI，不把 SWIRLS 16-frame backend 強行塞入已封版介面。

### Forecast Map 重要資料契約

HKO CSV 的 latitude / longitude 會因三位小數 rounding 出現相鄰差值 `0.019 / 0.020` 交錯。因此：

- **實際 points 的 unique latitude / longitude axes 才是 source of truth**。
- `stepLat / stepLon` 只可視為 metadata，不應拿來重建完整 axis。
- frame 必須包含完整 `rows × cols` 唯一格點；缺格／缺時段時 fail closed。
- 不自行插值生成不存在的 6 分鐘 Forecast Map frame。

這個 contract 已有 synthetic regression gate，並經 2026-08-14 真雨資料驗證。

## 架構

```text
GitHub Pages PWA
  index.html
  css/
  js/
  service-worker.js
        │
        ▼
Cloudflare Worker v2.5.0
  /api/capabilities
  /api/rain/point
  /api/rain/nowcast
  /probe/swirls
  /api/rain/swirls/frame?frame=0..15
  /api/radar/frames
  /api/radar/image
        │
        ▼
Hong Kong Observatory public data / GIS radar / SWIRLS sources
```

Forecast Map 前端 pipeline：

```text
/api/rain/nowcast
  → observed-axis normalization
  → row-major rainfall raster
  → RGBA Canvas
  → Leaflet ImageOverlay
  → 4-frame Forecast timeline
```

前端 API base 集中在 `js/config.js`，實際請求封裝在 `js/api.js`。

## PWA 更新策略

使用 atomic App Shell update：

1. 新 Service Worker 以新的 generation cache 預載完整本地 App Shell。
2. HTML / JS / CSS 不由舊 runtime cache 混合取得。
3. 使用者看到「已有新版可用」後按「立即更新」。
4. 新 Worker activate、清除舊 Rain-Track caches 並 `clients.claim()`。
5. controller change 後以 cache-busting navigation reload 切換整套版本。

Android installed PWA 已實機確認更新時不需要手動清除瀏覽器資料。

## CI

Pull request 到 `main` 及 `main` push 會執行：

- `node --check worker.js`
- `node --check service-worker.js`
- 全部 `js/*.js` syntax check
- `scripts/validate-app-shell.mjs`
- App Shell 檔案存在性／module dependency 驗證
- `scripts/validate-forecast-map-contract.mjs`
- Forecast Map 四個時段、完整格點、row-major orientation 與 observed-axis regression
- `scripts/validate-swirls-contract.mjs`
- `scripts/validate-swirls-runtime.mjs`
- `scripts/validate-worker-swirls-inline.mjs`

Production Worker 另有 `scripts/smoke-worker-production.mjs`，驗證 v2.5.0/SWIRLS、Point、Nowcast、三組 Live Radar 及實際 radar image proxy。

## 2026-08-14 真雨驗收結論

真雨測試曾發現兩個值得保留的結論：

1. HKO 官方網頁顯示的未來時間是 Forecast valid time，不能與 Radar scan time 直接比較。
2. Forecast Map 初版因錯誤以 minimum step 重建等距 axis，會把完整 HKO grid 誤判成缺格；現已改為 observed unique axes 並加入 regression test。

64 km / 2 km、64 km / 3 km、256 km / 3 km 同時出現的筆直雷達 data void 屬上游 radar coverage / product artifact 的合理可能性；Rain-Track 不應合成不存在的回波去填補。

## 未來 Weather App 整合

`Weather_Metro_App` 是 Kotlin + Jetpack Compose 原生 Android app。整合 Rain-Track 時應直接消費 Worker API / domain contract，而不是用 WebView 嵌入本 PWA。

具體整合契約及 Forecast Map 注意事項見 [`INTEGRATION.md`](INTEGRATION.md)。Storm-Track 保持獨立專案，在 Weather App data layer 才與 Rain-Track 匯合。

## 部署

### Frontend

正式前端由 GitHub Pages 從 `main` repository root 發布。前端 repository 修改不會自動部署 Cloudflare Worker。

### Worker

正式 Worker：

```text
https://radar.max-yu.workers.dev
```

目前正式 Worker 為 `v2.5.0`，2026-08-14 production smoke 已通過。

Repository 提供 `.github/workflows/deploy-worker.yml` 作正式部署入口。此 workflow **只接受手動 `workflow_dispatch`**，不會因普通 `main` push 自動覆寫 production。流程固定為：

1. Worker syntax + SWIRLS inline parity validation。
2. Wrangler production dry-run。
3. 部署 `worker.js` 到 Worker `radar`。
4. 保留現行 `compatibility_date = 2026-08-05` 與 Dashboard variables。
5. 自動執行完整 production smoke。

GitHub Actions 需要 repository secrets：

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

不要把 Cloudflare token 寫入 repository、workflow 明文或 Worker source。

## 封版原則

Rain-Track 再次視為 stable reference implementation。只有以下情況才應重新開發：

- HKO upstream schema / URL 改變
- Worker API contract bug
- PWA startup / atomic-update regression
- 真雨測試發現明顯 calculation / source-contract bug
- Weather App integration 發現缺少必要 backend field

純 UI 新功能優先在 `Weather_Metro_App` 規劃。

## 歷史

較早版本、Radar source 遷移及 Foundation 改動保留在 [`CHANGELOG.md`](CHANGELOG.md)。
