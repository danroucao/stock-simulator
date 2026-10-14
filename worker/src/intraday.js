export const SNAPSHOT_KEY = 'intraday-market-v1';
export const MAX_BATCH_SYMBOLS = 50;
const MARKET_CHUNK_SIZE = 45;

export function taipeiParts(now = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23', weekday:'short',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return {
    date:`${values.year}-${values.month}-${values.day}`,
    compactDate:`${values.year}${values.month}${values.day}`,
    minutes:Number(values.hour) * 60 + Number(values.minute),
    weekday:values.weekday,
  };
}
export function inTaipeiTradingWindow(now = new Date()) {
  const { minutes, weekday } = taipeiParts(now);
  return !['Sat','Sun'].includes(weekday) && minutes >= 9 * 60 && minutes <= 13 * 60 + 35;
}
export function parseSymbols(value, maximum = MAX_BATCH_SYMBOLS) {
  const symbols = [...new Set(String(value || '').split(',').map((value) => value.replace(/\D/g,'')).filter((value) => /^\d{4,6}$/.test(value)))];
  if (!symbols.length || symbols.length > maximum) throw new Error(`請提供 1～${maximum} 個有效股票代號`);
  return symbols;
}
const channel = ({ symbol, market }) => market === 'twse'
  ? `tse_${symbol}.tw`
  : market === 'tpex'
    ? `otc_${symbol}.tw`
    : `tse_${symbol}.tw|otc_${symbol}.tw`;

export async function fetchMis(entries, fetchImpl = fetch) {
  const url = new URL('https://mis.twse.com.tw/stock/api/getStockInfo.jsp');
  url.searchParams.set('ex_ch', entries.map(channel).join('|'));
  url.searchParams.set('json','1');
  url.searchParams.set('delay','0');
  const response = await fetchImpl(url, { headers:{ Accept:'application/json, text/plain, */*' }, signal:AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`MIS HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.msgArray)) throw new Error('MIS 回應格式不符');
  return body.msgArray;
}
const numeric = (value) => {
  const number = Number(String(value ?? '').replaceAll(',',''));
  return Number.isFinite(number) ? number : 0;
};
export function normalizeMisQuote(row) {
  const close=numeric(row.z),open=numeric(row.o),high=numeric(row.h),low=numeric(row.l);
  if (!/^\d{4,6}$/.test(row.c || '') || !/^\d{8}$/.test(row.d || '') || close<=0 || open<=0 || low<=0 || high<low || close<low || close>high) return null;
  const previousClose=numeric(row.y);
  return {symbol:row.c,name:String(row.n||row.c).trim(),date:row.d,time:row.t||'',open,high,low,close,previousClose,change:close-previousClose,volume:numeric(row.v)*1000};
}
export function provisionalEvents(stocks, quotes) {
  const bySymbol=new Map(quotes.map((quote)=>[quote.symbol,quote]));
  return stocks.flatMap((stock)=>{
    const quote=bySymbol.get(stock.symbol);
    if(!quote||!Number.isFinite(stock.lower)||!Number.isFinite(stock.upper))return [];
    const breakout=quote.close>stock.upper,breakdown=quote.close<stock.lower;
    if(!breakout&&!breakdown)return [];
    return [{id:`intraday:${quote.date}:${stock.symbol}:${breakout?'breakout':'breakdown'}`,symbol:stock.symbol,name:stock.name,market:stock.market,
      state:breakout?'盤中突破待收盤確認':'盤中跌破待收盤確認',quoteDate:quote.date,quoteTime:quote.time,price:quote.close,lower:stock.lower,upper:stock.upper,
      reason:breakout?`盤中成交價高於既有區間上緣 ${stock.upper} 元，仍待收盤確認。`:`盤中成交價低於既有區間下緣 ${stock.lower} 元，仍待收盤確認。`}];
  });
}
export async function buildIntradaySnapshot(env, now = new Date(), fetchImpl = fetch) {
  if(!env?.INTRADAY)throw new Error('INTRADAY KV 尚未綁定');
  const feedUrl=env.PUBLIC_MARKET_FEED_URL||'https://danroucao.github.io/stock-simulator/market/latest.json';
  const response=await fetchImpl(feedUrl,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`市場名冊 HTTP ${response.status}`);
  const feed=await response.json();
  if(feed?.schemaVersion!==2||!Array.isArray(feed.stocks)||feed.stocks.length<1000)throw new Error('市場名冊格式或涵蓋範圍不符');
  const quotes=[];
  for(let index=0;index<feed.stocks.length;index+=MARKET_CHUNK_SIZE*4){
    const group=[];
    for(let offset=index;offset<Math.min(feed.stocks.length,index+MARKET_CHUNK_SIZE*4);offset+=MARKET_CHUNK_SIZE)group.push(fetchMis(feed.stocks.slice(offset,offset+MARKET_CHUNK_SIZE),fetchImpl));
    quotes.push(...(await Promise.all(group)).flat().map(normalizeMisQuote).filter(Boolean));
  }
  const current=taipeiParts(now),currentQuotes=quotes.filter((quote)=>quote.date===current.compactDate);
  if(currentQuotes.length<feed.stocks.length*.5)throw new Error(`當日有效盤中行情僅 ${currentQuotes.length}／${feed.stocks.length} 檔，保留上次快照`);
  const snapshot={schemaVersion:1,status:'ready',quoteDate:current.date,generatedAt:now.toISOString(),source:'TWSE MIS 延遲快照',
    coverage:{valid:currentQuotes.length,total:feed.stocks.length},quotes:currentQuotes,provisionalEvents:provisionalEvents(feed.stocks,currentQuotes)};
  await env.INTRADAY.put(SNAPSHOT_KEY,JSON.stringify(snapshot),{expirationTtl:86400});
  console.log(JSON.stringify({event:'intraday_snapshot_ready',quoteDate:snapshot.quoteDate,quotes:currentQuotes.length,provisionalEvents:snapshot.provisionalEvents.length}));
  return snapshot;
}
