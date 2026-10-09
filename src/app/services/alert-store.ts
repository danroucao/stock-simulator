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
  const expected = latestTradingDate(hour >= 20 ? date : yesterday.toISOString().slice(0,10));
  if (!hasTradingCalendar(date)) return '本年度交易日曆尚未核對；請依資料截至日期判讀。';
  return feed.marketDate < expected ? `行情落後預期交易日 ${expected}，請稍後重新讀取結果。` : '';
}
@Injectable({providedIn:'root'})
export class AlertStore {
  readonly feed = signal<AlertFeed | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly storageError = signal('');
  readonly follows = signal<MarketStock[]>(this.restoreFollows());
  private readonly key = 'stock-alert-follows-v1';
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
      const response = await fetch(new URL('alerts/latest.json',document.baseURI),{cache:'no-cache',signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error('無法讀取');
      const feed = await response.json();
      if (!validateAlertFeed(feed)) throw new Error('格式錯誤');
      this.feed.set(feed);
    } catch { this.error.set('掃描結果讀取失敗。請重新讀取；若已有結果，仍保留原資料時間。'); }
    finally { this.loading.set(false); }
  }
}
