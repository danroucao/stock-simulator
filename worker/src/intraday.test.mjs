import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIntradaySnapshot,inTaipeiTradingWindow,normalizeMisQuote,parseSymbols,provisionalEvents} from './intraday.js';

test('Taipei trading window and batch symbol validation are bounded',()=>{
 assert.equal(inTaipeiTradingWindow(new Date('2026-10-14T01:00:00Z')),true);
 assert.equal(inTaipeiTradingWindow(new Date('2026-10-14T05:36:00Z')),false);
 assert.deepEqual(parseSymbols('2330, 2353,2330'),['2330','2353']);
 assert.throws(()=>parseSymbols(Array.from({length:51},(_,i)=>String(1000+i)).join(',')),/1～50/);
});
test('MIS rows reject missing trades and provisional events use saved close ranges',()=>{
 const quote=normalizeMisQuote({c:'2353',n:'宏碁',d:'20261014',t:'10:00:00',z:'33.5',o:'32',h:'34',l:'31.5',y:'32',v:'100'});
 assert.equal(quote.volume,100000);
 assert.equal(normalizeMisQuote({c:'2353',d:'20261014',z:'-',o:'32',h:'34',l:'31'}),null);
 const events=provisionalEvents([{symbol:'2353',name:'宏碁',market:'twse',lower:29.65,upper:33.2}],[quote]);
 assert.equal(events[0].state,'盤中突破待收盤確認');
 assert.match(events[0].reason,/待收盤確認/);
});
test('full-market snapshot is shared through KV only after current-date coverage passes',async()=>{
 const stocks=Array.from({length:1001},(_,i)=>({symbol:String(1000+i),name:'測試'+i,market:i<600?'twse':'tpex',lower:40,upper:60}));
 const writes=[];
 const env={PUBLIC_MARKET_FEED_URL:'https://example.test/market.json',INTRADAY:{put:async(...args)=>writes.push(args)}};
 const fetchImpl=async url=>{
  const parsed=new URL(url);
  if(parsed.hostname==='example.test')return Response.json({schemaVersion:2,stocks});
  const symbols=parsed.searchParams.get('ex_ch').match(/\d{4,6}/g);
  return Response.json({msgArray:symbols.map(symbol=>({c:symbol,n:'測試',d:'20261014',t:'10:05:00',z:'50',o:'49',h:'51',l:'48',y:'49',v:'10'}))});
 };
 const snapshot=await buildIntradaySnapshot(env,new Date('2026-10-14T02:05:00Z'),fetchImpl);
 assert.equal(snapshot.coverage.valid,1001);
 assert.equal(writes.length,1);
 assert.equal(JSON.parse(writes[0][1]).quotes.length,1001);
});
