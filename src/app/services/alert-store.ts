import { Injectable, signal } from '@angular/core';
import { AlertFeed, MarketStock } from './market-alerts';
import { hasTradingCalendar, latestTradingDate } from './trading-calendar';

export interface AlertSelection { stock: import('./market-alerts').AlertStock; event?: import('./market-alerts').AlertEvent; }
export function validateAlertFeed(value: unknown): value is AlertFeed {
  const v = value as AlertFeed;
  const kinds = ['整理觀察','突破提醒','跌破提醒','均線偏離'];
  const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
  const range = (r: AlertFeed['stocks'][number]['range']) => r === undefined || !!r && typeof r.id === 'string' && date(r.date) &&
    [r.lower,r.upper,r.anchorClose].every(x=>Number.isFinite(x) && x>0) && r.lower<=r.upper && typeof r.version === 'string';
  return !!v && v.schemaVersion === 1 && ['ready','error','unconfigured'].includes(v.status) &&
    Array.isArray(v.stocks) && Array.isArray(v.events) && !!v.rules && v.rules.window === 45 &&
    (v.marketDate === null || date(v.marketDate)) &&
    (v.scannedAt === null || Number.isFinite(Date.parse(v.scannedAt))) &&
    (v.priceBasis===undefined || ['adjusted','raw-action-screened'].includes(v.priceBasis)) &&
    (v.historyVersion===undefined || typeof v.historyVersion==='string') &&
    (v.baselineDate===undefined || date(v.baselineDate)) &&
    (v.calendarYears===undefined || Array.isArray(v.calendarYears) && v.calendarYears.every(Number.isInteger)) &&
    (v.closedDates===undefined || Array.isArray(v.closedDates) && v.closedDates.every(date)) &&
    Number.isInteger(v.universeCount) && v.universeCount>=0 && Number.isInteger(v.excludedCount) && v.excludedCount>=0 &&
    (v.status !== 'ready' || !!v.marketDate && !!v.scannedAt) &&
    v.stocks.every(s => /^\d{4}$/.test(s.symbol) && typeof s.name === 'string' && ['twse','tpex'].includes(s.market) &&
      date(s.date) && date(s.eventDate) && typeof s.eligible === 'boolean' && range(s.range) &&
      [s.close,s.turnover,s.sma5,s.sma60,s.ratio,s.deviation,s.volumeRatio].every(Number.isFinite) &&
      Array.isArray(s.kinds) && s.kinds.every(k=>kinds.includes(k)) && Array.isArray(s.history) &&
      s.history.every(b => date(b.date) && [b.open,b.high,b.low,b.close,b.rawClose,b.volume,b.turnover].every(Number.isFinite))) &&
    v.events.every(e => typeof e.id === 'string' && typeof e.symbol === 'string' && date(e.date) && kinds.includes(e.kind) && range(e.range));
}
export function alertFreshness(feed: AlertFeed | null, now = new Date()): string {
  if (!feed?.marketDate) return '';
  const date = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',hourCycle:'h23'}).format(now));
  const yesterday = new Date(`${date}T00:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate()-1);
  const candidate = hour >= 20 ? date : yesterday.toISOString().slice(0,10);
  const currentCalendar = feed.calendarYears?.includes(Number(date.slice(0,4))) && Array.isArray(feed.closedDates);
  let expected = latestTradingDate(candidate);
  if(currentCalendar) {
    const cursor = new Date(`${candidate}T00:00:00Z`), closed = new Set(feed.closedDates);
    for(let offset=0;offset<366;offset++) {
      const value=cursor.toISOString().slice(0,10);
      if(![0,6].includes(cursor.getUTCDay()) && !closed.has(value)) { expected=value;break; }
      cursor.setUTCDate(cursor.getUTCDate()-1);
    }
  }
  if (!currentCalendar && !hasTradingCalendar(date)) return '本年度交易日曆尚未核對；請依資料截至日期判讀。';
  return feed.marketDate < expected ? `行情落後預期交易日 ${expected}，請稍後重新讀取結果。` : '';
}
@Injectable({providedIn:'root'})
export class AlertStore {
  readonly feed = signal<AlertFeed | null>(this.restoreFeed());
  readonly fromCache = signal(!!this.feed());
  readonly loading = signal(false);
  readonly error = signal('');
  readonly storageError = signal('');
  readonly follows = signal<MarketStock[]>(this.restoreFollows());
  private readonly key = 'stock-alert-follows-v1';
  private histories?: { version:string; request:Promise<Record<string,import('./market-alerts').DailyBar[]>> };
  private restoreFeed(): AlertFeed | null {
    try { const cached=JSON.parse(localStorage.getItem('stock-alert-result-cache-v1') || 'null');return validateAlertFeed(cached) ? cached : null; } catch { return null; }
  }
  private restoreFollows(): MarketStock[] {
    try {
      const value = JSON.parse(localStorage.getItem('stock-alert-follows-v1') || '[]');
      return Array.isArray(value) ? value.filter(s => /^\d{4}$/.test(s?.symbol) && typeof s.name === 'string' && ['twse','tpex'].includes(s.market)) : [];
    } catch { return []; }
  }
  following(symbol: string): boolean { return this.follows().some(s=>s.symbol===symbol); }
  toggle(stock: MarketStock): void {
    const next = this.following(stock.symbol) ? this.follows().filter(s=>s.symbol!==stock.symbol) : [...this.follows(),{symbol:stock.symbol,name:stock.name,market:stock.market}];
    try { localStorage.setItem(this.key,JSON.stringify(next)); this.follows.set(next); this.storageError.set(''); }
    catch { this.storageError.set('瀏覽器無法儲存追蹤設定，請檢查儲存空間或隱私設定後重試。'); }
  }
  async load(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true); this.error.set('');
    try {
      const signal=AbortSignal.timeout(60000);
      let response = await fetch(new URL('alerts/index.json',document.baseURI),{cache:'no-cache',signal});
      // Older deployments still expose the full feed; retain compatibility during rollout.
      if(response.status===404)response=await fetch(new URL('alerts/latest.json',document.baseURI),{cache:'no-cache',signal});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const feed = await response.json();
      if (!validateAlertFeed(feed)) throw new Error('資料格式不符');
      this.feed.set(feed);this.fromCache.set(false);
      // Cache only the lightweight summary. A quota failure must not interrupt live results.
      const compact={...feed,stocks:feed.stocks.map((stock: AlertFeed['stocks'][number])=>({...stock,history:[]}))};
      const content=JSON.stringify(compact);
      if(feed.historyVersion && content.length<=2_000_000)try{localStorage.setItem('stock-alert-result-cache-v1',content);}catch{}
    } catch (error) {
      const name=error && typeof error==='object' && 'name' in error ? String(error.name) : '';
      const timeout=['TimeoutError','AbortError'].includes(name);
      const reason=timeout ? '下載逾時，請確認連線後重新讀取。' : error instanceof Error && error.message.startsWith('HTTP ') ? `伺服器回應 ${error.message}，請稍後重新讀取。` : error instanceof Error && error.message==='資料格式不符' ? '資料格式不符，請重新整理網頁或稍後重試。' : '網路連線或回應內容異常，請確認連線後重新讀取。';
      this.error.set(`掃描結果讀取失敗：${reason}${this.feed() ? '目前保留上次成功結果及原資料時間。' : ''}`);
    }
    finally { this.loading.set(false); }
  }
  async loadHistory(stock: AlertFeed['stocks'][number]): Promise<import('./market-alerts').DailyBar[]> {
    if(stock.history.length || !stock.eligible)return stock.history;
    const version=this.feed()?.historyVersion;if(!version)return [];
    if(this.histories?.version!==version) {
      const request=(async()=>{
        const url=new URL('alerts/history.json',document.baseURI);url.searchParams.set('v',version);
        const response=await fetch(url,{cache:'no-cache',signal:AbortSignal.timeout(60000)});
        if(!response.ok)throw new Error(`走勢讀取失敗（HTTP ${response.status}），請重新讀取或返回提醒中心更新結果。`);
        const bundle=await response.json();
        if(bundle.schemaVersion!==1 || bundle.version!==version || !bundle.stocks || typeof bundle.stocks!=='object')throw new Error('走勢資料版本不符，請返回提醒中心重新讀取結果。');
        return bundle.stocks as Record<string,import('./market-alerts').DailyBar[]>;
      })();
      this.histories={version,request};
      request.catch(()=>{if(this.histories?.request===request)this.histories=undefined;});
    }
    const data=await this.histories.request, history=data[stock.symbol];
    if(!Array.isArray(history) || !history.length || history.some(b=>!b||typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||b.date>stock.date||![b.open,b.high,b.low,b.close,b.rawClose,b.volume,b.turnover].every(Number.isFinite))) {
      this.histories=undefined;throw new Error('個股走勢資料不完整，請稍後重新讀取。');
    }
    return history;
  }
}
