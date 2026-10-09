import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeFinMind, formatReport, inspectRows, compareRows } from './probe-finmind-access.mjs';

const sessions = [], cursor = new Date('2026-10-08T00:00:00Z');
while (sessions.length < 100) { if (![0,6].includes(cursor.getUTCDay())) sessions.unshift(cursor.toISOString().slice(0,10)); cursor.setUTCDate(cursor.getUTCDate()-1); }
const bars = symbol => sessions.map(date => ({ date, stock_id:symbol, open:50, max:52, min:47, close:50, Trading_Volume:1_000_000, Trading_money:50_000_000 }));
function source(allowSingle) {
  let calls=0;
  return { fetchImpl:async url => {
    calls++;
    const u=new URL(url), dataset=u.searchParams.get('dataset'), symbol=u.searchParams.get('data_id');
    const denied = dataset === 'TaiwanStockPriceAdj' && (!allowSingle || !symbol);
    const body = denied ? {status:400,msg:'Your level is register. example-secret',data:[]} : {status:200,msg:'success',data:dataset==='TaiwanStockTradingDate'?sessions.map(date=>({date})):bars(symbol)};
    return new Response(JSON.stringify(body),{status:denied?400:200});
  }, getCalls:()=>calls };
}
test('single-stock permission can be tested independently of a denied bulk endpoint',async()=>{
  const mock=source(true), result=await probeFinMind({token:'example-secret',fetchImpl:mock.fetchImpl,now:new Date('2026-10-10T00:00:00Z')});
  assert.equal(result.singleStockUsable,true); assert.equal(mock.getCalls(),6);
  assert.equal(result.checks.at(-1).accessible,false);
  assert.equal(result.comparisons.every(c=>c.completeRecent70Sessions),true);
  assert.ok(!JSON.stringify(result).includes('example-secret'));
  assert.ok(!formatReport(result).includes('example-secret'));
});
test('registered token denial is reported for both stocks without pretending adjusted data exists',async()=>{
  const mock=source(false), result=await probeFinMind({token:'example-secret',fetchImpl:mock.fetchImpl,now:new Date('2026-10-10T00:00:00Z')});
  assert.equal(result.singleStockUsable,false); assert.equal(result.checks.filter(c=>c.dataset==='TaiwanStockPriceAdj').every(c=>!c.accessible),true);
  assert.equal(result.comparisons.every(c=>!c.usable),true);
});
test('a missing secret makes no network requests',async()=>{
  const result=await probeFinMind({token:'',fetchImpl:()=>{throw new Error('Network should not run');}});
  assert.equal(result.requests,0); assert.equal(result.tokenConfigured,false);
});
test('OHLCV inspection catches wrong symbols, duplicate dates and invalid prices',()=>{
  const rows=bars('2330');
  assert.equal(inspectRows(rows,'2330',sessions[0],sessions.at(-1)).valid,true);
  assert.equal(inspectRows([...rows,rows[0]],'2330',sessions[0],sessions.at(-1)).valid,false);
  assert.equal(inspectRows(rows,'6182',sessions[0],sessions.at(-1)).valid,false);
  assert.equal(inspectRows([{...rows[0],min:60}],'2330',sessions[0],sessions.at(-1)).valid,false);
});
test('adjusted OHLC factors are compared consistently while keeping real volume and turnover',()=>{
  const raw=bars('2330'), adjusted=raw.map(row=>({...row,open:row.open/2,max:row.max/2,min:row.min/2,close:row.close/2}));
  assert.deepEqual(compareRows(raw,adjusted),{commonRows:100,adjustedRows:100,inconsistentRows:0});
  adjusted[0].Trading_Volume *= 2;
  assert.equal(compareRows(raw,adjusted).inconsistentRows,1);
});
