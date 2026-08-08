# 香港定點雨量預報 v1.5.3

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
.nojekyll
```

Cloudflare Pages 不需要 build command；輸出目錄使用 Repository 根目錄。

將 `worker.js` 貼到 Cloudflare Worker 並部署。前端 v1.5.3 要求 Worker v2.3 或以上，不再使用舊 `/api/rain/nowcast` 前端插值後備。

## v1.5.3 Location Stability & Time UX

- 定位只在一般／高精度結果比較完成後更新一次地圖，消除定位後地圖來回跳動。
- 定位進行期間鎖定定位按鈕；手動定位最多只接受30秒快取位置。
- 手機地圖置中直接計算 Bottom Sheet 可視區，一次設定最終地圖中心。
- 預報刷新不再自動移動地圖。
- 時段卡以實際區間為主，加入「進行中／已過／下一時段／其後」狀態。
- 摘要新增「預報有效至」，避免把預報基準誤解為目前時間。
- 無雨時段再精簡；一般更新延遲不會強制打開 Bottom Sheet。
- 儲存／分享按鈕改用標準圖示，附近比較圓圈降低視覺權重。
- Service Worker 快取版本更新至 `point-rain-pwa-v1.5.3`。

## v1.5.2 UI Compression & Diagnostics

- 自動清除舊 `radar.maxyu0725.workers.dev` 本地設定，改用 `https://radar.max-yu.workers.dev`。
- 設定頁新增 App／Worker／API 診斷資訊。
- 手機頂部工具列壓縮，Bottom Sheet 展開時隱藏地圖右上狀態。
- 無雨、資料正常時自動收起 Bottom Sheet，減少遮擋地圖。
- 無雨模式減少重複的 `0.0 mm` 顯示。
- `位置變化穩定` 改名為 `附近差異小`，敏感狀態改為 `雨區邊界接近`。

## v1.5 Foundation 內容

- CSS及JavaScript拆分成模組，雷達程式獨立在 `js/radar.js`。
- 資料新鮮度與位置敏感度分開顯示。
- 每個預報時段使用完整半小時區間。
- 定位先檢查權限；尚未決定時不會在啟動後立即彈系統提示。
- 頁面在背景時暫停自動更新；返回前景後按資料年齡更新。
- API請求加入12秒逾時；背景更新保留原有預報。
- 改善文字尺寸、對比、鍵盤焦點、讀屏公告及設定抽屜焦點管理。
- 加入香港地區搜尋、官方網格範圍、分享私隱選項及應用程式內對話框。
- PWA更新改為由使用者確認後才套用，避免運作途中混用新舊檔案。
- 雷達 API 契約版本定為 v1.0，但 Worker仍回報 `radarFrames: false`。

## 第三方地圖程式

Leaflet 1.9.4 以固定版本及完整性雜湊載入；Service Worker會在首次成功載入後快取該資源。線上底圖仍由 OpenStreetMap／CARTO 提供。

`_headers` 提供 Cloudflare Pages 的基本安全標頭及定位權限政策。
