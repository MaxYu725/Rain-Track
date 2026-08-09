# Changelog

## v1.6.2 HKO GIS Radar Overlay

### 正確雷達圖層
- 實機截圖確認完整 HKO JPEG 會把底圖、色板、時間及 Logo 一同疊加，造成比例失真及雙重地圖。
- 研究 HKO Regional Weather Information Portal 後改用其現行 `R4_GIS` GroundOverlay。
- 64 km：800×800 透明 PNG，官方 bounds `22.87770 / 21.72659 / 114.79378 / 113.54956`。
- 256 km：1900×1900 透明 PNG，官方 bounds `24.58614 / 19.98259 / 116.66013 / 111.68321`。
- PNG palette 含 `tRNS` 透明資料，因此 CARTO 底圖可保留，只有雷達回波覆蓋在地圖上。

### Worker v2.4.3
- Live `/api/radar/frames` 改由 HKO `R4_GIS_rad_064`／`R4_GIS_rad_256` KML 讀取20個 GroundOverlay。
- 優先由檔名／畫面名稱解析香港時間，避免誤用 KML `<when>` 的 `Z` 尾碼。
- 保留最新30分鐘 freshness、150分鐘動畫歷史及 Radar Contract v1.0。
- 回應新增 `renderMode: transparent-georeferenced-overlay`。

### 前端
- Live 及 TEST 均使用專用 Leaflet `radarPane`（z-index 350）。
- 移除先前試驗的 Canvas 裁圖、blob cache、隱藏 CARTO 及停用底圖切換做法。
- App 更新至 v1.6.2，Service Worker 快取更新至 `point-rain-pwa-v1.6.2`。

## Worker v2.4.2 Current HKO Live Source

### Live 雷達來源
- Live 雷達主來源由舊 KML 改為香港天文台現行雷達頁使用的 `wxinfo/radars/temp_json/nradar_img.json`。
- 64 公里使用 `range2`／`rad_064_png`（3 公里高度）；256 公里使用 `range0`／`rad_256_png`。
- 解析 HKO JSON 內的 `picture[...]="...jpg"` 路徑及檔名香港時間，並經既有 `/api/radar/image` 安全代理載入。
- 實測現行 feed 為20幀、每6分鐘一幀，64及256公里最新影像均可直接取得。

### 新鮮度及安全
- 最新 Live frame 必須在30分鐘內，否則整個 Live feed 回報 stale/unavailable。
- 最新幀新鮮時，保留最多150分鐘歷史幀供動畫使用；修正 v2.4.1 對每個歷史 frame 使用30分鐘門檻而會截短動畫的限制。
- 未來時間最多容許10分鐘偏差。
- 舊 KML 端點只保留在 probe 診斷資訊，標記為 `deprecated-not-queried`，不再作 Live fallback。
- Radar Contract 維持 v1.0；前端 v1.6.0 無需修改。

## v1.6.1 Live Radar Integration Fix

### Live 雷達驗證
- 以 390×844 手機 viewport 對正式 Worker v2.4.2 執行 Live Radar smoke test。
- 64 km／256 km 均成功取得20幀，實際 JPEG Overlay 可載入；播放、時間軸、範圍切換及透明度控制通過。

### UI／穩定性
- 更新雷達來源文案，移除已淘汰的 KML 描述。
- 首次 Live Radar 載入失敗時自動取消雷達開關，避免 UI 顯示已啟用但地圖沒有圖層。
- 雷達範圍及透明度加入本機保存。
- 設定抽屜標題及關閉按鈕固定在捲動頂部，改善手機長設定頁操作。
- Service Worker 快取版本更新至 `point-rain-pwa-v1.6.1`。

## v1.6.0 Rain Radar Phase A + B

### 雷達資料
- Worker 升級至 v2.4.0，啟用 HKO 雨量雷達能力及 Radar Contract v1.0。
- 新增 64 公里／256 公里 HKO KML 雷達幀讀取、KML NetworkLink 遞迴解析、影像代理及幀邊界處理。
- 只接受 HKO 雷達 KML 可驗證影像；顯式過舊／未來時間會被拒絕，缺失時間才按6分鐘節奏補齊。
- 新增 `/probe/radar` 診斷接口。

### 雷達 UI／動畫
- 雷達影像直接疊加在現有 Leaflet 地圖，保留定點位置及預報 Bottom Sheet。
- 新增播放／暫停、雷達時間軸、最新幀、幀數、64／256公里、透明度及三段動畫速度。
- 預載最近12幀及目前幀前後影像；新幀載入成功後才替換舊 Overlay，降低閃爍。
- 即時雷達在前景期間定時檢查新幀；背景更新失敗時保留最後成功畫面。
- 手機啟用雷達自動把 Bottom Sheet 收到 peek；關閉後恢復原本高度；初次載入失敗時亦恢復面板。

### 晴天測試
- 新增 `mode=test`，由 Worker 產生12幀透明合成雷達 SVG，無降雨時仍可驗證播放、時間軸、透明度及64／256公里流程。
- 測試動畫有清楚 TEST 標示，不會被誤認為實況雷達。

### PWA／品質
- App版本更新至 v1.6.0，Service Worker快取更新至 `point-rain-pwa-v1.6.0`。
- 新增 GitHub Actions `Validate radar build`，使用 Node 22 檢查 Worker及雷達相關 JavaScript 語法。

## v1.5.3 Location Stability & Time UX

### 定位穩定性
- 一般定位及高精度定位不再各自更新地圖；完成精度比較後只採用一次最終位置。
- 定位請求加入鎖定，進行中會停用所有定位按鈕，避免重複請求互相競爭。
- 使用者手動按定位時，第一階段定位快取由最長5分鐘收緊至30秒；自動啟動仍可使用較舊快取以縮短等待。
- 手機地圖置中改為一次計算 Bottom Sheet 可視區後直接設定最終中心，避免 `setView` 後再 `panBy` 的跳動。
- 預報重新渲染及背景更新不再主動移動地圖。

### 預報時間 UX
- 時段卡取消「0–30分鐘」相對標籤，改以實際半小時區間為主，例如 `15:00–15:30`。
- 每個時段加入「進行中／已過／下一時段／其後」狀態，避免把舊預報基準誤解成由目前時間起計。
- 新增「預報有效至」資訊；第四個摘要指標由資料時差改為有效時間。
- 延遲狀態集中顯示，手機標題不再重複顯示一般延遲文字。
- 無雨時段進一步精簡，只保留時間、時段狀態及「無雨」。

### UI
- 儲存位置及分享位置按鈕改用書籤／分享圖示，避免與地圖放大 `+` 混淆。
- 附近比較圓圈降低填色及線條視覺權重，為後續雨量雷達圖層預留清晰度。
- 無雨但只有一般更新延遲時，Bottom Sheet 可保持收起；只有有雨、資料明顯過期或雨區邊界接近時才自動半開。
- Service Worker快取版本更新至 `point-rain-pwa-v1.5.3`。

## v1.5.2 UI Compression & Diagnostics

### UI／UX
- 手機頂部工具列壓縮，減少地圖被遮擋。
- Bottom Sheet展開時隱藏地圖右上狀態，避免「資料更新正常」重複出現。
- 無雨且資料正常時自動收起預報面板，保留地圖視野。
- 無雨模式壓縮重複內容，半開狀態不再顯示乾燥趨勢卡。
- 時段卡以 `0–30分鐘`、`30–60分鐘` 等相對時間為主，實際時間區間改為輔助文字。

### 診斷及穩定性
- 自動遷移舊 Worker URL，清除 `radar.maxyu0725.workers.dev` 本地設定。
- 設定頁新增 App版本、Worker版本及目前API主機。
- Service Worker快取版本更新至 `point-rain-pwa-v1.5.2`。

### 文案
- `位置變化穩定` 改名為 `附近差異小`。
- `位置較敏感` 改名為 `雨區邊界接近`。

## v1.5.0 Foundation

### 資料表達
- 資料新鮮度與位置敏感度改為兩個獨立狀態。
- 半小時預報卡改顯示完整時間區間。
- 開始降雨及最強雨勢改用半小時區間，避免過度精確。

### 定位及私隱
- 先查詢定位權限，未決定時使用應用程式內提示。
- 先快速定位，精度不足時才嘗試高精度定位。
- 定位精度圈顯示實際誤差，不再截短至1500米。
- 分享時預設使用附近地區，可另選精確座標。

### UI／UX及無障礙
- 改善小字、對比、鍵盤焦點及減少動態效果設定。
- 預報面板不再整區使用 aria-live，改用簡短狀態公告。
- 設定抽屜加入 dialog 語義、焦點圈定及焦點返回。
- 加入香港地區搜尋、官方網格範圍及應用程式內對話框。

### 穩定性及架構
- 前端拆分為 CSS及JavaScript模組。
- API請求加入12秒逾時。
- 頁面背景時暫停更新，返回前景後按資料年齡更新。
- 移除舊 Worker 完整網格前端後備，要求 Worker v2.3。
- PWA更新改為使用者確認後才套用。
- 加入 Cloudflare Pages `_headers` 安全標頭。

### 雷達準備
- `js/radar.js`獨立處理雷達契約及未來圖層。
- 雷達 API契約版本定為 v1.0。
- Worker在v1.5階段仍回報 `radarFrames: false`。
