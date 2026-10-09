import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { ALERT_RULES, scanStock } from '../src/app/services/market-alerts.ts';
import { loadOfficialMarket } from './official-market-data.mjs';

const output = 'public/alerts/latest.json', statePath = 'scan-data/state.json';
const read = async (path, fallback) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } };
const atomic = async (path, value) => { await mkdir(path.slice(0,path.lastIndexOf('/')), {recursive:true}); await writeFile(`${path}.tmp`, JSON.stringify(value)); await rename(`${path}.tmp`,path); };
const previous = await read(output, { schemaVersion:1, status:'unconfigured', marketDate:null, scannedAt:null, universeCount:0, excludedCount:0, stocks:[], events:[], rules:ALERT_RULES });
const attemptedAt = new Date().toISOString();
let requestCount = 0;
async function json(url, token) {
  const target = new URL(url), source = `${target.hostname}${target.pathname}${target.searchParams.has('dataset') ? ' ['+target.searchParams.get('dataset')+']' : ''}`;
  if (++requestCount > 260) throw new Error('本次掃描超過 260 次請求預算，保留上次結果');
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {headers:{Accept:'application/json', 'User-Agent':'stock-alert-center/1.0', ...(token ? {Authorization:`Bearer ${token}`} : {})}, signal:AbortSignal.timeout(30000)});
    if ([401,402,403,429].includes(response.status)) throw new Error(`${source}：權限或配額不足（${response.status}）`);
    if (response.status >= 500 && attempt < 2) { await new Promise(r=>setTimeout(r, 1000*(attempt+1))); continue; }
    if (!response.ok) {
      let diagnostic = '';
      try { const detail = await response.json(); diagnostic = String(detail.msg || detail.message || '').slice(0,240); } catch {}
      if (token) diagnostic = diagnostic.replaceAll(token,'***');
      throw new Error(`${source}：HTTP ${response.status}${diagnostic ? '；'+diagnostic : ''}`);
    }
    const body = await response.json();
    if (body.status && body.status !== 200) throw new Error(`FinMind 回傳 ${body.status}，掃描停止`);
    return body;
  }
  throw new Error('行情來源暫時不可用');
}
async function finmind(dataset, params = {}) {
  const url = new URL('https://api.finmindtrade.com/api/v4/data');
  url.search = new URLSearchParams({dataset,...params}).toString();
  const response = await json(url, process.env.FINMIND_API_TOKEN);
  if (!Array.isArray(response.data) || !response.data.length) throw new Error(`${dataset} 未提供資料；本次不覆蓋成功結果`);
  return response.data;
}
try {
  const provider = process.env.MARKET_DATA_PROVIDER || 'official';
  if (!['official','finmind'].includes(provider)) throw new Error('MARKET_DATA_PROVIDER 僅支援 official 或 finmind');
  let universe, sessions, all, metadata;
  const rules = provider === 'official' ? {...ALERT_RULES,version:'tw-daily-v2-official-safe'} : ALERT_RULES;
  if (provider === 'official') {
    const loaded = await loadOfficialMarket();
    ({universe,sessions,all,metadata} = loaded); requestCount = loaded.requests;
  } else {
  if (!process.env.FINMIND_API_TOKEN) throw new Error('尚未設定 FINMIND_API_TOKEN；FinMind 模式需要整批還原行情權限');
  // Authoritative company registries: ETF, warrants and indices are not companies.
  console.log('取得上市普通股公司名冊');
  const listed = await json('https://openapi.twse.com.tw/v1/opendata/t187ap03_L');
  console.log('取得上櫃普通股公司名冊');
  const otc = await json('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O');
  if (!Array.isArray(listed) || !Array.isArray(otc) || listed.length < 500 || otc.length < 300) throw new Error('上市／上櫃普通股公司名冊不完整');
  universe = new Map();
  for (const [rows, market] of [[listed,'twse'],[otc,'tpex']]) for (const item of rows) {
    const symbol = String(item['公司代號'] ?? item['SecuritiesCompanyCode'] ?? '').trim();
    const name = String(item['公司簡稱'] ?? item['CompanyAbbreviation'] ?? item['公司名稱'] ?? '').trim();
    if (/^[1-9]\d{3}$/.test(symbol) && name) universe.set(symbol,{symbol,name,market});
  }
  if (universe.size < 1000) throw new Error('無法解析完整普通股名冊');
  const taipeiDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
  const taipeiHour = Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
  console.log('取得 FinMind 交易日曆');
  sessions = [...new Set((await finmind('TaiwanStockTradingDate')).map(r=>r.date))].filter(d => d < taipeiDate || d === taipeiDate && taipeiHour >= 19).sort().slice(-100);
  if (sessions.length < 100) throw new Error('交易日曆不足 100 日');
  const expectedMarketDate = sessions.at(-1);
  all = new Map([...universe.keys()].map(s=>[s,[]]));
  // Refetch the rolling window: historical adjustment factors can change on corporate actions.
  // Never cache adjusted prices across successful scan dates without refreshing their basis.
  for (const date of sessions) {
    if (date === sessions[0] || date === expectedMarketDate) console.log(`取得 ${date} 的全市場還原與原始行情`);
    const adjusted = await finmind('TaiwanStockPriceAdj',{start_date:date,end_date:date});
    const raw = await finmind('TaiwanStockPrice',{start_date:date,end_date:date});
    const rawMap = new Map(raw.filter(r=>r.date===date).map(r=>[r.stock_id,r]));
    const seen = new Set();
    for (const r of adjusted.filter(r=>r.date===date && universe.has(r.stock_id))) {
      if (seen.has(r.stock_id)) throw new Error('還原行情包含重複日期');
      seen.add(r.stock_id);
      const actual = rawMap.get(r.stock_id); if (!actual) continue;
      if (![r.open,r.max,r.min,r.close,actual.close,actual.Trading_Volume,actual.Trading_money].every(v=>typeof v==='number' && Number.isFinite(v)))
        throw new Error(`交易日 ${date} 有無效行情欄位，保留上次成功結果`);
      all.get(r.stock_id).push({date,open:r.open,high:r.max,low:r.min,close:r.close,rawClose:actual.close,volume:actual.Trading_Volume,turnover:actual.Trading_money});
    }
    // A near-empty date is an upstream incident, not a mass delisting event.
    if (seen.size < universe.size * .8) throw new Error(`交易日 ${date} 行情覆蓋不足 80%，保留上次成功結果`);
  }
  metadata = {dataSource:'FinMind 還原日線',priceBasis:'adjusted'};
  }
  const expectedMarketDate = sessions.at(-1);
  const saved = await read(statePath,{version:rules.version,stocks:{}});
  if (saved.version !== rules.version || previous.scannedAt && previous.rules.version !== rules.version) throw new Error('規則或價格基準已變更；請先備份並重建掃描狀態，不混用舊價格基準');
  const stocks = [], newEvents = [], nextState = {version:rules.version,stocks:{}};
  for (const stock of universe.values()) {
    const result = scanStock(stock,all.get(stock.symbol),sessions,saved.stocks[stock.symbol],rules);
    if (provider==='official' && result.row) result.row.history=result.row.eligible ? result.row.history.slice(-70) : [];
    nextState.stocks[stock.symbol] = result.state;
    if (result.row) stocks.push(result.row);
    newEvents.push(...result.events);
  }
  const events = [...new Map([...previous.events,...newEvents].map(e=>[e.id,e])).values()].sort((a,b)=>b.date.localeCompare(a.date));
  for (const stock of stocks) stock.eventDate = events.find(e=>e.symbol===stock.symbol)?.date || stock.range?.date || stock.date;
  const result = {schemaVersion:1,status:'ready',marketDate:expectedMarketDate,expectedMarketDate,scannedAt:new Date().toISOString(),attemptedAt,
    universeCount:universe.size,excludedCount:universe.size-stocks.filter(s=>s.eligible).length,rules,stocks,events,...metadata,
    actionExcludedCount:stocks.filter(s=>s.exclusion?.includes('價格基準異動')).length};
  // Workflow publishes both files in one commit; a failed process cannot publish a partial pair.
  await atomic(statePath,nextState); await atomic(output,result);
  console.log(`掃描完成：${universe.size} 檔普通股、${newEvents.length} 個事件，行情 ${expectedMarketDate}，${requestCount} 次請求`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await atomic(output,{...previous,status:previous.scannedAt ? 'error' : 'unconfigured',attemptedAt,message});
  console.error(message); process.exitCode = 1;
}
