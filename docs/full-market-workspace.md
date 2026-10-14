# 全市場分析與分頁工作區交付

此功能已於 2026/10/13 經 PR #1／#2 發布；市場 UX 修正另經 PR #3 發布。詳見 pages-release-20261013.md 與 pages-market-ux-release-20261013.md。後續本機修改不代表已發布。

## 操作與路由

採 Angular hash routing，Pages base path 為 `/stock-simulator/`。入口為 `#/overview`、`#/market`、`#/screener`、`#/alerts`、`#/stock/2330`、`#/trades`、`#/settings`。市場、選股、提醒及財務工作區延遲載入；原財務控制器在四個財務頁面共用，畫面只建立相關區塊。Excel 僅在匯出時載入。

市場動向點選官方產業 → 選股中心帶入產業 → AND 篩選、排序、每次 20 檔 → 個股圖與依據 → 追蹤或規劃模擬交易。返回時保留清單條件、筆數與捲動位置。手機使用可展開導覽。原提醒、走勢、持倉、風險與設定錨點提供相容導向。

## 真實資料與計算

目前本機成功結果行情日為 **2026-10-12**，掃描時間另外顯示為台北時間，不稱為已更新至查看當日。1978 檔普通股逐一處理，完整可分析 824、部分可分析 1138、無可用分析 16，三類互斥。完整指九個歷史指標皆可計算：區間寬度、價格趨勢、SMA5、SMA60、偏離率、SMA60 十日變化、波動率、45 日平均成交金額及無成交日數。保存區間、是否盤整及即時行情不是這個完整性分類的判定條件。

現有官方原始日線模式沿用六種公司行動檢查，不以取消排除扩大分析數量。每個指標依自己的歷史需求判定，缺漏或價格基準問題使用 null 與原因。成交金額與流動性可獨立使用；低流動性不停止全市場技術分析。原提醒策略仍保留其流動性門檻。價格觀察暫停時清除失效的活動區間及偏離狀態，歷史事件快照保持不變；恢復後建立新基準，不宣稱首次恢復就是新突破。

45 日趨勢為收盤線性迴歸斜率 × 44／45 日平均收盤價；波動為近 20 個簡單日報酬的樣本標準差 × 100，未年化。均線與盤整門檻仍集中管理且待回測。漲跌判定優先使用官方漲跌或參考價，避免公司行動日直接相減誤判。原 88 筆事件依據保留，10/12 新增 6 筆；重跑不重複建立。

產業取自 [上市公司基本資料](https://openapi.twse.com.tw/v1/opendata/t187ap03_L) 與 [上櫃公司基本資料](https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O)，未知分類列未分類。普通股清單排除 ETF、權證、興櫃與 TDR；舊清單四檔 TDR 不再混入。當日有效成交金額上市 1083、上櫃 887，合計 1970 檔，8 檔缺漏會顯示涵蓋率。34 產業的金額加總為 1,044,167,678,419 元；統計不受技術指標不可用影響。

**目前 34 產業的歷史比較皆不可比較。** 尚未累積可核對的前 20 交易日分類快照與完整可比較覆蓋，近期平均與變化顯示不可比較，不以今日分類回填未知歷史，也不當成熱度下降。已實作在覆蓋及分類可比較時，計算排除當日的每日占比平均及百分點差異。成交熱度不代表資金淨流入或投資推薦。

本輪未重測 FinMind 帳號權限；先前調整行情權限不足的限制仍保留，有可靠還原資料才能恢復受影響價格指標。

## 儲存、相容與更新

市場 feed 使用 schema 2，位於 `public/market/latest.json`；逐日快照於 `public/market/snapshots/`。原提醒 feed 保持相容，透過 `historyDelivery: symbol` 分檔讀取 `public/alerts/history/{symbol}.json`，不因查看一檔下載全市場走勢。掃描狀態 schema 2 新增獨立分析狀態，舊無版本狀態可讀取；未知未來版本拒絕覆寫。

既有帳戶、部位、成本、自選及追蹤 localStorage 不刪除。新市場快取優先使用 IndexedDB，下載失敗保留成功日期及資料。私人條件與事件以單一 localStorage key 原子保存；另有條件備份、匯入預覽及匯入前備份，原帳戶備份格式不變。

私人事件僅在開啟網站取得另一個可用日期時比較。首次為符合基準，新符合、離開、資料不足分開；未知不直接當成離開，相同或較舊行情不新增。跨日期只說兩次可用快照間變化，不推測缺失日期。首次名單事件最多展示 20 筆，全部狀態仍保存；事件歷史最多保存 500 筆，介面說明限制。瀏覽器關閉期間沒有私人條件後端監測。

未新增依賴或必要密鑰。現有官方來源排程不需要 FinMind token，原 `TPEX_PROXY_URL` 設定沿用。發布時需將掃描器、shared analytics、workflow、前端、市場 feed、提醒分檔與狀態一起帶入。現有排程仍由 repository variable `MARKET_SCAN_PUBLISH_ENABLED=true` 控制；本輪未讀寫其遠端值。成功掃描才一起保存全套結果；失敗只保存錯誤狀態與原成功結果，不發布半套歷史。

## 核心檔案

- `src/app/shell.ts`、`app.routes.ts`、`app.config.ts`：導覽、hash 路由與延遲載入。
- `src/app/pages/`：市場、選股、私人提醒與頁面操作。
- `src/app/services/market-analysis.ts`、`screening.ts`：前後端共用獨立指標、產業統計、AND 篩選及事件比較。
- `market-store.ts`、`browser-market-cache.ts`：真實 feed、快取、私人條件、備份與錯誤保留。
- `app.ts`、`app.html`、`alert-store.ts`：既有交易整合、分檔圖表、來源快照及非同步保護。
- `scripts/scan-market.mjs`、`official-market-data.mjs`、`.github/workflows/scan-market.yml`：全市場資料與持久化。

## 驗證

`npm test -- --watch=false`：144 測試通過。官方資料來源與 delivery Node tests：9 通過。`verify-official-scan.mjs`、`verify-scan-pipeline.mjs` 通過，包含快取、快照、重跑去重及錯誤保留。`audit-full-market.mjs` 以真實分檔資料獨立核對 3956 次 SMA 計算、全市場涵蓋與產業加總，並檢查原事件保存。

正式 base path 建置成功；仍有既有 app.scss 超過樣式預算 210 bytes 與 ExcelJS CommonJS 警告。初始程式約 128.97 kB，未將此當作 Core Web Vitals 驗收。

瀏覽器驗證腳本為 `verify-market-pages.mjs`（1280/390px、hash 直連、重整、返回、條件保存、分頁、產業銜接、圖表、手機導覽、離線快取與舊錨點）、`verify-trading-flow.mjs`（明確隔離測試行情，部分成交、現金、備份還原、部分平倉、Excel 實際下載）及 `verify-storage-tabs.mjs`（跨分頁覆寫保護）。測試資料只存在隔離環境，不寫入公開市場結果。

後續補驗：正式建置在 1280/390px 均通過私人條件實際下載、匯入預覽不覆寫、確認匯入前備份、重整後条件與事件保存，以及快速改變個股 hash 後網址與最後選擇一致。此快速切換測試不等同模擬所有網路回應亂序；既有非同步保護另由單元測試驗證。未使用或修改使用者真實瀏覽器資料。

## CI 與發布前檢查

新增 `validate-workspace.yml`，供 pull request 或手動驗證，只要求 contents:read，不掃描真實外部市場、不提交結果、不部署。執行單元測試、資料來源及離線管線檢查、公開市場資料稽核、Pages base path 建置與隔離瀏覽器回歸，保存稽核及截圖供檢查。

現有 Pages workflow 在上傳 artifact 前增加市場資料稽核、Chromium 安裝與正式建置瀏覽器檢查；失败時不進入部署。沿用原觸發方式及權限，沒有在本輪觸發任何遠端流程。

本機執行 `npm run build -- --base-href /stock-simulator/` 後可用 `npm run verify:pages-build` 啟動短暫本機伺服器，驗證市場頁面、交易與跨分頁流程；測試完成自動關閉伺服器。`npm run verify:market-data` 不需密鑰，核對已保存的結果；可用 `MARKET_AUDIT_BASELINE` 指定舊提醒檔案比較歷史快照，未提供基準時不宣稱已驗證歷史事件保留。

本機共用驗證指令已通過，GitHub runner 的實際執行仍需提交後觀察，未將本機結果描述為遠端 CI 成功。發布前應先提交完整 feed、分檔歷史與狀態，觀察驗證成功，再在已授權的發布範圍內操作。推送 main/master 仍會依既有設定啟動 Pages 部署；此段記錄實作階段；後續已於 2026/10/13 授權發布，詳見發布紀錄。
