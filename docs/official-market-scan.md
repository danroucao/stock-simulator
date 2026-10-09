# 免費官方市場掃描

## 已完成的實測

2026-10-10（Asia/Taipei）完成 TWSE／TPEx 官方資料的真實全市場掃描，完全不使用 FinMind 還原行情或會員密鑰。

- 行情截至交易日：2026-10-08。
- 掃描名冊：1,982 檔上市、上櫃普通股。ETF、權證、興櫃不納入。
- 通過資料、價格基準與流動性檢查：422 檔。
- 初次建立觀察事件：88 檔，包括整理觀察 52 檔、均線偏離 36 檔。
- 排除：1,560 檔；其中 927 檔近 70 日有公司行動或價格基準異動，200 檔有未公告完整价格，381 檔低於流動性門檻，其他為停牌／缺漏／歷史不足／行情異常；另有 2 檔不在本次歷史行情表中。
- 重跑沿用 196 個市場／日期快取，只需 19 次公開 API 請求，新增事件為 0。保留已有 88 個事件、事件日期及區間快照。
- 桌面 1280px、手機 390px 使用真實資料驗證來源標示、88 檔合併清單、搜尋、追蹤重載、原始價格基準圖表與區間快照通過。

初次安裝只建立目前條件的觀察快照，不回填歷史突破。第二個交易日起才能對照已保存的昨日區間，建立突破／跌破事件。

## 價格基準與排除政策

這是「官方原始日線＋公司行動排除」模式，**不宣稱已建立完整還原行情**。

原始 OHLC、實際成交股數及成交金額直接來自官方整日行情。最近 70 個實際交易日若有除權息、減資、股票面額變更／分割，或行情顯示未確認價格基準異動，該股票暫停產生整理、突破、跌破與均線偏離事件。所有類別採相同安全視窗，避免跨價格基準比較。

排除原因保留在股票結果中；原區間快照仍保留，但不以已排除資料觸發事件。公司行動離開 70 日視窗後，舊區間已超過 60 日有效期，先失效，再等待 5 日重新辨識，不沿用變更前價格。價格未公告或沒有成交的日線也不補造價格。

每日價格漲跌欄位與前一日收盤不一致、漲跌特殊註記，或單日價格變動超過 11.5% 時，額外保守排除為「未確認價格基準異動」。這是資料安全檢查，不是公司行動類型推測或投資評分。

免費版排除較多股票。若希望對近期除權息等股票繼續掃描，需要另行實作並驗證完整調整因子，或使用具還原行情權限的資料來源。

## 官方資料來源

- 公司名冊：[TWSE OpenAPI](https://openapi.twse.com.tw/)、[TPEx OpenAPI](https://www.tpex.org.tw/openapi/) 的 `t187ap03_L`／`mopsfin_t187ap03_O`。只取官方公司名冊中的四位普通股代號。
- 上市整日行情：`/rwd/zh/afterTrading/MI_INDEX?date=YYYYMMDD&type=ALLBUT0999&response=json`。
- 上櫃整日行情：`/www/zh-tw/afterTrading/dailyQuotes?date=YYYY/MM/DD&id=&response=json`。依「成交股數」欄位判斷為股，不把「買／賣量(張數)」誤用成成交量。
- 實際歷史交易日：TWSE `/rwd/zh/afterTrading/FMTQIK` 的每月市場成交資訊；另取年度開休市表，用於估計行情是否延遲。實测 2026-07-10 未列於歷史成交統計，未當成交易日納入。
- 上市公司行動：[除權息結果](https://www.twse.com.tw/zh/announcement/ex-right/twt49u.html)、[減資恢復買賣參考價](https://www.twse.com.tw/zh/announcement/reduction/twtauu.html)、[面額變更恢復買賣參考價](https://www.twse.com.tw/zh/announcement/change/twtb8u.html)。實際 API 為 `exRight/TWT49U`、`reducation/TWTAUU`（官方路徑拼字）、`change/TWTB8U`。
- 上櫃公司行動：[除權息結果](https://www.tpex.org.tw/zh-tw/announce/market/ex/cal.html)、[減資恢復交易參考價](https://www.tpex.org.tw/zh-tw/announce/market/reduction/reference.html)、[面額變更恢復交易參考價](https://www.tpex.org.tw/zh-tw/announce/market/change/reference.html)。API 為 `bulletin/exDailyQ`、`bulletin/revivt`、`bulletin/pvChgRslt`。

六項公司行動查詢都要求回應期間與查詢一致，並核對筆數沒有分頁或截斷。任一必要来源失敗就停止整次掃描，保留上次成功結果，不將資料缺失視為「沒有公司行動」。

## 執行與排程

`npm run scan:market` 預設使用免費官方資料，不需要 FINMIND_API_TOKEN。選擇 `MARKET_DATA_PROVIDER=finmind` 才使用原有會員方案，仍需對應還原行情權限。

官方日線快取保存在被 Git 忽略的 `scan-data/official/`，每個市場／日期一檔；快取附來源 schema、日期與市場，讀取時驗證。最新兩個交易日每次重新取得，以接收盤後修正；較舊原始日線沿用快取。公司行動與月成交統計每次刷新。每次至少间隔 1 秒、單次逾時 20 秒、最多重試 2 次，340 次總預算。429／403 立即停止；暫時非 JSON 回應延後重試，持續失敗就保留舊結果。

首次回補約 215 次公開請求，可能需數分鐘。正常每日更新約 19 次。官方歷史修正若發生在超過最近兩日的價格，需維護者清除相應市場／日期快取再重跑；不會默默重新產生已保存的歷史事件。

GitHub Actions 使用 cache restore／save 保存官方原始行情；失敗掃描已驗證完成的下載也可保留快取。Cache 可能失效或被平台淘汰，屆時自動重新回補。快取不是掃描狀態的唯一保存位置：`scan-data/state.json` 與公開結果必須在同一成功 commit 持久化。

現有排程在台北時間週一至五 19:20 執行。`MARKET_SCAN_PUBLISH_ENABLED=true` 才發布每日結果；未設時跳過定時工作。手動 `publish=false` 驗證不寫回結果；`publish=true` 才寫回並 dispatch Pages。GitHub 排程、官方資料及 Pages 發布都可能延遲，畫面始終保留實際行情日與成功掃描時間。

UI 顯示實際檢查與排除數，符合條件股票的詳情圖保留最近 70 日，與規則及區間使用相同原始價格基準。被排除股票不提供有誤判風險的觀察曲線，仍可接到既有個股行情頁；歷史事件快照保留。

規則版本為 `tw-daily-v2-official-safe`。已有其他價格基準的成功掃描狀態不可直接混接；必須先備份、明确重建狀態，避免不同來源的歷史依據混用。本專案原先尚未產生成功市場結果，因此本次從官方版獨立初始化。

## 驗證指令

- `npm run build`。
- `npm test -- --watch=false`：包含公司行動排除 70 日、凍結區間、恢復後失效／重新辨識、未公告價格無事件，以及官方交易日曆支援。
- `npm run verify:official`：官方 schema、ROC 日期、成交量單位、日期範圍、完整公司行動、歷史實際開市日、快取；隔離執行真正掃描程式，驗證無密鑰、1,001 檔名冊、事件去重、特殊價格排除與失敗保留。
- 原 FinMind pipeline 測試使用明確的 `MARKET_DATA_PROVIDER=finmind`，不混用官方模式。

原始結果資料及來源授權需依官方使用條款管理。免費 API 不是具 SLA 的商業資料服務；近期公司行動股票的排除率與官方來源可用性，是此版本的主要限制。
