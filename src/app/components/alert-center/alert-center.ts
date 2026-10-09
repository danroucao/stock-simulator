import { Component, computed, inject, OnInit, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AlertStore, AlertSelection, alertFreshness } from '../../services/alert-store';
import { AlertKind, AlertStock } from '../../services/market-alerts';
import { exclusionSummary, upperDistance } from '../../services/alert-presentation';

@Component({selector:'app-alert-center',imports:[DecimalPipe],templateUrl:'./alert-center.html',styleUrl:'./alert-center.scss'})
export class AlertCenter implements OnInit {
  readonly Math = Math;
  readonly more=(value:number)=>value+20;
  readonly store = inject(AlertStore);
  readonly openStock = output<AlertSelection>();
  readonly tab = signal<'new'|'current'|'follows'>('new');
  readonly category = signal<AlertKind | '全部'>('全部');
  readonly search = signal(''); readonly market = signal('all');
  readonly minTurnover = signal(0); readonly sort = signal('event');
  readonly deviationFilter=signal('all');
  readonly limit=signal(20);
  readonly distance=upperDistance;
  readonly exclusions=computed(()=>this.store.feed() ? exclusionSummary(this.store.feed()!) : null);
  readonly eligibleCount=computed(()=>this.store.feed()?.stocks.filter(s=>s.eligible).length || 0);
  readonly unknownPriceCount=computed(()=>this.store.feed()?.stocks.filter(s=>!s.eligible && /未確認價格基準/.test(s.exclusion || '') && !/除權息|減資|面額變更|分割/.test(s.exclusion || '')).length || 0);
  readonly matchingCount=computed(()=>this.store.feed()?.stocks.filter(s=>s.eligible && s.kinds.length).length || 0);
  readonly initial=computed(()=>this.store.feed()?.baselineDate===this.store.feed()?.marketDate && !!this.store.feed()?.baselineDate);
  readonly latestEvents=computed(()=>{
    const feed=this.store.feed();return new Map(feed?.stocks.map(s=>[s.symbol,feed.events.filter(e=>e.symbol===s.symbol && e.date===feed.marketDate)]));
  });
  readonly visibleRows=computed(()=>this.rows().slice(0,this.limit()));
  selectTab(tab:'new'|'current'|'follows'):void {this.tab.set(tab);this.limit.set(20);}
  selectCategory(kind:AlertKind|'全部'):void {this.category.set(kind);this.limit.set(20);}
  count(kind:AlertKind|'全部'):number {
    return this.tabStocks().filter(s=>kind==='全部'||(this.tab()==='new' ? this.latestEvents().get(s.symbol)?.some(e=>e.kind===kind) : s.kinds.includes(kind))).length;
  }
  private tabStocks():AlertStock[] {return this.store.feed()?.stocks.filter(s=>this.tab()==='new' ? !!this.latestEvents().get(s.symbol)?.length : this.tab()==='current' ? s.eligible && !!s.kinds.length : this.store.following(s.symbol)) || [];}
  readonly categories: Array<AlertKind|'全部'> = ['全部','整理觀察','突破提醒','跌破提醒','均線偏離'];
  readonly checkedAt = signal(new Date());
  readonly stale = computed(()=>alertFreshness(this.store.feed(),this.checkedAt()));
  readonly newCount = computed(()=>new Set(this.store.feed()?.events.filter(e=>e.date===this.store.feed()?.marketDate).map(e=>e.symbol)).size);
  readonly missingFollows = computed(()=>this.store.follows().filter(s=>!this.store.feed()?.stocks.some(r=>r.symbol===s.symbol)));
  readonly rows = computed(()=>{
    const feed = this.store.feed(); if (!feed) return [];
    const query = this.search().trim().toLowerCase();
    return this.tabStocks().filter(s=>{
      const events = this.latestEvents().get(s.symbol) || [];
      const tabMatch = this.tab()==='new' ? events.length > 0 : this.tab()==='current' ? s.eligible && s.kinds.length > 0 : this.store.following(s.symbol);
      const categoryMatch = this.category()==='全部' || (this.tab()==='new' ? events.some(e=>e.kind===this.category()) : s.kinds.includes(this.category() as AlertKind));
      const deviationMatch=this.deviationFilter()==='all' || s.kinds.includes('均線偏離') && (this.deviationFilter()==='low' ? s.ratio<=feed.rules.lowRatio : s.ratio>=feed.rules.highRatio);
      return tabMatch && categoryMatch && deviationMatch && (this.market()==='all' || s.market===this.market()) && s.turnover >= this.minTurnover() &&
        (!query || `${s.symbol} ${s.name}`.toLowerCase().includes(query));
    }).sort((a,b)=>this.sort()==='upper' ? (upperDistance(a) ?? Infinity)-(upperDistance(b) ?? Infinity) || b.turnover-a.turnover : this.sort()==='turnover' ? b.turnover-a.turnover : b.eventDate.localeCompare(a.eventDate) || b.turnover-a.turnover);
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
