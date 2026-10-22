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

    // A. Route Mission Control Inspector directly to Gemini Live worker
    if (url.pathname === '/inspect') {
      if (!env.GEMINI_WORKER) {
        console.error("[Gateway] ❌ FATAL: GEMINI_WORKER service binding missing!");
        return new Response(JSON.stringify({ error: "Gemini Live Worker unlinked" }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      return env.GEMINI_WORKER.fetch(request);
    }

    // B. Route AI Stage WebSocket connections directly to the Gemini Live edge worker service binding
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
        
        const authData = await authCheckRes.json();
        
        // Rewrite the request to inject the verified user ID and internal gateway secret
        const internalGatewaySecret = env.INTERNAL_GATEWAY_SECRET || 'linkup-internal-worker-secret-2026';
        const modifiedReqHeaders = new Headers(request.headers);
        modifiedReqHeaders.set('X-Verified-User-Id', authData.id);
        modifiedReqHeaders.set('X-Internal-Gateway-Secret', internalGatewaySecret);
        
        const doReq = new Request(request.url, {
            method: request.method,
            headers: modifiedReqHeaders,
            body: request.body
        });
        
        return env.GEMINI_WORKER.fetch(doReq);
      }

      // Ensure webhook HTTP POSTs also pass through transparently
      return env.GEMINI_WORKER.fetch(request);
    }

    // B. Clean Reverse Proxy to Supabase
    const incomingOrigin = request.headers.get('Origin');
    const requestedHeaders = request.headers.get('Access-Control-Request-Headers');
    const isExplicitOrigin = Boolean(incomingOrigin);
    const isOriginAllowed = isExplicitOrigin ? ALLOWED_ORIGINS.includes(incomingOrigin) : false;
    const resolvedCorsOrigin = isOriginAllowed ? incomingOrigin : ALLOWED_ORIGINS[0];

    if (request.method === 'OPTIONS') {
      if (!isExplicitOrigin || !isOriginAllowed) {
        console.warn(`[Gateway] ⛔ Rejected Preflight from unapproved origin: ${incomingOrigin}`);
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': incomingOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': requestedHeaders || 'authorization, x-client-info, apikey, content-type, prefer, range, x-supabase-api-version',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    if (isExplicitOrigin && !isOriginAllowed) {
      console.error(`[Gateway] ⛔ Blocked unauthorized request from: ${incomingOrigin}`);
      return new Response(JSON.stringify({ error: "Unauthorized environment" }), { 
        status: 403, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // C. Secure Phone + Password Authentication Resolver (Atomic SQL RPC)
    if (url.pathname === '/auth/phone-login') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { 
          status: 405, 
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': resolvedCorsOrigin } 
        });
      }

      try {
        const { phone, password } = await request.json();
        if (!phone || !password) {
          return new Response(JSON.stringify({ error: "MISSING_FIELDS", message: "Phone and password are required." }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': resolvedCorsOrigin }
          });
        }

        // 1. Single Atomic RPC Call to Supabase Database (Service Role Execution)
        const rpcRes = await fetch(`${REAL_SUPABASE_URL}/rest/v1/rpc/resolve_verified_phone_login_target`, {
          method: 'POST',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ p_phone: phone })
        });

        if (!rpcRes.ok) {
          console.error(`[Gateway] Phone login target resolution failed: ${await rpcRes.text()}`);
          return new Response(JSON.stringify({ error: "SERVER_ERROR", message: "Database verification failed." }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': resolvedCorsOrigin }
          });
        }

        const result = await rpcRes.json();

        // 2. Evaluate Status from PostgreSQL
        if (result.status !== 'OK') {
          const statusCodes = {
            'ACCOUNT_NOT_FOUND': 404,
            'UNVERIFIED_PHONE': 403,
            'SYNTHETIC_NO_PASSWORD': 400,
            'NO_EMAIL_ATTACHED': 400,
            'MISSING_FIELDS': 400
          };
          return new Response(JSON.stringify({
            error: result.status,
            message: result.message
          }), {
            status: statusCodes[result.status] || 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': resolvedCorsOrigin }
          });
        }

        // 3. Authenticate with Supabase GoTrue using resolved email
        const tokenRes = await fetch(`${REAL_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: {
            'apikey': REAL_ANON_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ email: result.email, password })
        });

        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) {
          return new Response(JSON.stringify({
            error: "INVALID_CREDENTIALS",
            message: "Invalid phone number or password. Please verify your credentials and try again."
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': resolvedCorsOrigin }
          });
        }

        return new Response(JSON.stringify(tokenData), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': resolvedCorsOrigin,
            'Access-Control-Allow-Credentials': 'true'
          }
        });
      } catch (err) {
        console.error(`[Gateway] Phone login error: ${err.message}`);
        return new Response(JSON.stringify({ error: "INTERNAL_ERROR", message: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': resolvedCorsOrigin }
        });
      }
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

    // --- CLOUDFLARE GLOBAL EDGE CACHING LAYER (FREE TIER DEFENSE) ---
    const edgeCache = caches.default;
    const hasBypassParam = url.searchParams.has('nocache') || url.searchParams.has('cb') || url.searchParams.has('purge');

    // 1. Synthetic Cache Key Resolver for Idempotent POST Book Payloads
    let postCacheKey = null;
    const isBookReaderPost = request.method === 'POST' && url.pathname === '/functions/v1/book-reader';

    if (isBookReaderPost && !hasBypassParam) {
      try {
        const bodyClone = await request.clone().json();
        const cacheableActions = ['get_book_pages', 'list_books', 'list_universities', 'get_book_mapped_questions', 'get_question_hint'];
        if (bodyClone.action && cacheableActions.includes(bodyClone.action)) {
          const sortedParams = Object.keys(bodyClone).sort().map(k => `${k}=${encodeURIComponent(String(bodyClone[k]))}`).join('&');
          postCacheKey = new Request(`https://cache.linkup.internal/book-reader-cache?${sortedParams}`, { method: 'GET' });
        }
      } catch (e) {}
    }

    // A. Intercept & Serve Cached POST Book Payload (0ms Supabase Egress)
    if (postCacheKey) {
      const cachedPostRes = await edgeCache.match(postCacheKey);
      if (cachedPostRes) {
        console.log(`[Gateway] ⚡ EDGE CACHE HIT (POST BOOK): ${url.pathname}`);
        const hitHeaders = new Headers(cachedPostRes.headers);
        if (isExplicitOrigin && isOriginAllowed) {
          hitHeaders.set('Access-Control-Allow-Origin', incomingOrigin);
          hitHeaders.set('Access-Control-Allow-Credentials', 'true');
        }
        hitHeaders.set('Access-Control-Expose-Headers', 'x-supabase-api-version, content-range, content-length, x-linkup-cache');
        hitHeaders.set('X-LinkUp-Cache', 'HIT-EDGE-POST');
        return new Response(cachedPostRes.body, {
          status: cachedPostRes.status,
          statusText: cachedPostRes.statusText,
          headers: hitHeaders
        });
      }
    }

    // 2. Identify Public Cacheable GET Endpoints (Storage Assets & News Feed)
    const isPublicStorage = url.pathname.startsWith('/storage/v1/object/public/');
    const isPublicNewsFeed = request.method === 'GET' && url.pathname === '/functions/v1/news-feed';
    const isCacheableGet = !hasBypassParam && request.method === 'GET' && (isPublicStorage || isPublicNewsFeed);
    let getCacheKey = null;

    // B. Intercept & Serve Cached GET Assets
    if (isCacheableGet) {
      getCacheKey = new Request(url.toString(), { method: 'GET' });
      const cachedGetRes = await edgeCache.match(getCacheKey);
      if (cachedGetRes) {
        console.log(`[Gateway] ⚡ EDGE CACHE HIT (GET): ${url.pathname}`);
        const hitHeaders = new Headers(cachedGetRes.headers);
        if (isExplicitOrigin && isOriginAllowed) {
          hitHeaders.set('Access-Control-Allow-Origin', incomingOrigin);
          hitHeaders.set('Access-Control-Allow-Credentials', 'true');
        }
        hitHeaders.set('Access-Control-Expose-Headers', 'x-supabase-api-version, content-range, content-length, x-linkup-cache');
        hitHeaders.set('X-LinkUp-Cache', 'HIT-EDGE-GET');
        return new Response(cachedGetRes.body, {
          status: cachedGetRes.status,
          statusText: cachedGetRes.statusText,
          headers: hitHeaders
        });
      }
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

    // Direct Cloudflare edge cache directives for subrequests
    if (isCacheableGet) {
      const getTtl = isPublicStorage ? 2592000 : 90;
      init.cf = {
        cacheEverything: true,
        cacheTtl: getTtl,
        cacheTtlByStatus: { "200-299": getTtl, 404: 1, "500-599": 0 }
      };
    }

    try {
      const response = await fetch(targetUrl.toString(), init);
      console.log(`[Gateway] ✅ Backend responded with HTTP ${response.status}`);
      
      if (response.status === 101) return response;

      const responseHeaders = new Headers(response.headers);
      if (isExplicitOrigin && isOriginAllowed) {
        responseHeaders.set('Access-Control-Allow-Origin', incomingOrigin);
        responseHeaders.set('Access-Control-Allow-Credentials', 'true');
      }
      responseHeaders.set('Access-Control-Expose-Headers', 'x-supabase-api-version, content-range, content-length, x-linkup-cache');
      responseHeaders.set('X-LinkUp-Cache', 'MISS-UPSTREAM');

      // Populate Edge Cache on successful responses
      if (response.status === 200) {
        // Caching for Immutable Public Storage Assets
        if (isPublicStorage) {
          if (hasBypassParam) {
            responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else {
            responseHeaders.set('Cache-Control', 'public, max-age=31536000, s-maxage=2592000, immutable');
            if (getCacheKey) {
              const toStore = new Response(response.clone().body, {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders
              });
              ctx.waitUntil(edgeCache.put(getCacheKey, toStore));
              console.log(`[Gateway] 💾 Edge Cached Storage Asset: ${url.pathname}`);
            }
          }
        }

        // Caching for Public News Feed (90 seconds edge shield)
        if (isPublicNewsFeed && getCacheKey && !hasBypassParam) {
          responseHeaders.set('Cache-Control', 'public, max-age=30, s-maxage=90');
          const toStore = new Response(response.clone().body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
          });
          ctx.waitUntil(edgeCache.put(getCacheKey, toStore));
          console.log(`[Gateway] 💾 Edge Cached News Feed: ${url.pathname}`);
        }

        // Caching for Idempotent POST Book Payloads (7 days edge shield)
        if (postCacheKey && !hasBypassParam) {
          responseHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
          const toStore = new Response(response.clone().body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
          });
          ctx.waitUntil(edgeCache.put(postCacheKey, toStore));
          console.log(`[Gateway] 💾 Edge Cached POST Book Payload: ${url.pathname}`);
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