# 香港定點雨量預報 v1.5 Foundation

## 部署內容

將整個資料夾內容放到 GitHub Repository／Cloudflare Pages 網站根目錄：

```text
index.html
css/
js/
icons/
screenshots/
manifest.webmanifest
service-worker.js
offline.html
worker.js
_headers
```

Cloudflare Pages 不需要 build command；輸出目錄使用 Repository 根目錄。

將 `worker.js` 貼到 Cloudflare Worker 並部署。前端 v1.5 要求 Worker v2.3 或以上，不再使用舊 `/api/rain/nowcast` 前端插值後備。

## v1.5 Foundation 內容

- CSS及JavaScript拆分成模組，雷達程式獨立在 `js/radar.js`。
- 資料新鮮度與位置敏感度分開顯示。
- 每個預報時段改為半小時區間，例如 `23:00–23:30`。
- 定位先檢查權限；尚未決定時不會在啟動後立即彈系統提示。
- 先快速定位，精度不足時再嘗試高精度定位。
- 頁面在背景時暫停自動更新；返回前景後按資料年齡更新。
- API請求加入12秒逾時；背景更新保留原有預報。
- 改善文字尺寸、對比、鍵盤焦點、讀屏公告及設定抽屜焦點管理。
- 加入香港地區搜尋、官方網格範圍、分享私隱選項及應用程式內對話框。
- PWA更新改為由使用者確認後才套用，避免運作途中混用新舊檔案。
- 雷達 API 契約版本定為 v1.0，但 Worker仍回報 `radarFrames: false`。

## 第三方地圖程式

Leaflet 1.9.4 以固定版本及完整性雜湊載入；Service Worker會在首次成功載入後快取該資源。線上底圖仍由 OpenStreetMap／CARTO 提供。

`_headers` 提供 Cloudflare Pages 的基本安全標頭及定位權限政策。
