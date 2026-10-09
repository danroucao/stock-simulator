import {TestBed} from '@angular/core/testing';
import {AlertCenter} from './alert-center';
import {AlertStore} from '../../services/alert-store';
import {ALERT_RULES,AlertFeed,AlertStock} from '../../services/market-alerts';
import {vi} from 'vitest';
describe('alert list transitions',()=>{
 it('switches lists synchronously and limits each new view to twenty rows',()=>{
  localStorage.clear();const store=TestBed.inject(AlertStore);vi.spyOn(store,'load').mockResolvedValue();
  const stocks=Array.from({length:25},(_,i)=>({symbol:String(1000+i),name:'測試',market:'twse',eligible:true,kinds:['整理觀察'],history:[],close:50,upper:52,turnover:i+1,date:'2026-10-08',eventDate:'2026-10-08',ratio:1,status:'整理中',reason:'整理觀察',sma5:50,sma60:50,deviation:0,smaDirection:'持平',volumeRatio:1} as AlertStock));
  store.feed.set({schemaVersion:1,status:'ready',marketDate:'2026-10-08',scannedAt:'2026-10-08T12:00:00Z',universeCount:25,excludedCount:0,rules:ALERT_RULES,stocks,events:[]} as AlertFeed);
  const component=TestBed.createComponent(AlertCenter).componentInstance;
  expect(component.rows()).toHaveLength(0);component.selectTab('current');expect(component.visibleRows()).toHaveLength(20);
  component.limit.update(component.more);expect(component.visibleRows()).toHaveLength(25);
  store.toggle(stocks[0]);component.selectTab('follows');expect(component.visibleRows().map(s=>s.symbol)).toEqual(['1000']);
  component.selectTab('new');expect(component.visibleRows()).toHaveLength(0);
  component.selectTab('current');expect(component.visibleRows()).toHaveLength(20);expect(component.count('整理觀察')).toBe(25);
  component.deviationFilter.set('low');expect(component.rows()).toHaveLength(0);
 });
});
