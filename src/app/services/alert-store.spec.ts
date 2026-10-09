import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AlertStore, alertFreshness, validateAlertFeed } from './alert-store';
import { ALERT_RULES, AlertFeed } from './market-alerts';
const feed: AlertFeed = {schemaVersion:1,status:'ready',marketDate:'2026-10-08',scannedAt:'2026-10-08T11:30:00Z',universeCount:0,excludedCount:0,rules:ALERT_RULES,stocks:[],events:[]};
describe('alert result delivery and follow storage',()=>{
  it('requests the lightweight index first and falls back only for older deployments',async()=>{
    const store=TestBed.inject(AlertStore);
    const fetch=vi.fn().mockResolvedValueOnce({ok:false,status:404}).mockResolvedValueOnce({ok:true,json:async()=>feed});vi.stubGlobal('fetch',fetch);
    await store.load();expect(String(fetch.mock.calls[0][0])).toContain('alerts/index.json');expect(String(fetch.mock.calls[1][0])).toContain('alerts/latest.json');expect(store.feed()).toEqual(feed);
  });
  it('restores a cached summary across reloads and preserves its data date after failure',async()=>{
    const summary={...feed,historyVersion:'summary-v1'};
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>summary}));await TestBed.inject(AlertStore).load();
    const restored=new AlertStore();expect(restored.feed()).toEqual(summary);expect(restored.fromCache()).toBe(true);
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('network')));await restored.load();expect(restored.feed()?.marketDate).toBe('2026-10-08');expect(restored.error()).toContain('保留');
  });
  it('reports timeout, HTTP and malformed-data failures distinctly',async()=>{
    const store=TestBed.inject(AlertStore);
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new DOMException('timeout','TimeoutError')));await store.load();expect(store.error()).toContain('逾時');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:503}));await store.load();expect(store.error()).toContain('HTTP 503');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({})}));await store.load();expect(store.error()).toContain('資料格式不符');
  });
  it('loads matching-version history once and rejects another release version',async()=>{
    const stock={symbol:'2330',date:'2026-10-08',eligible:true,history:[]} as any;
    const bar={date:'2026-10-08',open:50,high:52,low:47,close:50,rawClose:50,volume:1000,turnover:50000};
    const store=TestBed.inject(AlertStore);store.feed.set({...feed,historyVersion:'test-version'});
    const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({schemaVersion:1,version:'test-version',stocks:{2330:[bar]}})});vi.stubGlobal('fetch',fetch);
    expect(await store.loadHistory(stock)).toEqual([bar]);expect(await store.loadHistory(stock)).toEqual([bar]);expect(fetch).toHaveBeenCalledTimes(1);
    store.feed.set({...feed,historyVersion:'another-version'});
    await expect(store.loadHistory(stock)).rejects.toThrow('版本不符');
  });
  afterEach(()=>{ vi.unstubAllGlobals(); localStorage.clear(); });
  it('persists one-click following and restores it in a new instance',()=>{
    const store=TestBed.inject(AlertStore), stock={symbol:'2330',name:'台積電',market:'twse' as const};
    store.toggle(stock); expect(store.following(stock.symbol)).toBe(true);
    expect(new AlertStore().following(stock.symbol)).toBe(true);
    store.toggle(stock); expect(new AlertStore().following(stock.symbol)).toBe(false);
  });
  it('keeps last successful results when reading fails or the payload is invalid',async()=>{
    const store=TestBed.inject(AlertStore);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>feed}));
    await store.load(); expect(store.feed()).toEqual(feed);
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('network')));
    await store.load(); expect(store.feed()).toEqual(feed); expect(store.error()).toContain('失敗');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({})}));
    await store.load(); expect(store.feed()).toEqual(feed);
    expect(validateAlertFeed({...feed,scannedAt:null})).toBe(false);
  });
  it('uses Taipei dates, holidays and after-close cutoff without calling a weekend stale',()=>{
    expect(alertFreshness(feed,new Date('2026-10-10T12:00:00Z'))).toBe('');
    expect(alertFreshness(feed,new Date('2026-10-12T10:00:00Z'))).toBe('');
    expect(alertFreshness(feed,new Date('2026-10-12T12:00:00Z'))).toContain('2026-10-12');
    expect(alertFreshness(feed,new Date('2027-01-04T12:00:00Z'))).toContain('尚未核對');
  });
  it('uses the backend official calendar for exceptional closures and newly supported years',()=>{
    const official={...feed,marketDate:'2027-07-08',calendarYears:[2027],closedDates:['2027-07-09']};
    expect(alertFreshness(official,new Date('2027-07-09T12:00:00Z'))).toBe('');
    expect(alertFreshness(official,new Date('2027-07-12T12:00:00Z'))).toContain('2027-07-12');
    expect(validateAlertFeed({...official,closedDates:['not-a-date']})).toBe(false);
  });
});
