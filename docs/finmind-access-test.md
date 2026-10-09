# FinMind 單檔還原行情權限實測

測試時間：2026-10-10 02:30（Asia/Taipei）。

[GitHub Actions 實測紀錄](https://github.com/danroucao/stock-simulator/actions/runs/37973794934)

使用 repository secret `FINMIND_API_TOKEN`，在獨立分支 `codex/finmind-single-stock-probe` 執行。正式 main、網站部署、既有掃描結果皆未改動。只發出 6 次請求，不上傳行情資料或輸出 token。

## 結果

| 股票／範圍 | 資料集 | HTTP／API 狀態 | 資料筆數 | 結論 |
|---|---|---|---:|---|
| 交易日曆 | TaiwanStockTradingDate | 200／200 | 未公布完整日曆筆數 | 可讀取，最新已完成交易日為 2026-10-08 |
| 2330（上市） | TaiwanStockPrice | 200／200 | 152 | 可讀取原始日線 |
| 2330（上市） | TaiwanStockPriceAdj | 400／400 | 0 | 單檔還原行情無權存取 |
| 6182（上櫃） | TaiwanStockPrice | 200／200 | 152 | 可讀取原始日線 |
| 6182（上櫃） | TaiwanStockPriceAdj | 400／400 | 0 | 單檔還原行情無權存取 |
| 不指定股票（對照組） | TaiwanStockPriceAdj | 400／400 | 無回傳 | 整批還原行情無權存取 |

還原行情的 API 診斷：`Your level is register. Please update your user level.`。

**此 token 加上 data_id 逐檔查詢仍無法取得還原行情。** 不能使用本次原始日線假裝已完成價格調整，也不能據此發布可靠的突破／跌破或均線偏離事件。

兩檔還原資料皆未取得，因此未能驗證真實還原因子、還原 OHLC 一致性或原始／還原日線的近 70 個交易日配對完整性。這不是配對筆數為零就代表資料正確。

工作流程的 success 表示權限診斷程式成功完成，不表示行情權限通過；測試結果的 `singleStockUsable` 為 false，報告顯示單檔還原行情未通過。

## 測試程式與本機驗證

- `scripts/probe-finmind-access.mjs`：最多 6 次請求、20 秒單次逾時，檢查股票代號、日期、重複列、OHLCV 欄位、近 70 日完整性、原始／還原 OHLC 因子與真實量值。只輸出彙總與遮蔽後診斷。
- `.github/workflows/probe-finmind.yml`：只在獨立測試分支的指定檔案變更時執行，無定時排程，權限僅 contents:read，不 commit 市場結果或 dispatch Pages。
- `node --test scripts/probe-finmind-access.test.mjs`：5 項通過，包含單檔允許但整批拒絕、全部還原拒絕、缺密鑰不發請求、日期／OHLCV 異常、價格調整因子及成交量一致性、token 不出現在報告。

## 可行後續方向

1. 更換具有還原行情權限的 token，再以同一程式重測。
2. 若維持免費方案，評估 TWSE／TPEx 官方原始日線，加上完整的除權息、減資、分割及面額變更資訊，自行建立調整因子與歷史快取。取得／驗證調整資訊之前，不能宣稱有完整還原行情。
3. 保守版本可在公司行動資訊完整的前提下，排除觀察區間內受影響或調整不明的股票，清楚標示排除原因與涵蓋數。這會改變掃描範圍，需另行實作與驗證。
