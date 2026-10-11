// ==============================================================================
// 1. THE UNIFIED API GATEWAY & REVERSE PROXY
// ==============================================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const REAL_SUPABASE_URL = env.SUPABASE_URL || 'https://ryaxynjczfwqyqvpmorl.supabase.co';
    const REAL_ANON_KEY = env.SUPABASE_ANON_KEY || 'sb_publishable_B9mxFwLJl8WWw_Y9C28LtA_AfKYATEc';

    // Security: Strict Origin Whitelist
    const ALLOWED_ORIGINS = [
      'https://getyetek.github.io',
      'https://getyeteklu2.github.io',
      'http://localhost:8080',
      'http://localhost:5173',
      'http://localhost:3000'
    ];

    console.log(`[Gateway] 🚀 Incoming Request: ${request.method} ${url.pathname}`);

    // Telegram Image Redirect Proxy (Zero-Storage Solution)
    if (url.pathname === '/telegram-image-proxy') {
      const channel = url.searchParams.get('channel');
      const id = url.searchParams.get('id');
      if (!channel || !id) {
        return new Response("Missing channel or id", { status: 400 });
      }

      const telegramUrl = `https://t.me/${channel}/${id}?embed=1`;
      
      try {
        const response = await fetch(telegramUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 TelegramBot (like TwitterBot)'
          }
        });

        if (!response.ok) {
          return new Response("Failed to fetch Telegram embed page", { status: 502 });
        }

        const html = await response.text();
        const regex = /background-image:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i;
        const match = html.match(regex);

        if (match && match[1]) {
          const freshImgUrl = match[1];
          return new Response(null, {
            status: 302,
            headers: {
              'Location': freshImgUrl,
              'Cache-Control': 'public, s-maxage=3600, max-age=3600',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }

        return new Response("Image URL not found in Telegram page", { status: 404 });
      } catch (err) {
        return new Response(`Error crawling Telegram: ${err.message}`, { status: 500 });
      }
    }

    // A. Route AI Stage WebSocket connections directly to the Gemini Live edge worker service binding
    if (url.pathname === '/realtime-ai') {
      console.log(`[Gateway] 🔁 Forwarding /realtime-ai to GEMINI_WORKER service binding...`);
      if (!env.GEMINI_WORKER) {
          console.error("[Gateway] ❌ FATAL: GEMINI_WORKER service binding missing!");
          return new Response(JSON.stringify({error: "Gemini Live Worker unlinked"}), {status: 500, headers: {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'}});
      }

      if (request.headers.get("Upgrade") === "websocket") {
        const incomingOrigin = request.headers.get('Origin');
        if (incomingOrigin && !ALLOWED_ORIGINS.includes(incomingOrigin)) {
          console.error(`[Gateway] ⛔ Blocked unauthorized WebSocket origin: ${incomingOrigin}`);
          return new Response(JSON.stringify({ error: "Unauthorized Origin" }), { status: 403 });
        }

        let token = url.searchParams.get("token");
        const protocols = request.headers.get("Sec-WebSocket-Protocol");
        
        // Intercept token from WebSocket subprotocol array if not in URL
        if (!token && protocols && protocols.includes("access_token")) {
            const parts = protocols.split(',').map(p => p.trim());
            const idx = parts.indexOf("access_token");
            if (idx !== -1 && parts.length > idx + 1) {
                token = parts[idx + 1];
            }
        }

        if (!token) {
          console.error(`[Gateway] ⛔ Blocked WebSocket upgrade missing auth token`);
          return new Response(JSON.stringify({ error: "Missing Authentication Token" }), { status: 401 });
        }

        const authCheckRes = await fetch(`${REAL_SUPABASE_URL}/auth/v1/user`, {
          headers: { 'Authorization': `Bearer ${token}`, 'apikey': REAL_ANON_KEY }
        });
        if (!authCheckRes.ok) {
          console.error(`[Gateway] ⛔ Invalid auth token on WebSocket upgrade`);
          return new Response(JSON.stringify({ error: "Invalid Authentication Token" }), { status: 401 });
        }
      }

      return env.GEMINI_WORKER.fetch(request);
    }

    // B. Clean Reverse Proxy to Supabase
    const incomingOrigin = request.headers.get('Origin');
    const requestedHeaders = request.headers.get('Access-Control-Request-Headers');
    const isAllowed = !incomingOrigin || ALLOWED_ORIGINS.includes(incomingOrigin);
    const corsOrigin = isAllowed ? (incomingOrigin || '*') : 'https://unauthorized-origin-blocked';

    if (request.method === 'OPTIONS') {
      console.log(`[Gateway] 🛡️ Preflight: ${incomingOrigin} (Allowed: ${isAllowed})`);
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': corsOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': requestedHeaders || 'authorization, x-client-info, apikey, content-type, prefer, range, x-supabase-api-version',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    if (incomingOrigin && !isAllowed) {
      console.error(`[Gateway] ⛔ Blocked unauthorized request from: ${incomingOrigin}`);
      return new Response(JSON.stringify({ error: "Unauthorized environment" }), { 
        status: 403, 
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin } 
      });
    }

    const targetUrl = new URL(url.pathname + url.search, REAL_SUPABASE_URL);
    const modifiedHeaders = new Headers(request.headers);

    // Ensure apikey header is present for upstream Supabase dispatch
    if (!modifiedHeaders.get('apikey')) {
      modifiedHeaders.set('apikey', REAL_ANON_KEY);
    }
    if (!targetUrl.searchParams.has('apikey')) {
      targetUrl.searchParams.set('apikey', modifiedHeaders.get('apikey') || REAL_ANON_KEY);
    }

    console.log(`[Gateway] 🔀 Proxying ${request.method} to: ${targetUrl.toString()}`);

    const init = {
      method: request.method,
      headers: modifiedHeaders,
      redirect: 'manual'
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    try {
      const response = await fetch(targetUrl.toString(), init);
      console.log(`[Gateway] ✅ Backend responded with HTTP ${response.status}`);
      
      if (response.status === 101) return response;

      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', corsOrigin);
      responseHeaders.set('Access-Control-Allow-Credentials', 'true');
      responseHeaders.set('Access-Control-Expose-Headers', 'x-supabase-api-version, content-range, content-length, x-supabase-api-version');

      // High-Performance Immutable Caching with Instant Purge Trigger for Book Assets
      if (url.pathname.startsWith('/storage/v1/object/public/book-assets/')) {
        const hasBypassParam = url.searchParams.has('nocache') || url.searchParams.has('cb') || url.searchParams.has('purge');
        if (hasBypassParam) {
          responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else {
          responseHeaders.set('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
        }
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });

    } catch (err) {
      console.error(`[Gateway] ❌ FATAL ERROR: ${err.message}`);
      return new Response(JSON.stringify({ error: "Gateway proxy error", details: err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};