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
        
        const authData = await authCheckRes.json();
        
        // Rewrite the request to inject the verified user ID and internal gateway secret
        const modifiedReqHeaders = new Headers(request.headers);
        modifiedReqHeaders.set('X-Verified-User-Id', authData.id);
        modifiedReqHeaders.set('X-Internal-Gateway-Secret', 'linkup-internal-worker-secret-2026');
        
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

    // C. Secure Phone + Password Authentication Resolver
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

        // 1. Phone Normalization (E.164)
        let rawPhone = String(phone).replace(/[\s\-()]/g, '');
        let normalizedPhone = rawPhone;
        if (rawPhone.startsWith('0')) {
          normalizedPhone = '+251' + rawPhone.slice(1);
        } else if (rawPhone.startsWith('251')) {
          normalizedPhone = '+' + rawPhone;
        } else if (rawPhone.length === 9 && (rawPhone.startsWith('9') || rawPhone.startsWith('7'))) {
          normalizedPhone = '+251' + rawPhone;
        } else if (!rawPhone.startsWith('+')) {
          normalizedPhone = '+' + rawPhone;
        }

        // 2. Gate 1: Check account existence in profiles
        const profRes = await fetch(`${REAL_SUPABASE_URL}/rest/v1/profiles?phone=eq.${encodeURIComponent(normalizedPhone)}&select=id,registered_with_telegram,telegram_id`, {
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        });

        if (!profRes.ok) {
          console.error(`[Gateway] Profile lookup failed: ${await profRes.text()}`);
          return new Response(JSON.stringify({ error: "SERVER_ERROR", message: "Database query failed." }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': resolvedCorsOrigin }
          });
        }

        const profiles = await profRes.json();
        if (!profiles || profiles.length === 0) {
          return new Response(JSON.stringify({
            error: "ACCOUNT_NOT_FOUND",
            message: "No account found matching this phone number."
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': resolvedCorsOrigin }
          });
        }

        const prof = profiles[0];

        // 3. Gate 2: The Telegram Verification Sentry
        if (!prof.registered_with_telegram || !prof.telegram_id) {
          return new Response(JSON.stringify({
            error: "UNVERIFIED_PHONE",
            message: "This phone number has not been verified with Telegram yet. Please log in with your email address, then verify your phone via our Telegram bot to unlock phone login (and claim 50 free credits)!"
          }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': resolvedCorsOrigin }
          });
        }

        // 4. Resolve internal GoTrue email
        const userRes = await fetch(`${REAL_SUPABASE_URL}/auth/v1/admin/users/${prof.id}`, {
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        });

        if (!userRes.ok) {
          return new Response(JSON.stringify({ error: "USER_LOOKUP_FAILED", message: "Failed to resolve authentication account." }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': resolvedCorsOrigin }
          });
        }

        const userData = await userRes.json();
        const userEmail = userData.email;
        if (!userEmail) {
          return new Response(JSON.stringify({ error: "NO_EMAIL_ATTACHED", message: "Account has no email identity attached." }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': resolvedCorsOrigin }
          });
        }

        // 5. Gate 3: Check synthetic accounts without passwords
        const isSynthetic = userEmail.endsWith('@linkup.invalid');
        const hasPassword = Boolean(userData.encrypted_password);
        if (isSynthetic && !hasPassword) {
          return new Response(JSON.stringify({
            error: "SYNTHETIC_NO_PASSWORD",
            message: "This account was created via Telegram and has no password configured yet. Please tap 'Log in with Telegram' below to sign in."
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': resolvedCorsOrigin }
          });
        }

        // 6. Gate 4: Authenticate with Supabase GoTrue
        const tokenRes = await fetch(`${REAL_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: {
            'apikey': REAL_ANON_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ email: userEmail, password })
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
      if (isExplicitOrigin && isOriginAllowed) {
        responseHeaders.set('Access-Control-Allow-Origin', incomingOrigin);
        responseHeaders.set('Access-Control-Allow-Credentials', 'true');
      }
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