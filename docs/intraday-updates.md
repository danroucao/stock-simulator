# 盤中延遲快照

本功能把三種更新分開：

- 個股頁：使用者啟用後每 30 秒讀取單檔 MIS 快照。只在台北交易日 09:00～13:35、頁面可見且查詢日期為今天時執行；失敗採 60～240 秒退避。
- 我的追蹤：提醒中心一次批次讀取最多 50 檔，每 60 秒更新。名單仍只存在瀏覽器，關閉網站後不會替個人條件持續監測。
- 全市場：Cloudflare Cron 在週一至五 UTC 01:00～05:55 每五分鐘觸發，程式再以台北 09:00～13:35 判斷是否執行。Worker 集中讀取全市場，通過當日日期與至少 50% 涵蓋檢查後才寫入共享 KV。

全市場暫時事件只比較盤中成交價和收盤掃描已保存的區間上下緣，不用盤中高低價重算區間。事件標示「待收盤確認」，不寫入正式收盤事件與歷史快照。

## 部署需求

worker/wrangler.jsonc 新增 INTRADAY KV、自動排程及 observability。專案使用的 Wrangler 4.148 支援部署時自動建立未指定 ID 的 KV；首次部署 Worker 時會建立並綁定資源。正式部署前仍應確認 Cloudflare 帳戶方案、MIS 使用及再發布條款、實際請求涵蓋與排程執行時間。

部署順序：

1. 執行 npm run worker:test 與 npm run worker:check。
2. 經正式環境授權後，執行 npx wrangler deploy --config worker/wrangler.jsonc；此步會建立／綁定 KV 並更新 Cron Trigger。
3. 確認既有 FINMIND_API_TOKEN secret 仍存在。
4. 確認 GitHub repository variable TPEX_PROXY_URL 指向此 Worker。
5. 再建置及發布 GitHub Pages。

GitHub Pages 若先發布而 Worker 尚未更新，收盤功能仍可用；盤中共享快照會明確顯示未設定或尚未產生。
