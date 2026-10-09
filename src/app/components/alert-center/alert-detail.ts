import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AlertSelection, AlertStore } from '../../services/alert-store';

@Component({selector:'app-alert-detail',imports:[DecimalPipe],styleUrl:'./alert-center.scss',template:`
  <section class="alert-center" aria-labelledby="alert-detail-title">
    <header><div><span class="eyebrow">提醒來源 · {{ selection().event?.date || selection().stock.eventDate }}</span><h2 id="alert-detail-title">{{ selection().stock.symbol }} {{ selection().stock.name }} · {{ selection().event?.status || selection().stock.status }}</h2><p>{{ selection().event?.reason || selection().stock.reason }}</p></div><button type="button" [attr.aria-pressed]="store.following(selection().stock.symbol)" (click)="store.toggle(selection().stock)">{{ store.following(selection().stock.symbol) ? '★ 取消追蹤' : '☆ 加入追蹤' }}</button></header>
    @if (store.storageError()) { <p class="notice" role="alert">{{ store.storageError() }}</p> }
    <p>最新狀態：{{ selection().stock.status }} · 收盤 {{ selection().stock.close > 0 ? (selection().stock.close | number:'1.0-2') + ' 元' : '未公告有效價格' }} · 行情 {{ selection().stock.date }}</p>
    @if (snapshot()) { <p>觸發依據快照：{{ snapshot()!.lower | number:'1.0-2' }}～{{ snapshot()!.upper | number:'1.0-2' }} 元，辨識於 {{ snapshot()!.date }}。原始快照保留；圖上區間換算至最新行情的價格基準。</p> }
    @if (historyLoading()) { <p role="status">正在載入 {{ selection().stock.name }} 走勢…</p> }
    @if (historyError()) { <p class="notice" role="alert">{{ historyError() }} <button type="button" (click)="retryHistory.update(next)">重新讀取走勢</button></p> }
    <p class="note">走勢與提醒區間合併於下方行情圖，可切換「顯示提醒區間」。歷史依據仍保留原始快照。</p>
    @if (selection().stock.eligible) { <div class="update-grid"><div><span>均線偏離</span><strong>近 5 日均價比近 60 日{{ selection().stock.deviation < 0 ? '低' : '高' }} {{ abs(selection().stock.deviation) | number:'1.1-1' }}%</strong></div><div><span>中期趨勢</span><strong>{{ selection().stock.smaDirection }}</strong></div><div><span>最新成交量／前 20 日均量</span><strong>{{ selection().stock.volumeRatio | number:'1.2-2' }} 倍</strong></div></div> } @else { <p class="notice">{{ selection().stock.exclusion }}；目前無有效指標，先核對行情再建立模擬交易。</p> }
    @if (selection().event?.volumeRatio !== undefined) { <p>觸發當日量比：{{ selection().event!.volumeRatio | number:'1.2-2' }} 倍。{{ selection().event!.volumeRatio! >= 1.5 ? '達初始量能觀察門檻，仍不保證突破成功。' : '未達初始 1.5 倍量能觀察門檻。' }}</p> }
    <details class="rules"><summary>進階：公式與區間版本</summary>@if (selection().stock.eligible) { <p>SMA5 {{ selection().stock.sma5 | number:'1.2-2' }} 元；SMA60 {{ selection().stock.sma60 | number:'1.2-2' }} 元。R = SMA5／SMA60 = {{ selection().stock.ratio | number:'1.3-3' }}；偏離率 = (R−1) × 100%。SMA60 方向相對 10 個交易日前計算。</p> } @else { <p>本次資料已排除，不顯示無效的均線數值。公式為 R = SMA5／SMA60；偏離率 = (R−1) × 100%。</p> }<p>區間版本 {{ snapshot()?.version || store.feed()?.rules?.version }}。偏離僅是均價差異，不是估值、買賣建議或投資評分。</p></details>
    <div class="actions"><button type="button" (click)="simulate.emit()">建立模擬交易</button><button type="button" (click)="back.emit()">返回提醒中心</button></div><p class="note">只帶入股票及提醒來源；價格、數量、停損請在既有表單自行確認，再建立模擬記錄。</p>
  </section>
`})
export class AlertDetail {
  readonly historyReady=output<{symbol:string; bars:import('../../services/market-alerts').DailyBar[]}>();
  readonly selection = input.required<AlertSelection>();
  readonly simulate = output<void>(); readonly back = output<void>();
  readonly store = inject(AlertStore);
  readonly abs = Math.abs;
  readonly official = computed(()=>this.store.feed()?.priceBasis==='raw-action-screened');
  readonly historyLoading=signal(false);
  readonly historyError=signal('');
  readonly retryHistory=signal(0);
  readonly next=(value:number)=>value+1;
  constructor() {
    effect(onCleanup=>{
      this.retryHistory();const stock=this.selection().stock;
      this.historyError.set('');
      if(stock.history.length || !stock.eligible){this.historyLoading.set(false);this.historyReady.emit({symbol:stock.symbol,bars:stock.history});return;}
      let active=true;onCleanup(()=>active=false);this.historyLoading.set(true);
      this.store.loadHistory(stock).then(history=>{if(active)this.historyReady.emit({symbol:stock.symbol,bars:history});})
        .catch(error=>{if(active)this.historyError.set(error instanceof Error && !['AbortError','TimeoutError','TypeError','SyntaxError'].includes(error.name) ? error.message : '走勢下載逾時、連線或格式異常，請稍後重新讀取。');})
        .finally(()=>{if(active)this.historyLoading.set(false);});
    });
  }
  readonly snapshot = computed(()=>this.selection().event?.range || this.selection().stock.range);
}
