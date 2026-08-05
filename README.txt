香港定點雨量預報 v1.3 PWA
============================

檔案
----
index.html                 前端（Storm Track Metro 介面＋PWA）
worker.js                  Cloudflare Worker v2.2（功能不變）
manifest.webmanifest       PWA 設定；以 fullscreen 模式啟動
service-worker.js          應用程式介面及靜態資源快取
offline.html               離線後備頁面
icons/                     PWA 及主畫面圖示

部署
----
1. 將整個資料夾內容部署到 Cloudflare Pages 網站根目錄；不可只上載 index.html。
2. 在 Cloudflare Worker 貼上 worker.js 並部署。
3. 第一次以 HTTPS 開啟後，瀏覽器會註冊 Service Worker。
4. Android／Edge／Chrome 可使用設定側欄的「安裝到裝置」或瀏覽器安裝選項。
5. iPhone／iPad 請在 Safari 分享選單選擇「加至主畫面」。

v1.3 改動
----------
- 加入可安裝 PWA、Manifest、Service Worker、離線介面快取及主畫面圖示。
- Manifest 使用 fullscreen，支援的平台會隱藏瀏覽器工具列及系統狀態列。
- iOS 使用 black-translucent 狀態列樣式；iOS 是否完全隱藏系統狀態列由系統版本控制。
- 隱藏頁面頂部的即時狀態副標題；資料狀況仍保留在預報卡及 HKO／POINT／LOC／RADAR 徽章。
- 移除舊版不存在的 header-status DOM 寫入，避免更新預報時發生 JavaScript 錯誤。

注意
----
PWA、Service Worker、定位及全螢幕功能都需要 HTTPS。Cloudflare Pages 已符合要求。
最新雨量預報和線上地圖仍需要網絡；離線模式主要保留應用程式介面。
