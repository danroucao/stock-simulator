import { DestroyRef, Injectable, Optional, computed, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';
import { marketUpdateStatus } from './market-update-status';
import {intradaySession} from './intraday-session';
import type { IntradayMarketFeed, MarketAnalysisFeed, MetricKey } from './market-analysis';
import {
  SavedScreen,
  ScreenEvent,
  ScreenFilter,
  defaultFilter,
  compareCondition,
} from './screening';
import { readMarketCache, writeMarketCache } from './browser-market-cache';
const keys: MetricKey[] = [
  'close',
  'change',
  'volume',
  'turnover',
  'width',
  'trend',
  'sma5',
  'sma60',
  'deviation',
  'smaChange',
  'volatility',
  'averageTurnover',
  'zeroDays',
  'distance',
];
export function validMarket(value: unknown): value is MarketAnalysisFeed {
  const v = value as MarketAnalysisFeed;
  if (
    !v ||
    v.schemaVersion !== 2 ||
    !['ready', 'error'].includes(v.status) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v.date) ||
    !Number.isFinite(Date.parse(v.scannedAt)) ||
    !Array.isArray(v.stocks) ||
    !Array.isArray(v.industryHeat) ||
    !v.coverage
  )
    return false;
  if(v.heatComparison && (!Array.isArray(v.heatComparison.dates)||!Array.isArray(v.heatComparison.symbols)||!Array.isArray(v.heatComparison.excluded)||!Array.isArray(v.heatComparison.issues)||typeof v.heatComparison.available!=='boolean'||v.heatComparison.issues.some(i=>!i||typeof i.date!=='string'||typeof i.reason!=='string'||i.symbols!==undefined&&!Array.isArray(i.symbols))))return false;
  if (
    new Set(v.stocks.map((s) => s.symbol)).size !== v.stocks.length ||
    v.coverage.checked !== v.stocks.length ||
    v.coverage.complete + v.coverage.partial + v.coverage.none !== v.coverage.total
  )
    return false;
  return (
    v.stocks.every(
      (s) =>
        /^\d{4}$/.test(s.symbol) &&
        typeof s.name === 'string' &&
        typeof s.industry === 'string' &&
        ['twse', 'tpex'].includes(s.market) &&
        keys.every(
          (k) =>
            s.metrics?.[k] &&
            (s.metrics[k].value === null
              ? typeof s.metrics[k].reason === 'string'
              : Number.isFinite(s.metrics[k].value)),
        ),
    ) &&
    v.industryHeat.every(
      (i) =>
        typeof i.industry === 'string' &&
        [i.turnover, i.share, i.valid, i.total].every(Number.isFinite) &&
        [i.averageShare, i.changePoints, i.concentration].every(
          (v) => v === null || Number.isFinite(v),
        ),
    )
  );
}
function restore<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
    return Array.isArray(fallback) && !Array.isArray(value) ? fallback : value;
  } catch {
    return fallback;
  }
}
@Injectable({ providedIn: 'root' })
export class MarketStore {
  private readonly intradayClock = signal(Date.now());
 readonly updateStatus=computed(()=>{const feed=this.feed();return marketUpdateStatus(feed?{date:feed.date,scannedAt:feed.scannedAt,status:feed.status,attemptedAt:feed.attemptedAt,expectedDate:feed.expectedDate,message:feed.message,calendarYears:feed.calendarYears,closedDates:feed.closedDates}:null);});
  readonly importPreview = signal<{ saved: SavedScreen[]; events: ScreenEvent[] } | null>(null);
  exportConditions(): void {
    const blob = new Blob(
        [JSON.stringify({ schemaVersion: 1, saved: this.saved(), events: this.events() }, null, 2)],
        { type: 'application/json' },
      ),
      url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = 'stock-screen-conditions.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async previewConditions(file: File): Promise<void> {
    try {
      const data = JSON.parse(await file.text());
      if (
        data.schemaVersion !== 1 ||
        !Array.isArray(data.saved) ||
        !Array.isArray(data.events) ||
        data.saved.some(
          (s: SavedScreen) =>
            !s?.id ||
            !s.name ||
            !s.filter ||
            typeof s.filter.query !== 'string' ||
            !s.filter.bounds ||
            !s.known ||
            !Array.isArray(s.unknown),
        ) ||
        data.events.some(
          (e: ScreenEvent) =>
            !e?.id ||
            !e.snapshot ||
            !keys.every(
              (k) =>
                e.snapshot.metrics?.[k] &&
                (e.snapshot.metrics[k].value === null ||
                  Number.isFinite(e.snapshot.metrics[k].value)),
            ),
        )
      )
        throw Error('條件備份格式不符');
      this.importPreview.set({ saved: data.saved, events: data.events });
      this.error.set('');
    } catch (e) {
      this.importPreview.set(null);
      this.error.set(e instanceof Error ? e.message : '備份讀取失敗');
    }
  }
  confirmImport(): void {
    const preview = this.importPreview();
    if (!preview) return;
    try {
      localStorage.setItem(
        'stock-screen-state-before-import',
        JSON.stringify({ schemaVersion: 1, saved: this.saved(), events: this.events() }),
      );
      this.commit(preview.saved, preview.events);
      this.importPreview.set(null);
    } catch {
      this.error.set('無法保留匯入前備份，未取代原條件。');
    }
  }
  time(value: string): string {
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      dateStyle: 'short',
      timeStyle: 'short',
      hour12: false,
    }).format(new Date(value));
  }
  readonly feed = signal<MarketAnalysisFeed | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly intraday = signal<IntradayMarketFeed|null>(null);
  readonly intradayLoading=signal(false);
  readonly intradayError=signal('');
  readonly intradayUsable=computed(()=>{const feed=this.intraday(),session=intradaySession(new Date(this.intradayClock()));return !!feed&&session.state==='open'&&feed.quoteDate===session.date&&this.intradayClock()-Date.parse(feed.generatedAt)<=10*60*1000;});
  readonly intradayBySymbol=computed(()=>new Map(((this.intradayUsable()?this.intraday()?.quotes:[])||[]).map(quote=>[quote.symbol,quote])));
  readonly intradayFreshness=computed(()=>{
    const feed=this.intraday();if(!feed)return '';
    const age=this.intradayClock()-Date.parse(feed.generatedAt);
    return age>10*60*1000?'盤中快照已超過 10 分鐘，請依行情時間判讀。':`盤中快照 ${this.time(feed.generatedAt)}（台北）・${feed.coverage.valid}／${feed.coverage.total} 檔`;
  });
  readonly filter = signal<ScreenFilter>(defaultFilter());
  readonly limit = signal(20);
  scroll = 0;
  readonly heatSort = signal('turnover');
  marketScroll = 0;
  readonly saved = signal<SavedScreen[]>(
    restore<SavedScreen[]>('stock-screens-v1', []).filter(
      (s) => s?.id && s.name && s.filter && s.known && Array.isArray(s.unknown),
    ),
  );
  readonly events = signal<ScreenEvent[]>(
    restore<ScreenEvent[]>('stock-screen-events-v1', []).filter((e) => e?.id && e.snapshot),
  );
  private cacheReady: Promise<void> = Promise.resolve();
  constructor(@Optional() destroyRef?: DestroyRef) {
    if(destroyRef)timer(60_000,60_000).pipe(takeUntilDestroyed(destroyRef)).subscribe(()=>{
        this.intradayClock.set(Date.now());
        const visible=typeof document==='undefined'||document.visibilityState==='visible';
        if(visible&&intradaySession().state==='open')void this.loadIntraday();
      });
    this.cacheReady = readMarketCache()
      .then((cache) => {
        if (
          validMarket(cache) &&
          (!this.feed() ||
            cache.date > this.feed()!.date ||
            (cache.date === this.feed()!.date && cache.scannedAt > this.feed()!.scannedAt))
        )
          this.feed.set(cache);
      })
      .catch(() => {});
    const cache = restore<unknown>('stock-market-cache-v2', null);
    if (validMarket(cache)) this.feed.set(cache);
    const state = restore<{ saved?: SavedScreen[]; events?: ScreenEvent[] }>(
      'stock-screen-state-v1',
      {},
    );
    if (Array.isArray(state.saved) && Array.isArray(state.events)) {
      this.saved.set(
        state.saved.filter((s) => s?.id && s.filter && s.known && Array.isArray(s.unknown)),
      );
      this.events.set(state.events.filter((e) => e?.id && e.snapshot));
    }
    try {
      const view = JSON.parse(sessionStorage.getItem('stock-screener-view-v1') || 'null');
      if (
        view &&
        typeof view.filter?.query === 'string' &&
        view.filter.bounds &&
        Object.values(view.filter.bounds).every(
          (b) =>
            !!b &&
            Object.values(b as object).every(
              (v) => v === undefined || (typeof v === 'number' && Number.isFinite(v)),
            ),
        )
      ) {
        this.filter.set({ ...defaultFilter(), ...view.filter });
        this.limit.set(Math.max(20, Math.min(2000, view.limit || 20)));
        this.scroll = Math.max(0, view.scroll || 0);
      }
    } catch {}
  }
  rememberView(): void {
    try {
      sessionStorage.setItem(
        'stock-screener-view-v1',
        JSON.stringify({ filter: this.filter(), limit: this.limit(), scroll: this.scroll }),
      );
    } catch {}
  }
  private pending?: Promise<void>;
  load(): Promise<void> {
    if (!this.pending) this.pending = this.loadFeed().finally(() => (this.pending = undefined));
    return this.pending;
  }
  async loadIntraday():Promise<void>{
    if(this.intradayLoading())return;
    this.intradayLoading.set(true);this.intradayError.set('');
    try{
      const configured=(globalThis as typeof globalThis&{__STOCK_APP_CONFIG__?:{tpexProxyUrl?:string}}).__STOCK_APP_CONFIG__?.tpexProxyUrl?.trim();
      const base=(configured||'/api/tpex').replace(/\/$/,'');
      const response=await fetch(`${base}/api/intraday-market`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(response.status===404){this.intraday.set(null);this.intradayError.set('今日盤中快照尚未產生。');return;}
      if(!response.ok)throw new Error(`盤中快照 HTTP ${response.status}`);
      const value=await response.json() as IntradayMarketFeed;
      if(value?.schemaVersion!==1||value.status!=='ready'||!/^\d{4}-\d{2}-\d{2}$/.test(value.quoteDate)||!Number.isFinite(Date.parse(value.generatedAt))||!Array.isArray(value.quotes)||!Array.isArray(value.provisionalEvents)||!value.coverage||
        value.quotes.some(quote=>!/^\d{4,6}$/.test(quote.symbol)||![quote.open,quote.high,quote.low,quote.close,quote.volume].every(Number.isFinite)))throw new Error('盤中快照格式不符');
      this.intraday.set(value);
    }catch(error){this.intradayError.set(error instanceof Error?error.message:'盤中快照讀取失敗');}
    finally{this.intradayLoading.set(false);}
  }
  private async loadFeed(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      await this.cacheReady;
      const r = await fetch(new URL('market/latest.json', document.baseURI), {
        cache: 'no-cache',
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok)
        throw Error(
          r.status === 404 ? '全市場分析資料尚未更新，請稍後重新讀取；可先查看個股行情。' : 'HTTP ' + r.status,
        );
      const feed = await r.json();
      if (!validMarket(feed)) throw Error('市場資料格式不符');
      if (this.feed() && feed.date < this.feed()!.date) throw Error('回應行情比已保存快照更舊');
      this.feed.set(feed);
      void writeMarketCache(feed).then(()=>{if(typeof indexedDB!=='undefined')try{localStorage.removeItem('stock-market-cache-v2');}catch{}}).catch(()=>{});
      if(typeof indexedDB==='undefined')try{localStorage.setItem('stock-market-cache-v2',JSON.stringify(feed));}catch{}
      this.observe();
    } catch (e) {
      this.error.set(
        (e instanceof Error ? e.message : '下載失敗') +
          (this.feed() ? '；保留上次成功結果與日期。' : ''),
      );
    } finally {
      this.loading.set(false);
    }
  }
  private commit(saved: SavedScreen[], events: ScreenEvent[]): void {
    try {
      localStorage.setItem(
        'stock-screen-state-v1',
        JSON.stringify({ schemaVersion: 1, saved, events }),
      );
      this.saved.set(saved);
      this.events.set(events);
    } catch {
      this.error.set('儲存條件失敗，保留原事件與比較日期；請檢查瀏覽器儲存空間。');
    }
  }
  save(name: string, tracking: boolean): void {
    if (!name.trim()) return;
    const saved = {
      id: crypto.randomUUID(),
      name: name.trim(),
      filter: structuredClone(this.filter()),
      tracking,
      known: {},
      unknown: [],
    } as SavedScreen;
    this.commit([...this.saved(), saved], this.events());
    this.observe();
  }
  toggle(id: string): void {
    this.commit(
      this.saved().map((s) =>
        s.id === id ? { ...s, tracking: !s.tracking, date: undefined, known: {}, unknown: [] } : s,
      ),
      this.events(),
    );
    this.observe();
  }
  remove(id: string): void {
    this.commit(
      this.saved().filter((s) => s.id !== id),
      this.events().filter((e) => e.conditionId !== id),
    );
  }
  apply(s: SavedScreen): void {
    this.filter.set(structuredClone(s.filter));
    this.limit.set(20);
  }
  observe(): void {
    const feed = this.feed();
    if (!feed || feed.status === 'error') return;
    const results = this.saved().map((s) => compareCondition(s, feed.stocks, feed.date));
    this.commit(
      results.map((r) => r.condition),
      [
        ...new Map(
          [...this.events(), ...results.flatMap((r) => r.events)].map((e) => [e.id, e]),
        ).values(),
      ].slice(-500),
    );
  }
}
