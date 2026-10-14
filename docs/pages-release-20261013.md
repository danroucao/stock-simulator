# GitHub Pages 發布紀錄：2026-10-13

使用者已授權透過 PR 驗證後發布。

- 主功能 PR：[#1](https://github.com/danroucao/stock-simulator/pull/1)，遠端驗證成功後合併。
- 返回清單測試就緒等待修正：[#2](https://github.com/danroucao/stock-simulator/pull/2)，遠端驗證成功後合併。首次部署在手機測試讀取早於 Angular 綁定還原值時被攔下，未發布；修正後仍要求真實搜尋值還原，不略過條件檢查。
- 正式發布提交：`f06edc4978ab17594fd510258f8020382b68fe83`。
- [Pages 部署執行](https://github.com/danroucao/stock-simulator/actions/runs/38401944362)：建置與部署成功，GitHub 回報部署完成時間 2026-10-13 13:07:36 UTC（台北 21:07:36）。
- 正式網站：[stock-simulator](https://danroucao.github.io/stock-simulator/)。

正式發布前：144 單元測試、來源測試、離線掃描管線、真實市場資料稽核、正式建置及隔離瀏覽器的市場／交易／跨分頁檢查通過。真實官方掃描驗證 workflow 也成功，該 push 驗證沒有提交新掃描結果或另外發布。

部署後以正式網址執行 `verify-market-pages.mjs`，1280px 與 390px 皆通過：hash 直接連結、重整、返回與搜尋保留、20 檔分頁、私人條件與首次基準、備份下載／預覽／匯入前備份／還原、產業銜接、個股圖表、快速 hash 切換、離線快取與手機導覽。測試使用隔離瀏覽器儲存，不影響使用者原有帳戶，也未提交模擬交易。首頁與市場 JSON 確認 HTTP 200。

目前行情日仍為 2026-10-12，市場 1978 檔，完整 824、部分 1138、無可用分析 16。遠端原有 94 筆事件全部保留且內容一致。歷史產業比較仍缺足夠可核對快照，可靠還原行情限制仍在；不宣稱更新至今日或完成熱度增減比較。

發布使用 `tmp/pages-release-20261013` 獨立 Git worktree。原工作區與尚未提交的 Cloudflare Worker／FinMind 探測變更保留，未部署 Worker、未修改遠端權限或秘密。本紀錄保存在原工作區，不為更新紀錄再次觸發正式部署。
