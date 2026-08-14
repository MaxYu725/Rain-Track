# Rain-Track — 香港定點雨量與兩小時預報地圖

Rain-Track 是香港定點未來兩小時雨量、HKO 雷達觀測與 HKO SWIRLS 兩小時格點預報 PWA。獨立版現已進入 **stable / maintenance / Weather Metro integration-reference** 狀態。

## Production baseline — 2026-08-14

- Rain-Track main：`b762b27ac428b5369b53ba2b6c5ee7b7d65dfc9d`
- App UI：`v1.6.4`
- PWA App Shell generation：`point-rain-pwa-v1.6.4-pwa20`
- Worker：`v2.5.0`
- Radar Contract：`v1.0`
- Production Worker：`https://radar.max-yu.workers.dev`
- Frontend：GitHub Pages from repository `main`

## 已完成能力

### 定點兩小時雨量

- HKO gridded rainfall nowcast
- 定點雙線性插值
- 1 / 2 / 3 / 5 km 附近雨勢比較
- 降雨開始時段、較強時段、總雨量、freshness / spatial quality
- 定位、香港地區搜尋、儲存／分享位置
- 最近成功預報 fallback

### HKO Live Radar

- 64 km / 2 km
- 64 km / 3 km
- 256 km / 3 km
- 約 6 分鐘 cadence
- 最多約 20 幀
- 播放／暫停、slider、最新幀、透明度、Live / TEST

Radar 是**觀測／過去掃描**，不是未來預報。個別產品可能存在 HKO upstream blind sector / data void；Rain-Track 不自行合成回波填補。

### SWIRLS 兩小時 Forecast Map

Production Worker `v2.5.0` 提供：

```http
GET /probe/swirls
GET /api/rain/swirls/frame?frame=0..15
```

目前正式前端已接入：

- 16 個 Forecast frame
- 每 6 分鐘一個**有效時間**
- 約 +30 → +120 分鐘
- 每個 frame 仍代表 **30 分鐘累積雨量**
- 單位 `mm / 30 min`
- 每個 frame `121 × 121 = 14,641` cells
- lazy loading，不在進入模式時一次下載 16 frame
- play / pause 自動播放
- 慢 / 標準 / 快播放速度
- Forecast opacity 獨立保存
- Radar 與 Forecast 設定分離
- mobile bottom-sheet / timeline 避讓

**6 分鐘是 Forecast valid-time step，不是 6 分鐘累積雨量。**

### Nowcast fallback

```http
GET /api/rain/nowcast
```

仍保留作完整 HKO gridded nowcast fallback / reference path，可重建：

```text
+30 / +60 / +90 / +120 minutes
```

如果 SWIRLS 暫時不可用，前端可退回這個 4-period Forecast Map，而不是令整個預報圖失效。

## 重要 Forecast grid contract

HKO CSV latitude / longitude 因三位小數 rounding，鄰格差值可能在 `0.019 / 0.020` 間交錯。

因此 `/api/rain/nowcast` normalization 必須：

1. 使用實際 points 的 unique latitude / longitude axes；
2. latitude north → south；
3. longitude west → east；
4. 以 observed axes 建 row-major index；
5. 缺格／重複格／缺 required period 時 fail closed。

不要用單一 `stepLat / stepLon` 人工重建整條 axis。

SWIRLS frame 則使用 Worker 已驗證的固定 `121 × 121` grid contract。

## Architecture

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

## Production deployment

### Frontend

`main` push 由 GitHub Pages 部署。PWA 使用 atomic App Shell generation；目前 generation 為 `pwa20`。

### Worker

Worker 不跟隨普通 `main` push 自動部署。

正式入口：

```text
Actions → Deploy Worker production → Run workflow
```

Workflow：

1. syntax / parity validation
2. Wrangler dry-run
3. deploy Worker `radar`
4. production smoke

需要 GitHub Secrets：

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

不要把 Cloudflare token 寫入 repository 或 app source。

## Weather Metro integration

下一個主要產品階段是把 Rain-Track 與 Storm-Track 的成熟能力整合到 `MaxYu725/Weather_Metro_App`。

Integration 原則：

- Weather Metro 維持 Kotlin + Jetpack Compose 原生架構
- native client 直接消費 Rain Worker public API
- 不以 WebView 嵌入 Rain-Track PWA
- Rain / Storm backend 初期保持獨立
- Weather Metro `tools` Pivot 成為兩個工具的 host
- Rain-Track standalone 保留作 regression/reference implementation

完整 contract：[`INTEGRATION.md`](INTEGRATION.md)

## CI

PR / `main` validation 包括：

- Worker / Service Worker / frontend JS syntax
- atomic PWA app-shell validation
- `/api/rain/nowcast` Forecast Map contract
- SWIRLS raw feed / runtime / Worker inline parity
- SWIRLS frontend 16-frame contract
- Forecast autoplay + Radar/Forecast settings separation
- production SWIRLS frontend live probe

Production Worker 另由 `scripts/smoke-worker-production.mjs` 驗證：

- health / capabilities
- SWIRLS probe + frame 0 / 15
- point forecast
- nowcast
- 64/2、64/3、256/3 Radar
- actual radar image proxy

## Freeze rule

Rain-Track 現在視為 stable reference implementation。只在以下情況重新開 standalone runtime：

- HKO upstream schema / URL 改變
- Worker API contract bug
- PWA startup / atomic-update regression
- 真雨測試發現 calculation / source-contract bug
- Weather Metro integration 證明缺少必要 backend field

其他新產品 UX 優先在 `Weather_Metro_App` 實作。