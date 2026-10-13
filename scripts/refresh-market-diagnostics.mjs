// Rebuild only comparison diagnostics from already saved REAL snapshots and symbol histories.
// Keeps quote dates, scan times and indicator values; never downloads or invents classifications.
import {readFile,writeFile} from 'node:fs/promises';
import {heatComparison} from '../src/app/services/market-heat-comparison.ts';
import {industryHeat} from '../src/app/services/market-analysis.ts';
const path='public/market/latest.json',feed=JSON.parse(await readFile(path,'utf8'));
const all=new Map(await Promise.all(feed.stocks.map(async stock=>{
 const history=JSON.parse(await readFile('public/alerts/history/'+stock.symbol+'.json','utf8'));
 return [stock.symbol,history.bars.filter(b=>b.date<=feed.date)];
})));
const sessions=[...new Set([...all.values()].flatMap(bars=>bars.map(b=>b.date)))].sort();
const snapshots=await Promise.all(sessions.slice(-21,-1).map(async date=>{try{return JSON.parse(await readFile('public/market/snapshots/'+date+'.json','utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}));
const comparison=heatComparison(feed.stocks,all,sessions,[...snapshots,feed]);
const updated={...feed,heatComparison:comparison,industryHeat:industryHeat(feed.stocks,all,sessions,comparison),historyComparable:comparison.available};
await writeFile(path,JSON.stringify(updated));
await writeFile('public/market/snapshots/'+feed.date+'.json',JSON.stringify(updated));
console.log(JSON.stringify({date:feed.date,scannedAt:feed.scannedAt,missingClassificationDates:comparison.issues.filter(i=>i.reason.includes('缺少該交易日')).map(i=>i.date),comparisonStocks:comparison.symbols.length,available:comparison.available},null,2));
