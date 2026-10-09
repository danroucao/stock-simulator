// Execute the real keyless runner with synthetic HTTP responses in an isolated workspace.
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
await mkdir('tmp',{recursive:true});
const root=await mkdtemp(resolve('tmp/official-runner-')), runner=pathToFileURL(resolve('scripts/scan-market.mjs')).href;
const bootstrap=resolve(root,'bootstrap.mjs');
await writeFile(bootstrap,`
const symbols=Array.from({length:1001},(_,i)=>String(1000+i));
const OriginalDate=Date;
globalThis.Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:['2026-10-10T00:00:00Z']));}static now(){return new OriginalDate('2026-10-10T00:00:00Z').getTime();}};
globalThis.setTimeout=(callback,_delay,...args)=>{callback(...args);return 0;};
globalThis.fetch=async url=>{
 const u=new URL(url);if(process.env.FIXTURE_MODE==='quota')return new Response('{}',{status:429});
 let body;
 const iso=value=>value.includes('/')?value.replaceAll('/','-'):value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8);
 if(u.pathname.includes('t187ap03'))body=(u.pathname.includes('_L')?symbols.slice(0,600):symbols.slice(600)).map(symbol=>({'公司代號':symbol,'公司簡稱':'測試'+symbol}));
 else if(u.pathname.includes('holidaySchedule'))body={stat:'ok',queryYear:2026,data:[['2026-01-01','放假',''],['2026-01-02','開始交易',''],['2026-02-11','最後交易',''],['2026-02-12','結算',''],['2026-10-09','放假','']]};
 else if(u.pathname.includes('FMTQIK')){
   const first=iso(u.searchParams.get('date')), month=first.slice(0,7), cursor=new OriginalDate(first+'T00:00:00Z'), data=[];
   while(cursor.toISOString().startsWith(month)){const date=cursor.toISOString().slice(0,10);if(![0,6].includes(cursor.getUTCDay())&&date<='2026-10-08'&&date!=='2026-07-10')data.push([date]);cursor.setUTCDate(cursor.getUTCDate()+1);}
   body={stat:'OK',date:u.searchParams.get('date'),fields:['日期'],data};
 }else if(u.pathname.includes('MI_INDEX')||u.pathname.includes('dailyQuotes')){
   const date=iso(u.searchParams.get('date')), twse=u.pathname.includes('MI_INDEX');
   const rows=(twse?symbols.slice(0,600):symbols.slice(600)).map(symbol=>{const price=symbol==='1001'&&date==='2026-10-08'?25:50;return twse?[symbol,'測試','1000000','1','50000000',String(price),String(price+2),String(price-3),String(price),'+','0']:[symbol,'測試',String(price),'0',String(price),String(price+2),String(price-3),String(price),'1000000','50000000'];});
   body={stat:'ok',date:date.replaceAll('-',''),tables:[{fields:twse?['證券代號','證券名稱','成交股數','成交筆數','成交金額','開盤價','最高價','最低價','收盤價','漲跌(+/-)','漲跌價差']:['代號','名稱','收盤','漲跌','開盤','最高','最低','均價','成交股數','成交金額(元)'],data:rows}]};
 }else{
   const start=iso(u.searchParams.get('startDate')), end=iso(u.searchParams.get('endDate'));
   const table={fields:['資料日期','股票代號'],data:u.pathname.includes('TWT49U')?[[end,'1000']]:[]};
   body=u.hostname==='www.twse.com.tw'?{stat:'OK',strDate:(process.env.FIXTURE_MODE==='action-scope'?'20260101':start.replaceAll('-','')),endDate:end.replaceAll('-',''),...table}:{stat:'ok',date:start.replaceAll('-','')+'~'+end.replaceAll('-',''),tables:[{...table,totalCount:table.data.length}]};
 }
 return new Response(JSON.stringify(body));
};
await import(${JSON.stringify(runner)});
`);
const run=mode=>{try{return{ok:true,log:execFileSync(process.execPath,[bootstrap],{cwd:root,env:{...process.env,MARKET_DATA_PROVIDER:'official',FINMIND_API_TOKEN:'',FIXTURE_MODE:mode},encoding:'utf8',stdio:'pipe'})};}catch(error){return{ok:false,log:error.stdout+error.stderr};}};
const load=async path=>JSON.parse(await readFile(resolve(root,path),'utf8'));
const firstRun=run('ready');assert.ok(firstRun.ok,firstRun.log);
const first=await load('public/alerts/latest.json'), state=await readFile(resolve(root,'scan-data/state.json'),'utf8');
assert.equal(first.universeCount,1001);assert.equal(first.actionExcludedCount,2);assert.equal(first.events.length,999);assert.equal(first.priceBasis,'raw-action-screened');assert.equal(first.rules.version,'tw-daily-v2-official-safe');
assert.equal(first.stocks.find(s=>s.symbol==='1001').eligible,false);assert.ok(!first.events.some(e=>e.symbol==='1000'||e.symbol==='1001'));
const rerun=run('ready');assert.ok(rerun.ok,rerun.log);
const second=await load('public/alerts/latest.json');assert.deepEqual(second.events,first.events);assert.equal(await readFile(resolve(root,'scan-data/state.json'),'utf8'),state);
for(const mode of ['action-scope','quota']){
 const failure=run(mode);assert.equal(failure.ok,false);
 const preserved=await load('public/alerts/latest.json');assert.equal(preserved.status,'error');assert.deepEqual(preserved.events,second.events);assert.equal(preserved.scannedAt,second.scannedAt);assert.equal(await readFile(resolve(root,'scan-data/state.json'),'utf8'),state);
}
console.log('Official runner: keyless full-market results, corporate-action/unknown-price exclusions, persistent snapshots, rerun dedup, cache reuse and failure preservation passed.');
