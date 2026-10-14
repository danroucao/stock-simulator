import {
  Component,
  computed,
  inject,
  signal,
  afterNextRender,
  Injector,
  OnDestroy,
  effect,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, ActivatedRoute, RouterLink, NavigationStart } from '@angular/router';
import { MarketStore } from '../services/market-store';
import { AlertStore } from '../services/alert-store';
import {
  defaultFilter,
  sortedRows,
  percentile,
  ScreenFilter,
  filterFromQuery,
  technicalPreset,
} from '../services/screening';
import { amount, boundLabel } from '../services/market-presentation';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MetricKey } from '../services/market-analysis';
import { ALERT_RULES } from '../services/market-alerts';
@Component({
  selector: 'app-screener',
  imports: [DecimalPipe, RouterLink],
  templateUrl: './screener.html',
  styleUrl: './market-pages.scss',
})
export class Screener implements OnDestroy {
  private destroyed = false;
  private departing = false;
  private readonly onHide = () => {
    this.store.scroll = window.scrollY;
    this.store.rememberView();
  };
  readonly store = inject(MarketStore);
  readonly alerts = inject(AlertStore);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private injector = inject(Injector);
  readonly filter = this.store.filter;
  readonly name = signal('');
  readonly tracking = signal(false);
  readonly status = signal('');
  readonly drawerOpen = signal(false);
  readonly resultFocus = computed(() => {
    const f = this.filter();
    return f.consolidation !== 'all' || f.bounds.distance || f.state !== 'all' ? 'range' : f.bounds.volatility ? 'volatility' : f.bounds.deviation ? 'deviation' : 'all';
  });
  openFilters(): void {
    const dialog = document.querySelector<HTMLDialogElement>('app-screener .filter-panel');
    dialog?.showModal(); this.drawerOpen.set(true);
  }
  closeFilters(): void {
    document.querySelector<HTMLDialogElement>('app-screener .filter-panel')?.close();
    this.drawerOpen.set(false);
  }
  readonly amount = amount;
  readonly metricFields: Array<{ key: MetricKey; label: string }> = [
    { key: 'sma5', label: '近 5 日平均價' },
    { key: 'sma60', label: '近 60 日平均價' },
    { key: 'smaChange', label: '均線方向所需歷史' },
    { key: 'width', label: '45 日區間' },
    { key: 'trend', label: '45 日價格趨勢' },
    { key: 'deviation', label: '均線偏離' },
    { key: 'volatility', label: '20 日波動率' },
    { key: 'averageTurnover', label: '平均成交金額' },
    { key: 'zeroDays', label: '無成交日數' },
    { key: 'distance', label: '保存區間上緣' },
  ];
  readonly rows = computed(() => sortedRows(this.store.feed()?.stocks || [], this.filter()));
  readonly volatilityThresholds = computed(() => {
    const values = (this.store.feed()?.stocks || []).flatMap(stock => stock.metrics.volatility.value === null ? [] : [stock.metrics.volatility.value]);
    const round = (value:number|null) => value === null ? null : Number(value.toFixed(2));
    return {high:round(percentile(values,.75)),low:round(percentile(values,.25))};
  });
  presetApplied(kind:string): boolean {
    const f=this.filter();
    if(kind==='盤整')return f.consolidation==='yes';
    if(kind==='接近上緣')return f.state==='區間內'&&f.bounds.distance?.min===0&&f.bounds.distance?.max===5;
    if(kind==='今日突破'||kind==='今日跌破')return f.state===kind;
    if(kind==='高波動')return this.volatilityThresholds().high!==null&&f.bounds.volatility?.min===this.volatilityThresholds().high&&f.bounds.volatility?.max===undefined;
    if(kind==='低波動')return this.volatilityThresholds().low!==null&&f.bounds.volatility?.max===this.volatilityThresholds().low&&f.bounds.volatility?.min===undefined;
    if(kind==='均線偏高')return f.bounds.deviation?.min===Number(((ALERT_RULES.highRatio-1)*100).toFixed(8));
    if(kind==='均線偏低')return f.bounds.deviation?.max===Number(((ALERT_RULES.lowRatio-1)*100).toFixed(8));
    return false;
  }
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
    if (f.state !== 'all') labels.push('狀態：' + f.state.replace('今日', '最新交易日'));
    for (const field of this.fields) {
      const b = f.bounds[field.key];
      if (b) labels.push(boundLabel(field.key, field.label, b));
    }
    return labels;
  });
  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event instanceof NavigationStart && event.url.split('?')[0] !== '/screener') {
        this.onHide(); this.departing = true;
      }
    });
    window.addEventListener('pagehide', this.onHide);
    this.route.queryParams.pipe(takeUntilDestroyed()).subscribe((query) => {
      if (this.router.getCurrentNavigation()?.extras.info === 'screen-sync') return;
      const next = filterFromQuery(query, this.filter());
      if (JSON.stringify(next) !== JSON.stringify(this.filter())) {
        this.filter.set(next);
        this.store.limit.set(20);
        this.store.scroll = 0;
      }
    });
    effect(() => {
      const value = JSON.stringify(this.filter());
      this.store.rememberView();
      if (this.route.snapshot.queryParamMap.get('filter') !== value)
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { filter: value },
          replaceUrl: true,
          info: 'screen-sync',
        });
    });
    void this.store.load().then(() => {
      if (!this.destroyed) afterNextRender(() => {
        if (!this.destroyed) window.scrollTo(0, this.store.scroll);
      }, { injector: this.injector });
    });
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    window.removeEventListener('pagehide', this.onHide);
    if (!this.departing) this.store.scroll = window.scrollY;
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
    const f = kind === '自訂' ? technicalPreset(this.filter()) : structuredClone(this.filter()),
      values = (this.store.feed()?.stocks || []).flatMap((s) =>
        s.metrics.volatility.value === null ? [] : [s.metrics.volatility.value],
      );
    if (kind === '盤整') f.consolidation = 'yes';
    if (kind === '接近上緣') {
      f.state = '區間內';
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
      const threshold = Number(value.toFixed(2));
      f.bounds.volatility = kind === '高波動' ? { min: threshold } : { max: threshold };
    }
    if (kind === '均線偏高')
      f.bounds.deviation = { min: Number(((ALERT_RULES.highRatio - 1) * 100).toFixed(8)) };
    if (kind === '均線偏低')
      f.bounds.deviation = { max: Number(((ALERT_RULES.lowRatio - 1) * 100).toFixed(8)) };
    this.update(f);
    this.status.set(
      kind === '自訂'
        ? '已清除技術條件，保留搜尋、產業與市場。'
        : '已套用「' +
            kind.replace('今日', '最新交易日') +
            '」，保留既有條件，可在自訂條件中修改。',
    );
  }
  resetAll(): void {
    this.update(defaultFilter());
    this.status.set('已重設全部條件。');
  }
  removeCondition(index: number): void {
    const f = structuredClone(this.filter());
    const keys: Array<keyof ScreenFilter | MetricKey> = [];
    if (f.query) keys.push('query');
    for (const key of ['market','industry','consolidation','direction','state'] as const) if (f[key] !== 'all') keys.push(key);
    for (const field of this.fields) if (f.bounds[field.key]) keys.push(field.key);
    const key = keys[index];
    if (!key) return;
    if (key === 'query') f.query = '';
    else if (['market','industry','consolidation','direction','state'].includes(key)) (f as unknown as Record<string,unknown>)[key] = 'all';
    else delete f.bounds[key as MetricKey];
    this.update(f);
    this.status.set('已移除條件，其他條件保留。');
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
