import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const feed=JSON.parse(await readFile('public/market/latest.json','utf8')),alerts=JSON.parse(await readFile('public/alerts/latest.json','utf8'));
// Optional independent pre-change baseline; absent on a fresh checkout.
let previous=null;
try { previous=JSON.parse(await readFile(process.env.MARKET_AUDIT_BASELINE||'tmp/full-market-before/alerts/latest.json','utf8')); }
catch(error) { if(error.code!=='ENOENT')throw error; }
assert.equal(new Set(feed.stocks.map(s=>s.symbol)).size,feed.coverage.total);assert.ok(feed.stocks.every(s=>s.industryCode!=='91'));
const average=a=>a.reduce((x,y)=>x+y,0)/a.length,near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-7,label+': '+a+' vs '+b);
const reference=JSON.parse(await readFile('public/alerts/history/1101.json','utf8')).bars.map(b=>b.date);
let checked=0;
for(const s of feed.stocks){const data=JSON.parse(await readFile('public/alerts/history/'+s.symbol+'.json','utf8'));assert.equal(data.symbol,s.symbol);assert.equal(data.version,alerts.historyVersion||`${alerts.rules.version}:${alerts.marketDate}:${alerts.scannedAt}`);assert.ok(data.bars.every(b=>b.date<=feed.date));
 for(const [key,n] of [['sma5',5],['sma60',60]]){const days=reference.slice(-n),bars=data.bars.filter(b=>days.includes(b.date)),valid=bars.length===n&&bars.every((b,i)=>b.date===days[i]&&Number.isFinite(b.close)&&b.close>0&&Number.isFinite(b.rawClose)&&b.rawClose>0&&(b.high<=0||b.high>=b.close)&&(b.low<=0||b.low<=b.close)&&(feed.basis==='adjusted'||!b.action));if(valid)near(s.metrics[key].value,average(bars.map(b=>b.close)),s.symbol+' '+key);else assert.equal(s.metrics[key].value,null,s.symbol+' unavailable '+key);checked++;}
 const sma5=s.metrics.sma5.value,sma60=s.metrics.sma60.value;if(sma5!==null&&sma60!==null)near(s.metrics.deviation.value,(sma5/sma60-1)*100,s.symbol+' deviation');
}
const total=feed.stocks.reduce((a,s)=>a+(s.metrics.turnover.value||0),0);near(feed.industryHeat.reduce((a,i)=>a+i.turnover,0),total,'industry sum');near(feed.industryHeat.reduce((a,i)=>a+i.share,0),100,'share sum');
for(const i of feed.industryHeat){near(i.share,i.turnover/total*100,i.industry+' share');if(i.turnover>0)near(i.concentration,i.top.reduce((a,s)=>a+s.turnover,0)/i.turnover*100,i.industry+' concentration');assert.equal(i.up+i.down+i.flat+i.unknown,i.total);if(i.averageShare===null)assert.equal(i.changePoints,null);}
if(previous)for(const e of previous.events)assert.deepEqual(alerts.events.find(n=>n.id===e.id),e,'historical event snapshot preserved');assert.equal(new Set(alerts.events.map(e=>e.id)).size,alerts.events.length);
const report={date:feed.date,coverage:feed.coverage,classified:feed.stocks.filter(s=>s.industry!=='未分類').length,categories:feed.industryHeat.length,indicatorChecks:checked,turnover:total,unavailableHeatComparisons:feed.industryHeat.filter(i=>i.changePoints===null).length,preservedEvents:previous?.events.length??null,newEvents:previous?alerts.events.length-previous.events.length:null};
await mkdir('tmp',{recursive:true});await writeFile('tmp/full-market-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
