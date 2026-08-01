# Stock Trading Simulator

以 Angular 22 建立的台股交易與持倉模擬器，支援真實歷史報價、K 線、座標式下單、長短線試算，以及逐筆持倉盈虧管理。

## 開發指令

```powershell
npm.cmd start
npm.cmd run build
npm.cmd test -- --watch=false
```

開發伺服器預設位於 `http://localhost:4200/`。

開發伺服器會透過 `proxy.conf.json` 將 `/api/tpex` 轉送到 TPEx，避免瀏覽器 CORS 阻擋。正式部署時，Web Server 也必須提供相同的反向代理路徑。

## 專案架構

```text
src/app/
├─ components/
│  └─ position-details/          # 持倉展開、筆記、目標價與逐筆盈虧 UI
├─ models/
│  └─ trade-position.model.ts    # 交易方向、持倉與事件資料型別
├─ services/
│  ├─ portfolio-calculator.service.ts       # 純持倉計算與股票分組
│  └─ portfolio-calculator.service.spec.ts  # 計算服務測試
├─ app.ts                        # 頁面狀態與功能協調
├─ app.html                      # 主儀表板版面
├─ app.scss                      # 主儀表板樣式
├─ app.spec.ts                   # 頁面整合測試
├─ app.config.ts                 # HttpClient、Router 與全域 Provider
├─ app.routes.ts                 # 路由定義
└─ stock-price.service.ts        # TWSE 報價與歷史資料存取
```

## 分層職責

- `components`：呈現 UI、管理局部展開狀態，透過 input/output 與上層溝通。
- `models`：集中共用 TypeScript 型別，避免元件間重複宣告。
- `services`：封裝外部資料存取與可獨立測試的商業計算。
- `App`：保存頁面層 Signals，協調報價、圖表、下單與持倉資料。

## 資料流

```text
TWSE API → StockPriceService → App Signals → 圖表／模擬畫面
                                      ↓
                             PositionDetails
                                      ↓ output
                              App 更新持倉 Signal

TradePosition[] → PortfolioCalculatorService → 分組／成本／市值／盈虧
```

## 主要功能

- 依股票代號與日期取得 TWSE 上市或 TPEx 上櫃股票資料，查無上市資料時自動切換市場
- 可新增、切換與移除多檔股票記錄，每檔保存自己的最新報價
- 5、20、60 日歷史資料與 K 線／成交量圖
- 全寬價格圖表、價格網格、日期刻度與獨立成交量視圖
- 歷史資料跨月份合併並固定由左至右顯示舊到新，K 線採台股紅漲綠跌慣例
- 現股多單、空單、融資、融券模擬
- 座標式持倉建立、拖曳與編輯
- 將短線模擬直接建立為 1～30 天近期預設單
- 在座標圖同時呈現已成交持倉與待觸發預設單
- 座標圖以時間為 X 軸、進場價格為 Y 軸；垂直拖曳持倉標記可調整進場價格
- 新增或編輯已入倉股票時可指定實際入倉日期
- 下單列可切換「已入倉／近期預設單」；只有預設單需要預測出場價
- 座標圖左側集中既有持倉，右側時間軸僅用於近期預設單，並以紅色表示做多、綠色表示做空
- 歷史圖表、策略下單板、短線模擬與長線布局可分別收合
- 比較多單、空單、融資與融券情境並排序預期淨利
- 從最佳化建議一鍵建立進場／停利策略
- 依股票展開逐筆持倉
- 直接編輯持倉筆記與目標價
- 計算投入成本、目前市值、實際盈虧與報酬率

已成交持倉的市值與未實現盈虧一律以最新股價估值；目標價只呈現目標空間，不參與目前盈虧計算。短線選定價格僅供預設單與情境試算使用。

多檔持倉會依股票代號各自尋找最新價格，不會共用目前畫面所選股票的報價。

> 近期策略最佳化是依使用者設定的漲跌價格區間進行情境比較，不是價格預測，也不保證成交或獲利。

## 後續擴充原則

新增獨立畫面區塊時，優先建立於 `components/`；共用資料結構放入 `models/`；不依賴畫面的計算或 API 存取放入 `services/`。只有跨區塊的頁面狀態保留在 `App`。
