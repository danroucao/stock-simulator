import {describe,it,expect} from 'vitest';
import {exclusionSummary,upperDistance} from './alert-presentation';
import {AlertFeed,AlertStock} from './market-alerts';
describe('alert presentation',()=>{
 it('counts each excluded symbol once including missing registry rows',()=>{
  const feed={universeCount:7,stocks:[{eligible:true},{eligible:false,exclusion:'價格基準異動、資料缺漏'},{eligible:false,exclusion:'歷史不足 70 個交易日'},{eligible:false,exclusion:'近 45 日平均成交金額低於流動性門檻'},{eligible:false,exclusion:'近 45 個交易日有無成交日'},{eligible:false,exclusion:'資料不完整'}]} as AlertFeed;
  expect(exclusionSummary(feed)).toEqual({price:1,history:1,liquidity:2,missing:2});
 });
 it('uses the saved observation upper bound and hides ineligible or already broken ranges',()=>{
  const stock={eligible:true,close:50,upper:52} as AlertStock;
  expect(upperDistance(stock)).toBeCloseTo(4);expect(upperDistance({...stock,close:52})).toBe(0);
  expect(upperDistance({...stock,close:53})).toBeUndefined();expect(upperDistance({...stock,eligible:false})).toBeUndefined();
 });
});
