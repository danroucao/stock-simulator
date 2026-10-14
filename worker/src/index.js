import { SNAPSHOT_KEY, buildIntradaySnapshot, fetchMis, inTaipeiTradingWindow, parseSymbols } from './intraday.js';

const ALLOWED_ORIGINS = new Set([
  'https://danroucao.github.io',
  'http://localhost:4200',
]);

const ALLOWED_PATHS = new Set([
  '/api/history',
  '/api/quote',
  '/api/quotes',
  '/api/intraday-market',
  '/api/stock-info',
  '/openapi/v1/tpex_mainboard_daily_close_quotes',
  '/www/zh-tw/afterTrading/tradingStock',
]);

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env, ctx) {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response('Origin not allowed', { status: 403 });
    if (!ALLOWED_PATHS.has(requestUrl.pathname)) return new Response('Path not allowed', { status: 404 });

    try {
      if (requestUrl.pathname === '/api/intraday-market') {
        if (!env?.INTRADAY) return Response.json({error:'盤中全市場快照尚未設定'},{status:503,headers:origin?corsHeaders(origin):{}});
        const snapshot=await env.INTRADAY.get(SNAPSHOT_KEY,{type:'json',cacheTtl:30});
        const headers=new Headers({'Cache-Control':'public, max-age=20'});
        if(origin)for(const [key,value] of Object.entries(corsHeaders(origin)))headers.set(key,value);
        return Response.json(snapshot||{error:'今日盤中快照尚未產生'},{status:snapshot?200:404,headers});
      }
      if (requestUrl.pathname === '/api/stock-info') {
        const infoUrl=new URL('https://api.finmindtrade.com/api/v4/data');
        infoUrl.searchParams.set('dataset','TaiwanStockInfo');
        const upstream=await fetch(infoUrl,{headers:{Accept:'application/json',...(env?.FINMIND_API_TOKEN?{Authorization:`Bearer ${env.FINMIND_API_TOKEN}`}:{})},signal:AbortSignal.timeout(10000)});
        const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=86400'});
        if(origin)for(const [key,value] of Object.entries(corsHeaders(origin)))headers.set(key,value);
        return new Response(upstream.body,{status:upstream.status,headers});
      }
      if (requestUrl.pathname === '/api/history') {
        const symbol = (requestUrl.searchParams.get('symbol') || '').replace(/\D/g, '');
        const startDate = requestUrl.searchParams.get('start_date') || '';
        const endDate = requestUrl.searchParams.get('end_date') || '';
        if (!/^\d{4,6}$/.test(symbol)) return new Response('Invalid symbol', { status: 400 });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
          return new Response('Invalid date range', { status: 400 });
        }

        const historyUrl = new URL('https://api.finmindtrade.com/api/v4/data');
        historyUrl.searchParams.set('dataset', 'TaiwanStockPrice');
        historyUrl.searchParams.set('data_id', symbol);
        historyUrl.searchParams.set('start_date', startDate);
        historyUrl.searchParams.set('end_date', endDate);
        const historyResponse = await fetch(historyUrl.toString(), {
          headers: {
            Accept: 'application/json',
            ...(env?.FINMIND_API_TOKEN ? { Authorization: `Bearer ${env.FINMIND_API_TOKEN}` } : {}),
          },
          signal: AbortSignal.timeout(10000),
        });
        const headers = new Headers({
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        });
        if (origin) {
          for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
        }
        return new Response(historyResponse.body, { status: historyResponse.status, headers });
      }

      if (requestUrl.pathname === '/api/quote' || requestUrl.pathname === '/api/quotes') {
        const symbols=parseSymbols(requestUrl.pathname==='/api/quote'?requestUrl.searchParams.get('symbol'):requestUrl.searchParams.get('symbols')).sort();
        const cache=globalThis.caches?.default,cacheKey=new Request(`https://intraday-quotes.internal/?symbols=${symbols.join(',')}`);
        const cached=cache?await cache.match(cacheKey):null;
        let payload;
        if(cached)payload=await cached.json();
        else{
          const rows=await fetchMis(symbols.map((symbol)=>({symbol})));
          payload={msgArray:rows,requestedAt:new Date().toISOString()};
          if(cache)ctx?.waitUntil(cache.put(cacheKey,Response.json(payload,{headers:{'Cache-Control':'public, max-age=15'}})));
        }
        const headers = new Headers({
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        if (origin) {
          for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
        }
        return Response.json(payload,{status:200,headers});
      }

      const upstreamUrl = new URL(`https://www.tpex.org.tw${requestUrl.pathname}`);
      upstreamUrl.search = requestUrl.search;

      // Keep the subrequest intentionally simple. TPEx already supplies cache
      // headers. Browser-like navigation headers prevent TPEx from redirecting
      // edge-originated requests into its repeating /errors route.
      const upstream = await fetch(upstreamUrl.toString(), {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
          Referer: 'https://www.tpex.org.tw/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36',
        },
        redirect: 'manual',
      });

      if (upstream.status >= 300 && upstream.status < 400) {
        throw new Error(`TPEx rejected the request with ${upstream.status}`);
      }

      const headers = new Headers({
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'Cache-Control': requestUrl.pathname.startsWith('/openapi/')
          ? 'public, max-age=60' : 'public, max-age=3600',
      });
      if (origin) {
        for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
      }

      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(`TPEx upstream request failed: ${message}`, { status: 502 });
    }
  },
  async scheduled(controller,env,ctx){
    const now=new Date(controller.scheduledTime||Date.now());
    if(!inTaipeiTradingWindow(now)){console.log(JSON.stringify({event:'intraday_snapshot_skipped',reason:'outside_trading_window',at:now.toISOString()}));return;}
    ctx.waitUntil(buildIntradaySnapshot(env,now));
  },
};
