import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeOfficialDate, parseDailyQuotes, parseCorporateActions, parseClosedDates, parseTradingMonth, loadOfficialMarket, ACTION_SOURCES } from './official-market-data.mjs';

const universe = new Map([['2330',{symbol:'2330',name:'台積電',market:'twse'}],['6182',{symbol:'6182',name:'合晶',market:'tpex'}]]);
const twseFields=['證券代號','證券名稱','成交股數','成交筆數','成交金額','開盤價','最高價','最低價','收盤價','漲跌(+/-)','漲跌價差'];
const tpexFields=['代號','名稱','收盤','漲跌','開盤','最高','最低','均價','成交股數','成交金額(元)'];
const quote=(market,date='2026-10-08',rows)=>({stat:'ok',date:date.replaceAll('-',''),tables:[{fields:market==='twse'?twseFields:tpexFields,data:rows||[market==='twse'?['2330','台積電','1,000,000','1','50,000,000','50','52','47','50','<p>-</p>','1']:['6182','合晶','50','-1.00','50','52','47','50','1,000,000','50,000,000']]}]});

test('official ROC, Chinese and Gregorian dates normalize with validity checks',()=>{
 for(const date of ['115/10/08','115年10月08日','1151008','20261008','2026-10-08']) assert.equal(normalizeOfficialDate(date),'2026-10-08');
 assert.throws(()=>normalizeOfficialDate('115/02/30'));
});
test('daily table headers establish units; ETF/warrants are excluded using the registry',()=>{
 const body=quote('twse');body.tables[0].data.push(['0050','ETF','1','1','1','1','1','1','1','+','0']);
 const listed=parseDailyQuotes(body,'twse','2026-10-08',universe), otc=parseDailyQuotes(quote('tpex'),'tpex','2026-10-08',universe);
 assert.equal(listed.rows.length,1);assert.equal(listed.rows[0].volume,1_000_000);assert.equal(otc.rows[0].volume,1_000_000);assert.equal(listed.rows[0].turnover,50_000_000);
 assert.equal(otc.rows[0].change,-1);assert.equal(listed.rows[0].change,-1);
 assert.throws(()=>parseDailyQuotes(body,'twse','2026-10-07',universe),/日期/);
});
test('unpriced but traded days are flagged instead of inventing a price or stopping every stock',()=>{
 const body=quote('twse');for(const index of [5,6,7,8])body.tables[0].data[0][index]='--';
 const row=parseDailyQuotes(body,'twse','2026-10-08',universe).rows[0];
 assert.equal(row.close,0);assert.equal(row.dataIssue,'有成交但未公告完整價格');
 body.tables[0].data[0][9]='<p>X</p>';
 assert.ok(parseDailyQuotes(body,'twse','2026-10-08',universe).rows[0].action);
 assert.throws(()=>parseDailyQuotes(quote('tpex','2026-10-08',[...quote('tpex').tables[0].data,...quote('tpex').tables[0].data]),'tpex','2026-10-08',universe),/重複/);
});
test('all corporate action feeds require exact query coverage and untruncated rows',()=>{
 const source=ACTION_SOURCES.find(s=>s.market==='tpex'&&s.kind.includes('面額'));
 const body={stat:'ok',date:'20260519~20261008',tables:[{fields:['恢復買賣日期','證券代號'],totalCount:1,data:[['1150810','6182']]}]};
 const actions=parseCorporateActions(body,source,'2026-05-19','2026-10-08',universe);
 assert.equal(actions[0].date,'2026-08-10');assert.equal(actions[0].kind,'面額變更／分割');
 body.tables[0].totalCount=2;assert.throws(()=>parseCorporateActions(body,source,'2026-05-19','2026-10-08',universe),/截斷/);
 body.tables[0].totalCount=1;body.date='20261008';assert.throws(()=>parseCorporateActions(body,source,'2026-05-19','2026-10-08',universe),/期間/);
});
test('official holidays exclude settlement-only and holiday days but keep first/last trading days',()=>{
 const body={stat:'ok',queryYear:2026,data:[['2026-01-01','放假',''],['2026-01-02','開始交易日',''],['2026-02-11','最後交易日',''],['2026-02-12','僅辦理結算',''],['2026-10-09','國慶日','']]};
 const closed=parseClosedDates(body,2026);assert.ok(closed.has('2026-02-12'));assert.ok(!closed.has('2026-01-02'));assert.ok(!closed.has('2026-02-11'));
 assert.throws(()=>parseClosedDates(body,2027),/確認/);
});
test('actual market statistics omit exceptional closures even when annual holidays do not',()=>{
 const body={stat:'OK',date:'20260701',fields:['日期'],data:[['115/07/09'],['115/07/13']]};
 assert.deepEqual(parseTradingMonth(body,'2026-07'),['2026-07-09','2026-07-13']);
 assert.throws(()=>parseTradingMonth(body,'2026-08'),/確認/);
});

test('keyless provider downloads both markets, validates all six action feeds, and reuses raw cache',async()=>{
 await mkdir('tmp',{recursive:true});const cacheRoot=await mkdtemp(resolve('tmp/official-fixture-'));
 const symbols=Array.from({length:1001},(_,i)=>String(1000+i));let requests=0;
 const fetchImpl=async url=>{
  requests++;const u=new URL(url);let body;
  if(u.pathname.includes('t187ap03')) {
    const stocks=u.pathname.includes('_L')?symbols.slice(0,600):symbols.slice(600);
    body=stocks.map(symbol=>({'公司代號':symbol,'公司簡稱':'測試'+symbol}));
  }else if(u.pathname.includes('holidaySchedule'))body={stat:'ok',queryYear:2026,data:[['2026-01-01','放假',''],['2026-01-02','開始交易',''],['2026-02-11','最後交易',''],['2026-02-12','結算',''],['2026-10-09','放假','']]};
  else if(u.pathname.includes('FMTQIK')) {
    const first=normalizeOfficialDate(u.searchParams.get('date')), month=first.slice(0,7), cursor=new Date(`${first}T00:00:00Z`), data=[];
    while(cursor.toISOString().startsWith(month)) {
      const date=cursor.toISOString().slice(0,10);
      if(![0,6].includes(cursor.getUTCDay()) && date<='2026-10-08' && date!=='2026-07-10')data.push([date]);
      cursor.setUTCDate(cursor.getUTCDate()+1);
    }
    body={stat:'OK',date:u.searchParams.get('date'),fields:['日期'],data};
  }
  else if(u.pathname.includes('MI_INDEX')||u.pathname.includes('dailyQuotes')) {
    const date=normalizeOfficialDate(u.searchParams.get('date')), market=u.pathname.includes('MI_INDEX')?'twse':'tpex';
    const stocks=market==='twse'?symbols.slice(0,600):symbols.slice(600);
    body=quote(market,date,stocks.map(symbol=>market==='twse'?[symbol,'測試','1000000','1','50000000','50','52','47','50','+','0']:[symbol,'測試','50','0','50','52','47','50','1000000','50000000']));
  }else{
    const start=normalizeOfficialDate(u.searchParams.get('startDate')),end=normalizeOfficialDate(u.searchParams.get('endDate'));
    const table={fields:['資料日期','股票代號'],data:u.pathname.includes('TWT49U')?[[start.replaceAll('-','/'),'1000']]:[]};
    body=u.hostname==='www.twse.com.tw'?{stat:'OK',strDate:start.replaceAll('-',''),endDate:end.replaceAll('-',''),...table}:{stat:'ok',date:start.replaceAll('-','')+'~'+end.replaceAll('-',''),tables:[{...table,totalCount:table.data.length}]};
  }
  return new Response(JSON.stringify(body));
 };
 const settings={cacheRoot,now:new Date('2026-10-10T00:00:00Z'),fetchImpl,log:()=>{},delayMs:0,historyCount:70};
 const first=await loadOfficialMarket(settings);assert.equal(first.universe.size,1001);assert.equal(first.sessions.length,70);assert.equal(first.metadata.priceBasis,'raw-action-screened');assert.equal(first.requests,153);assert.ok(first.all.get('1000')[0].action);assert.ok(!first.sessions.includes('2026-07-10'));assert.ok(first.metadata.closedDates.includes('2026-07-10'));
 const second=await loadOfficialMarket(settings);assert.equal(second.requests,17);assert.equal(second.cacheHits,136);assert.deepEqual(second.all,first.all);
});
