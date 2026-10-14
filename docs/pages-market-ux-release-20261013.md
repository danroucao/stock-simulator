# 市場與選股 UX 正式發布紀錄

使用者授權發布後，以獨立工作區 `tmp/market-ux-release-20261013` 從遠端 main 建立發布分支，未覆蓋原工作區修改。未包含本機 Cloudflare Worker 或 FinMind 探測修改。

- PR：https://github.com/danroucao/stock-simulator/pull/3
- 發布分支提交：`cbc17a22ae5d399a217a1f8f8346a698bf206c7a`
- 合併提交：`f886bd3f7e63b6c06f2fd1ccc52f8037bf16f9c2`
- PR CI：https://github.com/danroucao/stock-simulator/actions/runs/38416678883，成功。
- Pages：https://github.com/danroucao/stock-simulator/actions/runs/38417104586，build 與 deploy 皆成功。
- 掃描驗證：https://github.com/danroucao/stock-simulator/actions/runs/38417104589，成功；push 事件依既有規則跳過資料提交。

本機獨立工作區與遠端 CI 均完成 154 項單元測試、9 項來源／交付測試、離線掃描持久化測試、真實行情核對、正式建置與瀏覽器驗證。核對 94 筆舊事件快照完整保留，新增 16 筆事件。既有樣式預算與 Excel CommonJS 建置警告仍存在。

部署後在 `https://danroucao.github.io/stock-simulator/` 執行 `verify-market-pages.mjs` 與 `verify-ux-revision.mjs`，1280px 與 390px 全部通過。包含直接連結、重整、返回與前進、清單狀態、儲存條件、產業銜接、快速篩選保留市場與產業、重設全部、缺漏原因、前十大產業／搜尋、個股頁籤與明確事件來源。測試使用隔離瀏覽器儲存空間。

正式行情為 2026-10-13，成功掃描時間 2026-10-13 22:13:41（台北）。已檢查 1978 檔，完整 845、部分 1118、無可用分析 15；有效成交金額涵蓋上市 1083、上櫃 887 檔。產業歷史比較缺少 19 個官方分類快照，保持不可比較、顯示具體缺漏日期並停用熱度變化排序；未推測或補造數據。

排程設定為台北時間週一至週五 19:20、20:20、21:20，沿用既有發布開關與執行序列。實際執行時間仍由 GitHub Actions 決定；此次未驗證未來排程的準時執行，也未修改遠端秘密、權限或設定變數。

Git 推送最初未選定既有帳號而停在憑證提示；指定 `danroucao` 的既有憑證後成功，未新增憑證或要求重新登入。
