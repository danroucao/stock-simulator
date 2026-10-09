// Independent arithmetic audit of the real committed snapshot, no scanner helpers.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const feed=JSON.parse(await readFile('public/alerts/latest.json','utf8'));
const average=a=>a.reduce((x,y)=>x+y,0)/a.length;
const close=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-8,label);
const counts={price:0,history:0,liquidity:0,missing:feed.universeCount-feed.stocks.length,unknownPrice:0};
const verified=[];
for(const stock of feed.stocks){
 if(!stock.eligible){const r=stock.exclusion || stock.reason;if(r.includes('價格基準')){counts.price++;if(r.includes('未確認') && !/除權息|減資|面額變更|分割/.test(r))counts.unknownPrice++;}else if(r.includes('歷史不足'))counts.history++;else if(/流動性|無成交/.test(r))counts.liquidity++;else counts.missing++;continue;}
 const bars=stock.history,sma5=average(bars.slice(-5).map(b=>b.close)),sma60=average(bars.slice(-60).map(b=>b.close));
 assert.equal(bars.length,70);close(stock.sma5,sma5,stock.symbol+' SMA5');close(stock.sma60,sma60,stock.symbol+' SMA60');close(stock.deviation,(sma5/sma60-1)*100,stock.symbol+' deviation');
 close(stock.volumeRatio,bars.at(-1).volume/average(bars.slice(-21,-1).map(b=>b.volume)),stock.symbol+' volume');
 const series=bars.slice(-45),values=series.map(b=>b.close),mean=average(values),width=Math.max(...series.map(b=>b.high))/Math.min(...series.map(b=>b.low))-1;
 let xy=0,xx=0;for(let i=0;i<45;i++){xy+=(i-22)*(values[i]-mean);xx+=(i-22)**2;}
 const trend=xy/xx*44/mean,smaChange=sma60/average(bars.slice(-70,-10).map(b=>b.close))-1;
 if(stock.range?.date===feed.marketDate){assert.ok(width<=feed.rules.maxWidth+1e-10 && Math.abs(trend)<=feed.rules.maxTrend+1e-10 && Math.abs(smaChange)<=feed.rules.maxSmaChange+1e-10,stock.symbol+' three conditions');}
 verified.push({symbol:stock.symbol,sma5,sma60,deviation:stock.deviation,width,trend,smaChange});
}
assert.equal(Object.values(counts).slice(0,4).reduce((a,b)=>a+b,0),feed.excludedCount);
assert.equal(new Set(feed.events.map(e=>e.id)).size,feed.events.length);
const cacheRoot=process.argv[2];let cacheVerified=0;
if(cacheRoot){for(const row of verified){const stock=feed.stocks.find(s=>s.symbol===row.symbol);for(const bar of stock.history){const file=JSON.parse(await readFile(`${cacheRoot}/${stock.market}-${bar.date}.json`,'utf8'));const raw=file.rows.find(r=>r.symbol===stock.symbol);assert.ok(raw);close(bar.close,raw.close,'cache '+stock.symbol+' '+bar.date);cacheVerified++;}}}
const report={marketDate:feed.marketDate,scannedAt:feed.scannedAt,universe:feed.universeCount,eligible:verified.length,exclusions:counts,eventCount:feed.events.length,cachePricesVerified:cacheVerified,allEventsOnMarketDate:feed.events.every(e=>e.date===feed.marketDate),examples:verified.filter(r=>['2353','2330'].includes(r.symbol)).concat(verified.slice(0,3))};
await mkdir('tmp',{recursive:true});await writeFile('tmp/alert-arithmetic-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
