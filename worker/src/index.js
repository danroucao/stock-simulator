const ALLOWED_ORIGINS = new Set([
  'https://danroucao.github.io',
  'http://localhost:4200',
]);

const ALLOWED_PATHS = new Set([
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

    const upstreamUrl = new URL(`https://www.tpex.org.tw${requestUrl.pathname}`);
    upstreamUrl.search = requestUrl.search;

    const upstream = await fetch(upstreamUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'stock-simulator-tpex-proxy/1.0',
      },
      cf: {
        cacheEverything: true,
        cacheTtl: requestUrl.pathname.startsWith('/openapi/') ? 60 : 3600,
      },
    });

    const headers = new Headers(upstream.headers);
    if (origin) {
      for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
    }
    headers.set('Cache-Control', requestUrl.pathname.startsWith('/openapi/')
      ? 'public, max-age=60' : 'public, max-age=3600');
    headers.delete('Set-Cookie');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
