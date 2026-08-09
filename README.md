# 香港定點雨量預報 v1.6.3

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

前端 v1.6.2 的定點預報仍兼容 Worker v2.3 或以上；要啟用即時雨量雷達，建議將 Repository 的最新 `worker.js` v2.4.3 部署到 `https://radar.max-yu.workers.dev`。前端會透過 `/api/capabilities` 自動判斷是否解鎖雷達開關。

## v1.6.3 Radar UX Refinement

- 雷達開啟時，手機頂部狀態改由雷達最新幀控制，不再把定點預報的 freshness 誤當成雷達延遲。
- 雷達正常時顯示「雷達 N分鐘前」；15–30分鐘顯示雷達更新稍有延遲；背景更新失敗時明確顯示保留上一幀。
- 關閉雷達後立即恢復定點預報 freshness 狀態；Bottom Sheet 仍獨立顯示預報資料年齡。
- 時間軸新增「最新 N 分鐘前」資訊，歷史幀時間與資料新鮮度分開。
- Live 模式加入精簡「雷達回波」弱→強示意色帶；TEST 模式不顯示該圖例。
- Service Worker 快取更新至 `point-rain-pwa-v1.6.3`。

## v1.6.2 HKO GIS Radar Overlay

- 實機截圖確認 HKO 完整雷達 JPEG 不適合直接作 Leaflet Overlay：成品圖包含底圖、時間及右側色板，會造成地圖重疊、泛藍及比例失真。
- Worker v2.4.3 改用香港天文台 Regional Weather Information Portal 使用的現行 `R4_GIS` KML／PNG 雷達圖層。
- 64 公里來源為 `R4_GIS_rad_064/R4_GIS_server_Radar_064.kml`，PNG 為 800×800；256 公里來源為 `R4_GIS_rad_256/R4_GIS_server_Radar_256.kml`，PNG 為 1900×1900。
- 兩種 GIS PNG 均帶透明度資料，可直接疊在 CARTO／OpenStreetMap 底圖上，只顯示雷達回波，不再顯示 HKO 成品圖底圖、Logo、時間及色板。
- 每個 GroundOverlay 使用 HKO KML 提供的 LatLonBox，64／256 公里分別使用其官方地理邊界。
- R4 KML 的畫面名稱／檔名使用香港本地時間；Worker 優先從檔名解析 HKT，避免把 KML `<when>` 尾端 `Z` 誤當真正 UTC。
- 保留最多20幀、約每6分鐘更新；Live 最新幀仍須通過30分鐘 freshness 驗證。
- 前端加入專用 Leaflet `radarPane`（z-index 350），雷達位於底圖之上、定點及附近半徑向量之下；底圖切換仍可正常使用。
- Radar Contract 維持 v1.0；TEST 模式、播放／暫停、時間軸、透明度及64／256公里切換保持相容。
- App 版本更新至 v1.6.2，Service Worker 快取更新至 `point-rain-pwa-v1.6.2`。

## Worker v2.4.3 Current HKO GIS Radar Source

- Live 主來源改為 HKO 現行 `R4_GIS` KML；不再把 `temp_json/nradar_img.json` 的完整成品 JPEG 當作地理 Overlay。
- `/api/radar/frames` 繼續輸出同一 Radar Contract v1.0，新增 `renderMode: transparent-georeferenced-overlay` 說明。
- `/api/radar/image` 繼續作官方 HKO 雷達 PNG 安全代理。
- 64 公里及256公里各提供20個 GroundOverlay；圖片本身含透明 palette (`tRNS`)。
- Worker v2.4.3 需要手動重新部署到 `https://radar.max-yu.workers.dev`；GitHub Pages 部署不會自動更新 Cloudflare Worker。

## v1.6.1 Live Radar Integration Fix

- 實機／Chromium 手機 smoke test 已驗證 HKO Live 64 km、256 km 雷達影像均可經 Worker proxy 載入。
- 驗證播放／暫停、時間軸、64／256 km 切換、透明度控制及關閉圖層流程。
- 雷達設定說明由舊 KML 文案改為 HKO 現行即時雷達影像索引。
- 雷達首次載入失敗時會自動關閉雷達狀態及開關，並恢復原本 Bottom Sheet。
- 記住 64／256 km 範圍及雷達透明度。
- 設定抽屜標題／關閉按鈕改為 sticky，長頁面捲動後仍可操作。
- Service Worker 快取版本更新至 `point-rain-pwa-v1.6.1`。

## v1.6.0 Rain Radar Phase A + B

- 新增 HKO 雷達幀讀取，支援 64 公里及 256 公里範圍；目前 Live 來源由 Worker v2.4.3 的現行 HKO R4 GIS KML／透明 PNG 提供。
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
