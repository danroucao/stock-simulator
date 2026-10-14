import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AlertCenter } from '../components/alert-center/alert-center';
import { AlertSelection } from '../services/alert-store';
import { MarketStore } from '../services/market-store';
@Component({
  selector: 'app-alert-page',
  imports: [AlertCenter, RouterLink],
  styleUrl: './market-pages.scss',
  template: `<app-alert-center (openStock)="open($event)" />
    <section class="market-page intraday-events">
      <h2>盤中暫時事件</h2>
      <p>使用收盤掃描已保存的區間，對照共享 MIS 延遲快照。盤中突破或跌破仍可能在收盤前改變，不會寫入正式事件紀錄。</p>
      @if(store.intradayUsable() && store.intraday();as intraday){
        <p class="status-line">{{store.intradayFreshness()}}・涵蓋 {{intraday.coverage.valid}}／{{intraday.coverage.total}} 檔</p>
        @for(event of intraday.provisionalEvents.slice(0,20);track event.id){
          <article class="saved"><div><strong>{{event.symbol}} {{event.name}}・{{event.state}}</strong><p>{{event.reason}} 行情時間 {{event.quoteTime||'未提供'}}。</p></div><a [routerLink]="['/stock',event.symbol]" [queryParams]="{from:'alerts'}">查看個股</a></article>
        } @empty {<p>目前共享快照沒有暫時突破或跌破事件。</p>}
        @if(intraday.provisionalEvents.length>20){<p>目前先顯示 20 檔；完整盤中價格可到選股中心查看。</p>}
      } @else {<p class="notice">{{store.intradayError()||(store.intraday()?'盤中快照目前不在有效交易時段，暫時事件已停止顯示。':'正在取得盤中共享快照…')}}</p>}
    </section>
    <section class="market-page">
      <h2>我的條件事件</h2>
      <p>
        僅比較此瀏覽器兩次可用快照；首次符合名單不是新訊號，資料不足不等於離開條件。關閉網站期間沒有私人伺服器監測。首次符合事件顯示前
        20 檔，完整名單可前往選股中心套用條件；此清單保留最近 500 筆事件。
      </p>
      <a routerLink="/screener">管理選股條件</a>
      @if (store.error()) {
        <p class="notice" role="alert">{{ store.error() }}</p>
      }
      @for (event of events(); track event.id) {
        <article class="saved">
          <div>
            <strong
              >{{ event.name }} · {{ event.symbol }} {{ event.snapshot.name }} ·
              {{ event.state }}</strong
            >
            <p>{{ event.previousDate || '首次啟用' }} → {{ event.date }}（可用快照比較日期）</p>
          </div>
          <a
            [routerLink]="['/stock', event.symbol]"
            [queryParams]="{ from: 'alerts', condition: event.id }"
            >查看個股與依據</a
          >
        </article>
      } @empty {
        <p>目前沒有私人條件事件。可前往選股中心儲存並啟用追蹤。</p>
      }
    </section>`,
})
export class AlertsPage {
  readonly store = inject(MarketStore);
  private router = inject(Router);
  events = () => [...this.store.events()].reverse();
  constructor() {
    void this.store.load();
    void this.store.loadIntraday();
  }
  open(selection: AlertSelection): void {
    void this.router.navigate(['/stock', selection.stock.symbol], {
      queryParams: { from: 'alerts', event: selection.event?.id },
    });
  }
}
