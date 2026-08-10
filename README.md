# Rain-Track — 香港定點雨量預報

Rain-Track 是香港定點未來兩小時雨量預報及 HKO 雷達 PWA。專案目前進入 **stable / maintenance mode**；下一個主要產品階段不是繼續擴充獨立 PWA，而是把已驗證的資料能力日後整合到 `Weather_Metro_App`。

## 穩定基線 — 2026-08-10

- App UI：`v1.6.4`
- PWA App Shell generation：`point-rain-pwa-v1.6.4-pwa8`
- Worker：`v2.4.4`
- Radar Contract：`v1.0`
- Runtime baseline commit：`b46099fea54dbcdf87e43565cd62f1d0769979cb`
- 正式 Worker：`https://radar.max-yu.workers.dev`
- 前端：GitHub Pages，由 `main` repository root 發布

這個 baseline 已完成 Android installed-PWA 實機驗收，包括 atomic update、設定頁、定點預報初始化、定位、Live / TEST radar、64 / 256 km、64 km 2 / 3 km 高度、透明度、動畫、時間軸及 quick switches。

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

正式 Live source 使用 HKO 現行 GIS transparent overlay：

- 64 km / 2 km height
- 64 km / 3 km height
- 256 km / 3 km height
- 最多約 20 幀供前端動畫使用
- 約每 6 分鐘一幀
- 播放／暫停、最新幀、slider、透明度及 freshness
- TEST synthetic radar，可在無雨日驗證 UI / animation flow

**不要重新使用**舊 `Radar_064.kml` / `Radar_256.kml` 作 Live source；那些舊 feed 已不適合作現行 Live radar。亦不要把包含底圖、legend、logo 的完整 HKO 成品 JPEG 當 Leaflet georeferenced overlay。現行方向是透明 GIS radar PNG 疊在 CARTO / OSM 底圖之上。

## 架構

```text
GitHub Pages PWA
  index.html
  css/
  js/
  service-worker.js
        │
        ▼
Cloudflare Worker v2.4.4
  /api/capabilities
  /api/rain/point
  /api/rain/nowcast
  /api/radar/frames
  /api/radar/image
        │
        ▼
Hong Kong Observatory public data / GIS radar sources
```

前端 API base 集中在 `js/config.js`，實際請求封裝在 `js/api.js`。Worker 對外只提供 GET / OPTIONS，雷達影像代理只接受允許的 HKO host 及 radar image path。

## PWA 更新策略

2026-08-10 起使用 atomic App Shell update：

1. 新 Service Worker 以新的 generation cache 預載完整本地 App Shell。
2. HTML / JS / CSS 不再由舊 runtime stale-while-revalidate 混合取得。
3. 使用者看到「已有新版可用」後按「立即更新」。
4. 新 Worker activate、清除舊 Rain-Track caches 並 `clients.claim()`。
5. controller change 後以 cache-busting navigation reload 切換整套版本。

Android installed PWA 已實機確認更新時不再需要手動清除瀏覽器資料。

## CI

Pull request 到 `main` 及 `main` push 會執行：

- `node --check worker.js`
- `node --check service-worker.js`
- 全部 `js/*.js` syntax check
- `scripts/validate-app-shell.mjs`
- App Shell 檔案存在性
- `index.html` 本地 script / stylesheet / manifest / icon 對應
- ES module import 與 App Shell 一致性

## 尚未阻塞封版的實地測試

唯一值得等待真正降雨時再做的是 **wet-weather observational acceptance**，不是目前的 release blocker：

- 比較定點預報的開始／最強時段與實際降雨。
- 驗證「附近雨勢」在雨區邊界時是否具實際辨識價值。
- 比較 Live radar 回波移動與定點預報時序是否合理一致。
- 留意強對流、快速生成雨區時的 interpolation / 30-minute period 表達。

目前無雨日已可用 TEST radar 完成圖層、動畫、範圍、高度及時間軸驗證，因此沒有必要為等待下雨而繼續改程式。

## 未來 Weather App 整合

`Weather_Metro_App` 已是 Kotlin + Jetpack Compose 原生 Android app。未來整合 Rain-Track 時，**建議把 Worker API / domain behaviour 移植進 Weather App data/domain layers，而不是用 WebView 嵌入這個 PWA**。

具體整合契約及遷移注意事項見 [`INTEGRATION.md`](INTEGRATION.md)。Storm-Track 保持獨立專案，在 Weather App 整合階段才與 Rain-Track 一起規劃；Rain-Track 本身不加入熱帶氣旋功能。

## 部署

### Frontend

正式前端由 GitHub Pages 從 `main` repository root 發布。前端 repository 修改不會自動部署 Cloudflare Worker。

### Worker

修改 `worker.js` 後必須另外部署到：

```text
https://radar.max-yu.workers.dev
```

目前正式 Worker `v2.4.4` 已穩定；除非資料來源、API contract 或 Worker logic 有實際需要，封版後不應因純 UI / 文件修改重新部署 Worker。

## 歷史

較早版本、Radar source 遷移及 Foundation 改動保留在 [`CHANGELOG.md`](CHANGELOG.md)。
