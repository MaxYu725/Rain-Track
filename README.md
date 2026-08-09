# 香港定點雨量預報 v1.6.2

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

前端 v1.6.2 的定點預報仍兼容 Worker v2.3 或以上；要啟用即時雨量雷達，建議將 Repository 的最新 `worker.js` v2.4.2 部署到 `https://radar.max-yu.workers.dev`。前端會透過 `/api/capabilities` 自動判斷是否解鎖雷達開關。

## v1.6.2 Radar Rendering Fix

- 修正 HKO Live 雷達 JPEG 右側資訊欄／色板被一併當成地圖 Overlay，造成雷達圖橫向壓縮的問題。
- Live 幀在瀏覽器端以 Canvas 自動裁出左側正方形雷達地圖本體；現行 577×400 HKO 圖會裁成 400×400，再按既有 64／256 km bounds 顯示。
- 新增專用 Leaflet `radarPane`（z-index 350），讓雷達位於底圖之上、定點及附近半徑向量之下。
- Live 模式顯示 HKO 雷達地圖時暫時移除 CARTO tiles，避免 HKO 內建地圖與 CARTO 疊加造成整片泛藍、道路及海岸線雙影。
- Live 雷達期間停用底圖切換；關閉雷達、切到 TEST 模式或 Live 載入失敗時自動恢復原本明暗底圖。
- 裁圖以 blob URL 快取並限制數量；關閉雷達時釋放，減少動畫重播時重複 Canvas 處理及記憶體累積。
- TEST 模式維持透明合成 Overlay，用於晴天功能測試。
- Service Worker 快取版本更新至 `point-rain-pwa-v1.6.2`。

## Worker v2.4.2 Current HKO Live Radar Source

- Live 雷達主來源改用香港天文台現行雷達網頁使用的 `wxinfo/radars/temp_json/nradar_img.json` 影像索引，不再以停留在 2019 年的舊 KML 作即時來源。
- 64 公里使用索引 `range2`（3 公里高度）；256 公里使用 `range0`，兩者目前均提供20幀、約每6分鐘一幀。
- 影像檔名時間按香港時間解析，例如 `2d064nradar_YYYYMMDDHHmm.jpg`。
- 最新幀必須在30分鐘內才視為 Live；最新幀新鮮時可保留最多150分鐘歷史幀作動畫，不會像 v2.4.1 一樣把整段兩小時歷史逐幀誤判為過期。
- 雷達影像仍經 `/api/radar/image` 代理，並限制為香港天文台官方 radar image 路徑。
- 舊 KML 僅保留為診斷資訊，不會被查詢或用作 Live fallback。
- Radar Contract 維持 v1.0，因此 v1.6.x 前端毋須修改 Worker API 契約。

## v1.6.1 Live Radar Integration Fix

- 實機／Chromium 手機 smoke test 已驗證 HKO Live 64 km、256 km 雷達影像均可經 Worker proxy 載入。
- 驗證播放／暫停、時間軸、64／256 km 切換、透明度控制及關閉圖層流程。
- 雷達設定說明由舊 KML 文案改為 HKO 現行即時雷達影像索引。
- 雷達首次載入失敗時會自動關閉雷達狀態及開關，並恢復原本 Bottom Sheet。
- 記住 64／256 km 範圍及雷達透明度。
- 設定抽屜標題／關閉按鈕改為 sticky，長頁面捲動後仍可操作。
- Service Worker 快取版本更新至 `point-rain-pwa-v1.6.1`。

## v1.6.0 Rain Radar Phase A + B

- 新增 HKO 雷達幀讀取，支援 64 公里及 256 公里範圍；目前 Live 來源由 Worker v2.4.2 的現行 HKO JSON 影像索引提供。
- Worker 新增 `/api/radar/frames`、`/api/radar/image` 及 `/probe/radar`。
- 雷達影像以 Leaflet image overlay 疊加在現有定點雨量地圖，不另開頁面。
- 時間軸加入播放／暫停、拖曳選幀、最新幀及幀數顯示。
- 預載最近及相鄰影像，切換時先載入新幀再替換舊圖層，減少閃爍。
- 即時模式約每 5.5 分鐘檢查新幀；背景更新失敗時保留最後可用雷達畫面。
- 設定支援 64／256 公里、透明度及慢／標準／快動畫速度。
- 手機開啟雷達時自動將定點預報 Bottom Sheet 收至 peek；關閉雷達後恢復先前高度。
- 新增 `mode=test` 測試動畫及 Worker 合成測試圖，晴天亦可驗證圖層、時間軸及動畫流程。
- Service Worker 快取版本更新至 `point-rain-pwa-v1.6.0`。

### 雷達 API

```text
GET /api/radar/frames?range=64&mode=live
GET /api/radar/frames?range=256&mode=live
GET /api/radar/frames?range=64&mode=test
GET /api/radar/image?id=...
GET /api/radar/test-image?range=64&frame=0
GET /probe/radar?range=64&mode=live
```

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
- 雷達 API 契約版本定為 v1.0。

## 第三方地圖程式

Leaflet 1.9.4 以固定版本及完整性雜湊載入；Service Worker會在首次成功載入後快取該資源。線上底圖仍由 OpenStreetMap／CARTO 提供；Live HKO 雷達開啟期間會暫時隱藏 CARTO，以避免兩套地圖重疊。

`_headers` 提供 Cloudflare Pages 的基本安全標頭及定位權限政策。
