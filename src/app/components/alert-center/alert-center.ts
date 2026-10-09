import { Component, computed, inject, OnInit, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AlertStore, AlertSelection, alertFreshness } from '../../services/alert-store';
import { AlertKind, AlertStock } from '../../services/market-alerts';

@Component({selector:'app-alert-center',imports:[DecimalPipe],templateUrl:'./alert-center.html',styleUrl:'./alert-center.scss'})
export class AlertCenter implements OnInit {
  readonly Math = Math;
  readonly store = inject(AlertStore);
  readonly openStock = output<AlertSelection>();
  readonly tab = signal<'new'|'current'|'follows'>('new');
  readonly category = signal<AlertKind | '全部'>('全部');
  readonly search = signal(''); readonly market = signal('all');
  readonly minTurnover = signal(0); readonly sort = signal('event');
  readonly categories: Array<AlertKind|'全部'> = ['全部','整理觀察','突破提醒','跌破提醒','均線偏離'];
  readonly checkedAt = signal(new Date());
  readonly stale = computed(()=>alertFreshness(this.store.feed(),this.checkedAt()));
  readonly newCount = computed(()=>new Set(this.store.feed()?.events.filter(e=>e.date===this.store.feed()?.marketDate).map(e=>e.symbol)).size);
  readonly missingFollows = computed(()=>this.store.follows().filter(s=>!this.store.feed()?.stocks.some(r=>r.symbol===s.symbol)));
  readonly rows = computed(()=>{
    const feed = this.store.feed(); if (!feed) return [];
    const query = this.search().trim().toLowerCase();
    return feed.stocks.filter(s=>{
      const events = feed.events.filter(e=>e.symbol===s.symbol && e.date===feed.marketDate);
      const tabMatch = this.tab()==='new' ? events.length > 0 : this.tab()==='current' ? s.eligible && s.kinds.length > 0 : this.store.following(s.symbol);
      const categoryMatch = this.category()==='全部' || (this.tab()==='new' ? events.some(e=>e.kind===this.category()) : s.kinds.includes(this.category() as AlertKind));
      return tabMatch && categoryMatch && (this.market()==='all' || s.market===this.market()) && s.turnover >= this.minTurnover() &&
        (!query || `${s.symbol} ${s.name}`.toLowerCase().includes(query));
    }).sort((a,b)=>this.sort()==='turnover' ? b.turnover-a.turnover : b.eventDate.localeCompare(a.eventDate) || b.turnover-a.turnover);
  });
  ngOnInit(): void { void this.refresh(); }
  async refresh(): Promise<void> { this.checkedAt.set(new Date()); await this.store.load(); }
  event(stock: AlertStock) {
    return this.tab()==='new' ? this.store.feed()?.events.find(e=>e.symbol===stock.symbol && e.date===this.store.feed()?.marketDate && (this.category()==='全部'||e.kind===this.category())) : undefined;
  }
  reason(stock: AlertStock): string { return this.event(stock)?.reason || stock.reason; }
  status(stock: AlertStock): string { return this.event(stock)?.status || stock.status; }
  eventKinds(stock: AlertStock): string[] {
    return this.tab()==='new' ? [...new Set(this.store.feed()?.events.filter(e=>e.symbol===stock.symbol && e.date===this.store.feed()?.marketDate).map(e=>e.kind))] : stock.kinds;
  }
  view(stock: AlertStock): void { this.openStock.emit({stock,event:this.event(stock)}); }
  formatTime(value?: string | null): string {
    return value ? new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(value)) : '尚無成功掃描';
  }
}
