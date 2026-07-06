// ==============================================================================
// 1. THE UNIFIED API GATEWAY & ROUTER (DECOUPLED FROM GEMINI LIVE)
// ==============================================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
        // Regex extracts background-image URL inside the HTML embed widget
        const regex = /background-image:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i;
        const match = html.match(regex);

        if (match && match[1]) {
          const freshImgUrl = match[1];
          // Return 302 redirect with caching so Cloudflare edge caches the fresh redirect for 1 hour
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
      return env.GEMINI_WORKER.fetch(request);
    }

    // B. Existing API Gateway / Proxy Routing (CORS, Scrubbing, Supabase redirection)
    const REAL_SUPABASE_URL = 'https://ryaxynjczfwqyqvpmorl.supabase.co';
    const REAL_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5YXh5bmpjemZ3cXlxdnBtb3JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDkwMTEsImV4cCI6MjA5NzEyNTAxMX0.739vHhzkh4as9K4afPylbaMBsupGR_rFTgpATDYiWOY';
    
    // Valid Tenant Signatures (Fake keys from micro-frontends)
    const VALID_TENANT_KEYS = [
      'sys_pub_5e22b8c9d0a18d9e0a2f8d73b', // Core SDK
      'gn_pub_8f72c3b4a5e68d9e0a2f8d73b',  // News Module
      'ha_pub_4b91e8c7d6f58d9e0a2f8d73b',  // Academy Module
      'sq_pub_2d66a1b8c9e08d9e0a2f8d73b',  // Squad Module
      'plt_pub_1a99f3c4d5e68d9e0a2f8d73b'  // Platform Services
    ];

    // Security: Strict Origin Whitelist
    const ALLOWED_ORIGINS = [
      'https://getyetek.github.io',    // Your Actual GitHub Pages Production Site
      'https://getyeteklu2.github.io', // Fallback
      'http://localhost:8080',         // Your Local Dev
      'http://localhost:5173',         // Vite Default
      'http://localhost:3000'
    ];

    const incomingOrigin = request.headers.get('Origin');
    const requestedHeaders = request.headers.get('Access-Control-Request-Headers');
    const clientSecret = request.headers.get('x-linkup-client');

    // Detect browser direct media serving, file downloads, auth redirects, or native WebSockets
    const isBypassed = url.pathname.startsWith('/storage/v1/object/public/') || 
                       url.pathname.startsWith('/storage/v1/object/sign/') ||
                       url.pathname.startsWith('/storage/v1/render/image/public/') ||
                       url.pathname.startsWith('/auth/v1/') || 
                       url.pathname.startsWith('/realtime/');

    // Security: Require Custom Header (Gateway Handshake)
    if (request.method !== 'OPTIONS' && !isBypassed && clientSecret !== 'linkup-secure-client-2026') {
      console.error(`[Gateway] ⛔ Blocked request missing valid client secret.`);
      return new Response(JSON.stringify({ error: "Unauthorized Client" }), { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // If the origin is unlisted, we treat it as an unauthorized proxy attempt
    const isAllowed = ALLOWED_ORIGINS.includes(incomingOrigin);
    const corsOrigin = isAllowed ? incomingOrigin : 'https://unauthorized-origin-blocked';

    if (request.method === 'OPTIONS') {
      console.log(`[Gateway] 🛡️ Preflight: ${incomingOrigin} (Allowed: ${isAllowed})`);
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': corsOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': requestedHeaders || 'authorization, x-client-info, apikey, content-type, prefer, range, x-supabase-api-version, x-linkup-client',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // Block non-OPTIONS requests from unauthorized origins
    if (incomingOrigin && !isAllowed) {
      console.error(`[Gateway] ⛔ Blocked unauthorized request from: ${incomingOrigin}`);
      return new Response(JSON.stringify({ error: "Unauthorized environment" }), { 
        status: 403, 
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin } 
      });
    }

    // Map request to the real Supabase backend
    const targetUrl = new URL(url.pathname + url.search, REAL_SUPABASE_URL);

    const modifiedHeaders = new Headers(request.headers);

    // The Scrubbing Engine (Tenant Resolution)
    let keysSwapped = false;
    
    // A. Swap apikey header if it matches ANY known tenant key
    const reqApiKey = modifiedHeaders.get('apikey');
    if (reqApiKey && VALID_TENANT_KEYS.includes(reqApiKey)) {
      modifiedHeaders.set('apikey', REAL_ANON_KEY);
      keysSwapped = true;
    }
    
    // B. Swap apikey query parameter (CRITICAL FOR WEBSOCKETS / REALTIME)
    const queryApiKey = targetUrl.searchParams.get('apikey');
    if (queryApiKey && VALID_TENANT_KEYS.includes(queryApiKey)) {
      targetUrl.searchParams.set('apikey', REAL_ANON_KEY);
      keysSwapped = true;
    }

    console.log(`[Gateway] 🔀 Routing ${request.method} to: ${targetUrl.toString()}`);
    
    // Check Authorization header
    const authHeader = modifiedHeaders.get('authorization');
    if (authHeader) {
      for (const tenantKey of VALID_TENANT_KEYS) {
        if (authHeader.includes(tenantKey)) {
          const updatedAuth = authHeader.replace(tenantKey, REAL_ANON_KEY);
          modifiedHeaders.set('authorization', updatedAuth);
          keysSwapped = true;
          break;
        }
      }
    }

    if (keysSwapped) {
      console.log('[Gateway] 🔑 Security Swap: Successfully replaced dummy key with REAL_ANON_KEY.');
    }

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