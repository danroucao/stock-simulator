// Offline integration test. Executes the real runner in an isolated temporary workspace.
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
await mkdir('tmp',{recursive:true});
const root = await mkdtemp(resolve('tmp/scan-pipeline-'));
const runner = pathToFileURL(resolve('scripts/scan-market.mjs')).href;
const sessions=[], cursor=new Date('2026-10-08T00:00:00Z');
while(sessions.length<100) { if(![0,6].includes(cursor.getUTCDay())) sessions.unshift(cursor.toISOString().slice(0,10)); cursor.setUTCDate(cursor.getUTCDate()-1); }
const symbols=Array.from({length:1001},(_,i)=>String(1000+i));
const bootstrap=resolve(root,'bootstrap.mjs');
await writeFile(bootstrap,`
const sessions=${JSON.stringify(sessions)}, symbols=${JSON.stringify(symbols)};
let calls=0;
globalThis.fetch=async url=>{
  calls++;
  if(process.env.FIXTURE_MODE==='quota') return new Response('{}',{status:429});
  const u=new URL(url); let body;
  if(u.hostname==='openapi.twse.com.tw') body=symbols.slice(0,600).map(s=>({'公司代號':s,'公司簡稱':'測試'+s}));
  else if(u.hostname==='www.tpex.org.tw') body=symbols.slice(600).map(s=>({'公司代號':s,'公司簡稱':'測試'+s}));
  else if(u.searchParams.get('dataset')==='TaiwanStockTradingDate') body={status:200,data:sessions.map(date=>({date}))};
  else {
    const date=u.searchParams.get('start_date');
    const rows=(process.env.FIXTURE_MODE==='partial' ? symbols.slice(0,100) : symbols).map(stock_id=>({stock_id,date,open:50,max:52,min:47,close:50,Trading_Volume:1000000,Trading_money:50000000}));
    body={status:200,data:rows};
  }
  return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
};
await import(${JSON.stringify(runner)});
console.log('fixture calls='+calls);
`);
const run=mode=>{
  try { return {ok:true,log:execFileSync(process.execPath,[bootstrap],{cwd:root,env:{...process.env,MARKET_DATA_PROVIDER:'finmind',FINMIND_API_TOKEN:'offline-fixture-only',FIXTURE_MODE:mode},encoding:'utf8',stdio:'pipe'})}; }
  catch(error) { return {ok:false,log:error.stdout+error.stderr}; }
};
const initial=run('ready'); assert.ok(initial.ok,initial.log);
const load=async path=>JSON.parse(await readFile(resolve(root,path),'utf8'));
const first=await load('public/alerts/latest.json'), state=await readFile(resolve(root,'scan-data/state.json'),'utf8');
assert.equal(first.universeCount,1001); assert.equal(first.events.length,1001); assert.equal(first.status,'ready');
const rerun=run('ready'); assert.ok(rerun.ok,rerun.log);
const second=await load('public/alerts/latest.json'); assert.deepEqual(second.events,first.events);
assert.equal(await readFile(resolve(root,'scan-data/state.json'),'utf8'),state);
for(const mode of ['quota','partial']) {
  const failed=run(mode); assert.equal(failed.ok,false);
  const preserved=await load('public/alerts/latest.json');
  assert.equal(preserved.status,'error'); assert.equal(preserved.scannedAt,second.scannedAt);
  assert.deepEqual(preserved.events,second.events); assert.deepEqual(preserved.stocks,second.stocks);
  assert.equal(await readFile(resolve(root,'scan-data/state.json'),'utf8'),state);
}
console.log('Offline scan pipeline: full ordinary-stock registry → adjusted history → persistence → rerun dedup → quota/coverage failure preservation passed');
