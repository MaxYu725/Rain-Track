# Rain-Track — 香港定位雨勢與兩小時預報地圖

Rain-Track 是香港定位降雨預報、HKO 雷達觀測與 HKO SWIRLS 兩小時格點預報 PWA。2026-08-19 起 standalone 重新進入主動產品開發，核心分成兩個清楚問題：

1. **首頁：我身處的位置會不會下雨？**
2. **2 小時雨區：未來的雨主要在哪裡？**

## Production baseline — 2026-08-19

- Rain-Track main：`0e770c088932680c6df4176e467d04f5ab50e1dd`
- App UI：`v1.6.4`
- Rain Home：location-first 16-point SWIRLS trend + interactive point explorer
- Forecast Map：free pan / zoom + 香港／深圳／南面海域／全域／定位 quick views
- PWA App Shell generation：`point-rain-pwa-v1.6.4-pwa24`
- Worker baseline：`v2.5.0` + Phase 3C compact SWIRLS point routes
- Radar Contract：`v1.0`
- Production Worker：`https://radar.max-yu.workers.dev`
- Frontend：GitHub Pages from repository `main`

## 產品架構

### Rain Home — 定位預報

首頁不再以地圖或 bottom sheet 作主要資訊層，而是直接回答目前定位的雨勢：

- 自動使用目前定位／已選位置
- 顯示一句主要降雨判斷
- 顯示一句雨勢增強、峰值、減弱等趨勢說明
- 以折線圖顯示 SWIRLS 定點未來變化
- 16 個有效時間
- 約 +30 → +120 分鐘
- 每 6 分鐘一個**有效時間**
- 每個點仍代表 **30 分鐘累積雨量**
- 單位 `mm / 30 min`
- 一鍵進入「查看 2 小時雨區」

**6 分鐘是 Forecast valid-time cadence，不是 6 分鐘累積雨量。**

Rain Home 不會把相鄰 30 分鐘 rolling accumulation 相減來偽造「6 分鐘雨量」。

#### 16-point explorer

折線圖的 16 個點都可直接檢視：

- touch / click 每個預報點
- 28 px touch target，不改變實際 plotted value
- 顯示有效時間與 lead time
- 顯示該點對應的 30 分鐘累積時窗
- 顯示 `mm / 30 min` 數值
- 鍵盤支援 Enter / Space / ArrowLeft / ArrowRight
- 有雨時預設選第一個明顯降雨訊號；全乾時預設選 +30 分鐘

這個 explorer 只提高「每 6 分鐘有效時間」的可讀性，不會把資料重新解釋為 6 分鐘累積雨量。

### SWIRLS compact point series

Worker source 定義：

```http
GET /api/rain/swirls/point?frame=0..15&lat=22.3023&lon=114.1746
GET /api/rain/swirls/point-series?lat=22.3023&lon=114.1746
```

`point-series` 回傳同一 SWIRLS run 的 16 個定位點樣本，並驗證：

- frame 0 → 15
- +30 → +120 分鐘
- 6 分鐘 cadence
- 30 分鐘 accumulation
- 同一 forecast run
- bilinear grid-centre interpolation

前端會優先使用 compact `point-series`。如果 production Worker 尚未提供該 route，會暫時以既有 single-frame point endpoint 分 4-frame batch 組合 16 點序列，避免 frontend 與 Worker 必須同一時間部署。

### 2 小時雨區 — Forecast Map

2 小時頁面專門回答「雨區在哪裡」，而不是重複首頁的個人預報。

- full-screen Forecast Map
- 可自由 pan / zoom
- 可觀察全香港、局部地區、深圳及南海附近雨帶
- 16 個 SWIRLS forecast frame
- 每 6 分鐘一個有效時間
- 約 +30 → +120 分鐘
- 每 frame 為 30 分鐘累積雨量
- lazy frame loading
- play / pause
- 慢 / 標準 / 快播放速度
- Forecast opacity 獨立保存
- 手機 timeline 固定在 safe-area 上方
- 不再有 bottom-sheet avoidance observer

#### 雨區快速視野

Forecast 模式提供使用者主動觸發的快速視野：

- 香港
- 深圳
- 南面海域
- 全域 SWIRLS coverage
- 返回目前定位

這些按鈕只在使用者點擊時改變 viewport。其後可繼續自由拖曳、縮放；forecast playback、timer 或資料更新不會自動把地圖拉回預設位置。

### Bottom sheet removal

Rain Home 已移除 bottom-sheet 產品行為：

- 移除 sheet handle / forecast toggle
- 不再呈現 peek / half / full 模式
- 舊 `hkRainSheetMode` / `hkRainSheetUserMode` localStorage 會被清理
- compatibility code 即使重新寫入舊 sheet class，Rain Home shell 亦會移除

舊 sheet helper 暫時仍存在於部分成熟 Radar compatibility code path，避免一次性大改雷達 runtime；但不能再形成可見或持久的 Rain Home bottom sheet。

### HKO Live Radar

- 64 km / 2 km
- 64 km / 3 km
- 256 km / 3 km
- 約 6 分鐘 cadence
- 最多約 20 幀
- 播放／暫停、slider、最新幀、透明度、Live / TEST

Radar 是**觀測／過去掃描**，不是未來預報。個別產品可能存在 HKO upstream blind sector / data void；Rain-Track 不自行合成回波填補。

### SWIRLS Forecast Map data

核心 Worker routes：

```http
GET /probe/swirls
GET /api/rain/swirls/frame?frame=0..15
```

Grid contract：

- 16 forecast frames
- 6 分鐘 valid-time cadence
- 約 +30 → +120 分鐘
- `mm / 30 min`
- `121 × 121 = 14,641` cells / frame
- row-major north-to-south / west-to-east

### Nowcast fallback

```http
GET /api/rain/nowcast
```

仍保留作完整 HKO gridded nowcast fallback / reference path，可重建：

```text
+30 / +60 / +90 / +120 minutes
```

如果 SWIRLS 暫時不可用，Forecast Map 可退回 4-period nowcast，而不是令整個預報圖失效。

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
  Rain Home
    └─ /api/rain/swirls/point-series
       └─ fallback: 16 × /api/rain/swirls/point
       └─ interactive 16-point chart explorer
  2-hour Forecast Map
    └─ /api/rain/swirls/frame?frame=0..15
       └─ user-controlled quick views: HK / Shenzhen / South Sea / Coverage / Location
  Radar
    └─ /api/radar/frames + /api/radar/image
        │
        ▼
Cloudflare Worker
  /api/capabilities
  /api/rain/point
  /api/rain/nowcast
  /probe/swirls
  /api/rain/swirls/frame
  /api/rain/swirls/point
  /api/rain/swirls/point-series
  /api/radar/frames
  /api/radar/image
        │
        ▼
Hong Kong Observatory public data / GIS radar / SWIRLS sources
```

## Production deployment

### Frontend

`main` push 由 GitHub Pages 部署。PWA 使用 atomic App Shell generation；目前 generation 為 `pwa24`。

### Worker

Worker 不跟隨普通 `main` push 自動部署。

正式入口：

```text
Actions → Deploy Worker production → Run workflow
```

Workflow：

1. syntax / SWIRLS contract / routing validation
2. Wrangler dry-run
3. deploy Worker `radar`
4. stable production smoke
5. compact single-frame SWIRLS point smoke
6. 16-point SWIRLS point-series smoke

需要 GitHub Secrets：

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

不要把 Cloudflare token 寫入 repository 或 app source。

## CI

PR / `main` validation 包括：

- Worker / Service Worker / frontend JS syntax
- atomic PWA app-shell validation
- `/api/rain/nowcast` Forecast Map contract
- SWIRLS raw feed / runtime / Worker inline parity
- SWIRLS single-frame point contract
- SWIRLS 16-point point-series contract
- SWIRLS frontend 16-frame contract
- Forecast playback + Radar/Forecast settings separation
- Rain Home location-first integration
- Rain Home 16-point explorer / keyboard / semantic guardrail
- bottom-sheet removal / fixed Forecast timeline contract
- Forecast Map quick-view contract：只由使用者觸發，不與 playback / timer 綁定
- live SWIRLS frontend probe

Production Worker deployment 另由 smoke scripts 驗證：

- health / capabilities
- SWIRLS probe + frame 0 / 15
- point forecast
- nowcast
- 64/2、64/3、256/3 Radar
- actual radar image proxy
- compact SWIRLS single-frame point
- compact SWIRLS 16-point series

## Weather Metro integration

Rain-Track 與 Storm-Track 的成熟能力仍可整合到 `MaxYu725/Weather_Metro_App`，但 Rain-Track standalone 現在同時保留為主動開發中的快速降雨產品與 regression/reference implementation。

Integration 原則：

- Weather Metro 維持 Kotlin + Jetpack Compose 原生架構
- native client 直接消費 Rain Worker public API
- 不以 WebView 嵌入 Rain-Track PWA
- Rain / Storm backend 初期保持獨立
- Rain-Track standalone contract 保持可獨立驗證

完整 contract：[`INTEGRATION.md`](INTEGRATION.md)

## Current product rule

Rain-Track standalone 可繼續開發，但產品層保持三個問題分離：

| 模式 | 要回答的問題 | 主要資料 |
| --- | --- | --- |
| Rain Home | 我這裡會不會下雨？ | SWIRLS 定位 16-point series + point explorer |
| 2 小時雨區 | 未來雨區在哪裡？ | SWIRLS forecast grids + user-controlled map views |
| Radar | 現在實際雨區在哪裡？ | HKO radar observation |

不要重新把三者塞回同一個首頁 map + bottom sheet hierarchy。