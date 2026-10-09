import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

export const OFFICIAL_SOURCE_VERSION = 1;
export const ACTION_SOURCES = [
  { market:'twse', kind:'除權息', path:'https://www.twse.com.tw/rwd/zh/exRight/TWT49U' },
  { market:'twse', kind:'減資', path:'https://www.twse.com.tw/rwd/zh/reducation/TWTAUU' },
  { market:'twse', kind:'面額變更／分割', path:'https://www.twse.com.tw/rwd/zh/change/TWTB8U' },
  { market:'tpex', kind:'除權息', path:'https://www.tpex.org.tw/www/zh-tw/bulletin/exDailyQ' },
  { market:'tpex', kind:'減資', path:'https://www.tpex.org.tw/www/zh-tw/bulletin/revivt' },
  { market:'tpex', kind:'面額變更／分割', path:'https://www.tpex.org.tw/www/zh-tw/bulletin/pvChgRslt' },
];
const noData = text => /沒有符合條件|查無資料|無符合|no data/i.test(String(text));
const day = date => date.replaceAll('-','');
const slash = date => date.replaceAll('-','/');
const stripped = value => String(value ?? '').replace(/<[^>]*>/g,'').replace(/&nbsp;|\s/g,'').trim();

export function normalizeOfficialDate(value) {
  const text = stripped(value);
  const match = /^(\d{3,4})(?:年|[-/])?(\d{2})(?:月|[-/])?(\d{2})日?$/.exec(text);
  if (!match) throw new Error(`官方日期格式不符：${text.slice(0,24)}`);
  const year = Number(match[1]) + (match[1].length === 3 ? 1911 : 0);
  const date = `${year}-${match[2]}-${match[3]}`;
  if (!Number.isFinite(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) !== date) throw new Error('官方日期無效');
  return date;
}
function numeric(value) {
  const text = stripped(value).replaceAll(',','');
  if (/^(?:|--+|N\/A|null)$/i.test(text)) return null;
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) throw new Error('官方行情數值欄位格式改變');
  const number = Number(text); if (!Number.isFinite(number)) throw new Error('官方行情數值無效');
  return number;
}
function field(fields, names) {
  const index = fields.findIndex(value => names.includes(stripped(value)));
  if (index < 0) throw new Error(`官方表格缺少欄位 ${names[0]}`);
  return index;
}
function successful(body) {
  return typeof body?.stat === 'string' && body.stat.toLowerCase() === 'ok';
}
export function parseCompanyRegistry(body, market) {
  if (!Array.isArray(body) || body.length < (market==='twse' ? 500 : 300)) throw new Error(`${market} 公司名冊不足`);
  const stocks = new Map();
  for (const row of body) {
    const symbol = stripped(row['公司代號'] ?? row.SecuritiesCompanyCode);
    const name = String(row['公司簡稱'] ?? row.CompanyAbbreviation ?? '').trim();
    if (/^[1-9]\d{3}$/.test(symbol) && name) stocks.set(symbol,{symbol,name,market});
  }
  if (stocks.size < (market==='twse' ? 500 : 300)) throw new Error(`${market} 普通股名冊無法解析`);
  return stocks;
}
export function parseDailyQuotes(body, market, date, universe) {
  if (noData(body?.stat)) return { empty:true, rows:[] };
  if (!successful(body) || !Array.isArray(body.tables) || normalizeOfficialDate(body.date) !== date) throw new Error(`${market} ${date} 行情日期或回應不符`);
  const table = body.tables.find(table => Array.isArray(table.fields) && table.fields.some(value => ['證券代號','代號'].includes(stripped(value))));
  if (!table || !Array.isArray(table.data)) throw new Error(`${market} 行情表格不存在`);
  if (table.totalCount !== undefined && table.totalCount !== table.data.length) throw new Error(`${market} 行情被分頁或截斷`);
  const f=table.fields, indexes={symbol:field(f,['證券代號','代號']),open:field(f,['開盤價','開盤']),high:field(f,['最高價','最高']),low:field(f,['最低價','最低']),close:field(f,['收盤價','收盤']),volume:field(f,['成交股數']),turnover:field(f,['成交金額','成交金額(元)'])};
  const changeIndex = field(f,market==='twse' ? ['漲跌價差'] : ['漲跌']);
  const signIndex = market==='twse' ? field(f,['漲跌(+/-)']) : -1;
  const rows=[], seen=new Set();
  for(const values of table.data) {
    const symbol=stripped(values[indexes.symbol]);
    if (!universe.has(symbol) || universe.get(symbol).market!==market) continue;
    if (seen.has(symbol)) throw new Error(`${market} ${date} 股票行情重複`);
    seen.add(symbol);
    const volume=numeric(values[indexes.volume]), turnover=numeric(values[indexes.turnover]);
    if (volume===null || turnover===null || volume<0 || turnover<0) throw new Error('官方成交量值無效');
    const prices={open:numeric(values[indexes.open]),high:numeric(values[indexes.high]),low:numeric(values[indexes.low]),close:numeric(values[indexes.close])};
    const priceUnavailable=Object.values(prices).some(value=>value===null) && volume>0;
    for(const key of Object.keys(prices)) prices[key] ??= 0;
    const changeText=stripped(values[changeIndex]);
    const sign=signIndex>=0 ? stripped(values[signIndex]) : '';
    let change=null, action;
    if (market==='twse') {
      if (['+','-',''].includes(sign) && /^(?:\d+(?:\.\d+)?|--+|)$/.test(changeText)) {
        const amount=numeric(changeText); change=amount===null ? null : amount*(sign==='-' ? -1 : 1);
      } else action='未確認價格基準異動';
    } else if (/^[+-]?\d+(?:\.\d+)?$/.test(changeText)) change=Number(changeText);
    else if (volume>0) action='未確認價格基準異動';
    rows.push({symbol,date,...prices,rawClose:prices.close,volume,turnover,change,...(action ? {action} : {}),...(priceUnavailable ? {dataIssue:'有成交但未公告完整價格'} : {})});
  }
  if (!rows.length) return {empty:true,rows:[]};
  return {empty:false,rows};
}
export function parseCorporateActions(body, source, startDate, endDate, universe) {
  if (!successful(body)) throw new Error(`${source.market} ${source.kind} 公司行動資料失敗`);
  if (source.market==='twse') {
    const start=body.strDate ?? body.params?.startDate, end=body.endDate ?? body.params?.endDate;
    if (start!==day(startDate) || end!==day(endDate)) throw new Error('公司行動查詢期間不符');
  } else if (body.date!==`${day(startDate)}~${day(endDate)}`) throw new Error('上櫃公司行動查詢期間不符');
  const table=source.market==='twse' ? body : body.tables?.[0];
  if (!table || !Array.isArray(table.fields) || !Array.isArray(table.data)) throw new Error('公司行動欄位或資料不完整');
  if (table.totalCount!==undefined && table.totalCount!==table.data.length) throw new Error('公司行動資料被分頁或截斷');
  const symbolIndex=field(table.fields,['股票代號','代號','證券代號']), dateIndex=field(table.fields,['資料日期','除權息日期','恢復買賣日期']);
  const actions=[];
  for(const values of table.data) {
    const symbol=stripped(values[symbolIndex]);
    if (!universe.has(symbol) || universe.get(symbol).market!==source.market) continue;
    const date=normalizeOfficialDate(values[dateIndex]);
    if (date<startDate || date>endDate) throw new Error('公司行動日期超出查詢期間');
    actions.push({symbol,date,kind:source.kind,source:source.path});
  }
  return actions;
}
export function parseClosedDates(body, year) {
  if (!successful(body) || Number(body.queryYear)!==year || !Array.isArray(body.data) || body.data.length<5) throw new Error(`${year} 官方休市日曆無法確認`);
  const dates=new Set();
  for(const row of body.data) {
    const date=normalizeOfficialDate(row[0]);
    if (!date.startsWith(`${year}-`)) throw new Error('日曆年度不符');
    if (/開始交易|最後交易/.test(`${row[1]} ${row[2]}`)) continue;
    dates.add(date);
  }
  return dates;
}
export function parseTradingMonth(body, month) {
  if (noData(body?.stat)) return [];
  if (!successful(body) || !Array.isArray(body.fields) || !Array.isArray(body.data) || normalizeOfficialDate(body.date)!==`${month}-01`) throw new Error(`${month} 官方歷史交易日無法確認`);
  const index=field(body.fields,['日期']), dates=new Set();
  for(const row of body.data) {
    const date=normalizeOfficialDate(row[index]);
    if(!date.startsWith(month) || dates.has(date)) throw new Error('官方歷史交易日月份錯誤或重複');
    dates.add(date);
  }
  return [...dates].sort();
}
const getSaved = async path => { try { return JSON.parse(await readFile(path,'utf8')); } catch(error) { if(error.code==='ENOENT') return null; throw error; } };
const save = async (path,value) => { await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path+'.tmp',JSON.stringify(value));await rename(path+'.tmp',path); };

export async function loadOfficialMarket({ cacheRoot='scan-data/official', now=new Date(), fetchImpl=globalThis.fetch, log=console.log, delayMs=1000, historyCount=100 }={}) {
  if (historyCount<70 || historyCount>100) throw new Error('官方歷史需 70～100 個交易日');
  let requests=0, cacheHits=0;
  async function json(url) {
    const label=new URL(url);
    for(let attempt=0;attempt<3;attempt++) {
      if (++requests>340) throw new Error('官方來源超過本次 340 次請求預算');
      if (requests>1 && delayMs) await new Promise(resolve=>setTimeout(resolve,delayMs));
      let response;
      try { response=await fetchImpl(url,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)}); }
      catch(error) { if(attempt<2) continue;throw new Error(`${label.hostname}${label.pathname} 連線失敗或逾時`); }
      if ([429,403].includes(response.status)) throw new Error(`${label.hostname} 限速或拒絕請求（${response.status}），保留上次結果`);
      if (response.status>=500 && attempt<2) continue;
      if (!response.ok) throw new Error(`${label.hostname}${label.pathname} HTTP ${response.status}`);
      try { return await response.json(); } catch {
        if (attempt<2) { log(`${label.hostname} 暫時未回傳 JSON，延後重試`);if(delayMs)await new Promise(resolve=>setTimeout(resolve,5000*(attempt+1)));continue; }
        throw new Error(`${label.hostname}${label.pathname}（${label.searchParams.get('date') || ''}）不是 JSON，可能格式改變或流量限制`);
      }
    }
    throw new Error('官方資料來源失敗');
  }
  log('取得 TWSE／TPEx 官方普通股名冊');
  const listed=parseCompanyRegistry(await json('https://openapi.twse.com.tw/v1/opendata/t187ap03_L'),'twse');
  const otc=parseCompanyRegistry(await json('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'),'tpex');
  const universe=new Map([...listed,...otc]);
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(now);
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',hourCycle:'h23'}).format(now));
  const cursor=new Date(`${today}T00:00:00Z`);if(hour<19)cursor.setUTCDate(cursor.getUTCDate()-1);
  const calendars=new Map(), planned=[];
  for(let offset=0;offset<366 && planned.length<historyCount;offset++) {
    const date=cursor.toISOString().slice(0,10), year=cursor.getUTCFullYear();
    if (!calendars.has(year)) calendars.set(year,parseClosedDates(await json(`https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json&queryYear=${year-1911}`),year));
    if(![0,6].includes(cursor.getUTCDay()) && !calendars.get(year).has(date)) planned.unshift(date);
    cursor.setUTCDate(cursor.getUTCDate()-1);
  }
  if (planned.length<historyCount) throw new Error('官方交易日曆歷史不足');
  const expectedMarketDate=planned.at(-1), historicalDates=new Set();
  const monthCursor=new Date(`${today.slice(0,7)}-01T00:00:00Z`);
  // Annual holidays cannot capture exceptional closures. Actual market statistics establish sessions.
  for(let index=0;index<12 && historicalDates.size<historyCount;index++) {
    const month=monthCursor.toISOString().slice(0,7);
    const dates=parseTradingMonth(await json(`https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${month.replace('-','')}01&response=json`),month);
    if(index>0 && !dates.length) throw new Error(`${month} 歷史成交統計缺漏，不能推算交易日`);
    for(const date of dates) if(date<=expectedMarketDate)historicalDates.add(date);
    monthCursor.setUTCMonth(monthCursor.getUTCMonth()-1);
  }
  const sessions=[...historicalDates].sort().slice(-historyCount);
  if(sessions.length<historyCount)throw new Error('官方歷史成交統計不足 100 個交易日');
  const target=sessions.at(-1), start=sessions[0];
  log(`官方日線範圍 ${start}～${target}，${historyCount} 個交易日`);
  const actions=[];
  for(const source of ACTION_SOURCES) {
    log(`核對 ${source.market} ${source.kind} 歷史資料`);
    const url=new URL(source.path);
    url.search=new URLSearchParams({startDate:source.market==='twse'?day(start):slash(start),endDate:source.market==='twse'?day(target):slash(target),response:'json'}).toString();
    const body=await json(url);
    try { actions.push(...parseCorporateActions(body,source,start,target,universe)); }
    catch(error) { throw new Error(`${source.market} ${source.kind}：${error.message}`); }
  }
  log(`六項官方公司行動資料完成，共 ${actions.length} 筆普通股事件`);
  const all=new Map([...universe.keys()].map(symbol=>[symbol,[]]));
  for(const date of sessions) {
    for(const market of ['twse','tpex']) {
      const cachePath=resolve(cacheRoot,`${market}-${date}.json`), saved=await getSaved(cachePath);
      let rows;
      // Refresh the latest two sessions for late official corrections; older raw prices do not rebase.
      if (date<sessions.at(-2) && saved?.schemaVersion===OFFICIAL_SOURCE_VERSION && saved.date===date && saved.market===market && Array.isArray(saved.rows)) {
        rows=saved.rows;cacheHits++;
        if(rows.some(row=>row.date!==date || ![row.open,row.high,row.low,row.close,row.rawClose,row.volume,row.turnover].every(Number.isFinite))) throw new Error('官方行情快取格式異常，停止使用');
      } else {
        const url=market==='twse' ? `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${day(date)}&type=ALLBUT0999&response=json` : `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${slash(date)}&id=&response=json`;
        const parsed=parseDailyQuotes(await json(url),market,date,universe);
        if(parsed.empty) throw new Error(`${market} 預期交易日 ${date} 無行情，可能延遲或臨時休市；保留上次結果`);
        rows=parsed.rows;
        await save(cachePath,{schemaVersion:OFFICIAL_SOURCE_VERSION,date,market,rows});
      }
      const expected=[...universe.values()].filter(stock=>stock.market===market).length;
      const current=rows.filter(row=>universe.has(row.symbol) && universe.get(row.symbol).market===market);
      if(current.length<expected*.8) throw new Error(`${market} ${date} 普通股行情覆蓋不足 80%`);
      for(const row of current) all.get(row.symbol).push({...row});
    }
    if(sessions.indexOf(date)%10===0 || date===target)log(`已取得 ${date} 官方日線（${requests} 次請求，${cacheHits} 筆快取）`);
  }
  for(const action of actions) {
    const bar=all.get(action.symbol)?.find(bar=>bar.date===action.date);
    if(bar)bar.action=bar.action ? `${bar.action}、${action.kind}` : action.kind;
  }
  // Additional conservative consistency guard; this is an exclusion, never an adjustment estimate.
  for(const bars of all.values()) for(let i=1;i<bars.length;i++) {
    const previous=bars[i-1], current=bars[i];
    if (previous.close>0 && current.close>0 && current.volume>0 &&
        (Math.abs(current.close/previous.close-1)>.115 || current.change!==null && Math.abs(current.close-current.change-previous.close)>Math.max(.03,previous.close*.0001)))
      current.action ||= '未確認價格基準異動';
  }
  const closed=new Set([...calendars.values()].flatMap(set=>[...set]));
  const historicalCursor=new Date(`${[...historicalDates].sort()[0]}T00:00:00Z`);
  while(historicalCursor.toISOString().slice(0,10)<=target) {
    const date=historicalCursor.toISOString().slice(0,10);
    if(![0,6].includes(historicalCursor.getUTCDay()) && !historicalDates.has(date))closed.add(date);
    historicalCursor.setUTCDate(historicalCursor.getUTCDate()+1);
  }
  const closedDates=[...closed].sort();
  return {universe,all,sessions,requests,cacheHits,actions,metadata:{dataSource:'TWSE／TPEx 官方免費日線',priceBasis:'raw-action-screened',safetyWindow:70,
    actionSources:ACTION_SOURCES.map(source=>source.path),calendarYears:[...calendars.keys()],closedDates,expectedMarketDate}};
}
