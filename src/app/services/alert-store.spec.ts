import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AlertStore, alertFreshness, validateAlertFeed } from './alert-store';
import { ALERT_RULES, AlertFeed } from './market-alerts';
const feed: AlertFeed = {schemaVersion:1,status:'ready',marketDate:'2026-10-08',scannedAt:'2026-10-08T11:30:00Z',universeCount:0,excludedCount:0,rules:ALERT_RULES,stocks:[],events:[]};
describe('alert result delivery and follow storage',()=>{
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
});
