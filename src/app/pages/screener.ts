import {
  Component,
  computed,
  inject,
  signal,
  afterNextRender,
  Injector,
  OnDestroy,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { MarketStore } from '../services/market-store';
import { AlertStore } from '../services/alert-store';
import { defaultFilter, sortedRows, percentile, ScreenFilter } from '../services/screening';
import { MetricKey } from '../services/market-analysis';
import {ALERT_RULES} from '../services/market-alerts';
@Component({
  selector: 'app-screener',
  imports: [DecimalPipe, RouterLink],
  templateUrl: './screener.html',
  styleUrl: './market-pages.scss',
})
export class Screener implements OnDestroy {
  private readonly onHide=()=>{this.store.scroll=window.scrollY;this.store.rememberView();};
  readonly store = inject(MarketStore);
  readonly alerts = inject(AlertStore);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private injector = inject(Injector);
  readonly filter = this.store.filter;
  readonly name = signal('');
  readonly tracking = signal(false);
  readonly status = signal('');
  readonly rows = computed(() => sortedRows(this.store.feed()?.stocks || [], this.filter()));
  readonly visible = computed(() => this.rows().slice(0, this.store.limit()));
  readonly industries = computed(() =>
    [...new Set(this.store.feed()?.stocks.map((s) => s.industry))].sort(),
  );
  readonly fields: Array<{ key: MetricKey; label: string }> = [
    { key: 'width', label: '45 日區間寬度（%）' },
    { key: 'distance', label: '距區間上緣（%）' },
    { key: 'volatility', label: '20 日波動率（%）' },
    { key: 'deviation', label: '均線偏離（%）' },
    { key: 'averageTurnover', label: '45 日平均成交金額（元）' },
  ];
  readonly applied = computed(() => {
    const f = this.filter(),
      labels = [];
    if (f.query) labels.push('搜尋：' + f.query);
    if (f.market !== 'all') labels.push('市場：' + (f.market === 'twse' ? '上市' : '上櫃'));
    if (f.industry !== 'all') labels.push('產業：' + f.industry);
    if (f.consolidation !== 'all')
      labels.push(f.consolidation === 'yes' ? '符合盤整三條件' : '不符合盤整三條件');
    if (f.direction !== 'all') labels.push('價格方向：' + f.direction);
    if (f.state !== 'all') labels.push('狀態：' + f.state);
    for (const field of this.fields) {
      const b = f.bounds[field.key];
      if (b) labels.push(field.label + ' ' + (b.min ?? '不限') + '～' + (b.max ?? '不限'));
    }
    return labels;
  });
  constructor() {
    window.addEventListener('pagehide',this.onHide);
    const industry = this.route.snapshot.queryParamMap.get('industry');
    if (industry) this.update({ industry });
    void this.store.load();
    afterNextRender(() => window.scrollTo(0, this.store.scroll), { injector: this.injector });
  }
  ngOnDestroy(): void {
    window.removeEventListener('pagehide',this.onHide);
    this.store.scroll = window.scrollY;
    this.store.rememberView();
  }
  update(changes: Partial<ScreenFilter>): void {
    this.filter.update((f) => ({ ...f, ...changes }));
    this.store.limit.set(20);
  }
  bound(key: MetricKey, side: 'min' | 'max', raw: string): void {
    const f = structuredClone(this.filter());
    const number = raw.trim() === '' ? undefined : Number(raw);
    if (number !== undefined && !Number.isFinite(number)) return;
    const range = { ...f.bounds[key], [side]: number };
    if (range.min === undefined && range.max === undefined) delete f.bounds[key];
    else f.bounds[key] = range;
    this.update({ bounds: f.bounds });
  }
  preset(kind: string): void {
    const f = defaultFilter(),
      values = (this.store.feed()?.stocks || []).flatMap((s) =>
        s.metrics.volatility.value === null ? [] : [s.metrics.volatility.value],
      );
    if (kind === '盤整') f.consolidation = 'yes';
    if (kind === '接近上緣') {
      f.bounds.distance = { min: 0, max: 5 };
      f.sort = 'distance';
      f.descending = false;
    }
    if (kind === '今日突破' || kind === '今日跌破') f.state = kind;
    if (kind === '高波動' || kind === '低波動') {
      const value = percentile(values, kind === '高波動' ? 0.75 : 0.25);
      if (value === null) {
        this.status.set('目前無有效波動率可設定預設。');
        return;
      }
      f.bounds.volatility = kind === '高波動' ? { min: value } : { max: value };
    }
    if (kind === '均線偏高') f.bounds.deviation = { min: Number(((ALERT_RULES.highRatio-1)*100).toFixed(8)) };
    if (kind === '均線偏低') f.bounds.deviation = { max: Number(((ALERT_RULES.lowRatio-1)*100).toFixed(8)) };
    this.update(f);
    this.status.set(
      kind === '自訂' ? '已清除預設，請設定條件。' : '已套用「' + kind + '」，可在自訂條件中修改。',
    );
  }
  save(): void {
    if (!this.name().trim()) {
      this.status.set('請先為條件命名。');
      return;
    }
    const before = this.store.saved().length;
    this.store.save(this.name(), this.tracking());
    if (this.store.saved().length === before) {
      this.status.set('未能儲存，請查看錯誤原因後重試。');
      return;
    }
    this.status.set('已儲存條件；追蹤僅於開啟網站取得新快照時比較。');
    this.name.set('');
  }
}
