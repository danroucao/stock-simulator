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
  }
  open(selection: AlertSelection): void {
    void this.router.navigate(['/stock', selection.stock.symbol], {
      queryParams: { from: 'alerts', event: selection.event?.id },
    });
  }
}
