const ALLOWED_ORIGINS = new Set([
  'https://danroucao.github.io',
  'http://localhost:4200',
]);

const ALLOWED_PATHS = new Set([
  '/api/quote',
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
  async fetch(request) {
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
      if (requestUrl.pathname === '/api/quote') {
        const symbol = (requestUrl.searchParams.get('symbol') || '').replace(/\D/g, '');
        if (!/^\d{4,6}$/.test(symbol)) return new Response('Invalid symbol', { status: 400 });

        const misUrl = new URL('https://mis.twse.com.tw/stock/api/getStockInfo.jsp');
        misUrl.searchParams.set('ex_ch', `otc_${symbol}.tw`);
        misUrl.searchParams.set('json', '1');
        misUrl.searchParams.set('delay', '0');
        const misResponse = await fetch(misUrl.toString(), {
          headers: { Accept: 'application/json, text/plain, */*' },
        });
        const headers = new Headers({
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=30',
        });
        if (origin) {
          for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
        }
        return new Response(misResponse.body, { status: misResponse.status, headers });
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
};
