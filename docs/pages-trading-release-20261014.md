# 交易與選股修正發布履歷（2026/10/14）

使用者確認「合併並發布」後，PR #4 已合併並成功部署正式 GitHub Pages；原工作區修改與行情資料保留，未改 Cloudflare Worker、遠端設定或權限。

- [PR #4](https://github.com/danroucao/stock-simulator/pull/4)：損益口徑、委託日期、Excel、選股抽屜及清單位置。
- 已驗證 head：`d34ac800c935d46f22359d5584ec00e5ae63053c`。
- 合併版本：`53f1437299129a52dc77f025593a65af1b5e0fce`。
- [PR CI 38518278774](https://github.com/danroucao/stock-simulator/actions/runs/38518278774)：全部成功，包含 171 項單元、來源／掃描持久化、行情稽核、建置及瀏覽器回歸。
- [Pages 38518689933](https://github.com/danroucao/stock-simulator/actions/runs/38518689933)：build 與 deploy 皆成功。

首次 CI 的瀏覽器腳本在輸入股數 0 後立即讀取未重繪文字，已改為等待指定欄位顯示結果並保留診斷截圖；修正後的 CI 成功，未放寬無效輸入驗收。

正式網址的延遲載入另揭露初次路由草稿問題：標題已切到 2353，表單仍暫時使用初始股票 2330；使用者輸入後，較晚的行情把草稿重設。補強為在進入路由時立即綁定表單股票，再沿用既有同股票草稿守衛。單元新增直接路由／延遲 feed 測試（共 172 項），瀏覽器刻意延後真實行情下載，驗證股票代號立即正確、委託價／目標價不被覆蓋及後續儲存／Excel。此補強與本文件更新屬同次授權發布的驗證收尾；實際合併、CI 與最終 Pages 結果以後續 PR／Actions 紀錄為準。

正式行情仍截至 2026/10/13，掃描時間 2026/10/13 22:13:41（台北）。公開 feed 與掃描狀態本次未修改；不以發布時間冒充新行情。19 日官方產業分類快照仍缺漏，熱度變化保持不可比較。新版定時成功紀錄尚未取得，push 驗證不算定時發布成功。

原工作區未重設，發布使用獨立 worktree。帳戶 localStorage 保持版本 1，新欄位選填且舊單不推測交易日，不需破壞性遷移。

## 延遲載入補強發布

[PR #5](https://github.com/danroucao/stock-simulator/pull/5) 已合併，版本 `dffe91613e5a3fb981f1870a1c683c6a971ce3c5`。[CI 38519736211](https://github.com/danroucao/stock-simulator/actions/runs/38519736211) 及 [Pages 38520168253](https://github.com/danroucao/stock-simulator/actions/runs/38520168253) 全部成功，單元測試共 172 項。

部署後正式網址 1280／390px 的延遲 feed、委託／Excel、選股返回及個股來源驗證通過。既有成交測試另發現：內嵌錯誤提示被合併為停損／目標欄位名稱，嚴格名稱定位因提示而變動。收尾補強固定兩個欄位的可存取名稱，提示仍由原本說明與警示呈現；交易測試保留失敗畫面診斷。本機建置、成交／備份／Excel 及桌面／手機新委託回歸通過，後續遠端驗證与部署以對應 PR／Actions 紀錄為準。
