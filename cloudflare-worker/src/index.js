export default {
  async fetch(request, env, ctx) {
    // --- HARDCODED SECRETS (As requested for zero-config deployment) ---
    const REAL_SUPABASE_URL = 'https://ryaxynjczfwqyqvpmorl.supabase.co';
    const REAL_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5YXh5bmpjemZ3cXlxdnBtb3JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDkwMTEsImV4cCI6MjA5NzEyNTAxMX0.739vHhzkh4as9K4afPylbaMBsupGR_rFTgpATDYiWOY';
    
    // The fake key the frontend sends to trick sniffers
    const DUMMY_KEY = 'lk_live_9a38f2e7b1c4d9e0a2f8d73b';

    const url = new URL(request.url);
    console.log(`[Gateway] 🚀 Incoming Request: ${request.method} ${url.pathname}`);

    // 1. Security: Strict Origin Whitelist
    const ALLOWED_ORIGINS = [
      'https://getyetek.github.io',    // Your Actual GitHub Pages Production Site
      'https://getyeteklu2.github.io', // Fallback
      'http://localhost:8080',         // Your Local Dev
      'http://localhost:5173',         // Vite Default
      'http://localhost:3000'
    ];

    const incomingOrigin = request.headers.get('Origin');
    const requestedHeaders = request.headers.get('Access-Control-Request-Headers');

    // If the origin is unlisted, we treat it as an unauthorized proxy attempt
    const isAllowed = ALLOWED_ORIGINS.includes(incomingOrigin);
    const corsOrigin = isAllowed ? incomingOrigin : 'https://unauthorized-origin-blocked';

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

    // Block non-OPTIONS requests from unauthorized origins
    if (incomingOrigin && !isAllowed) {
      console.error(`[Gateway] ⛔ Blocked unauthorized request from: ${incomingOrigin}`);
      return new Response(JSON.stringify({ error: "Unauthorized environment" }), { 
        status: 403, 
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin } 
      });
    }

    // 2. Map request to the real Supabase backend
    const targetUrl = new URL(url.pathname + url.search, REAL_SUPABASE_URL);
    console.log(`[Gateway] 🔀 Routing ${request.method} to: ${targetUrl.toString()}`);

    const modifiedHeaders = new Headers(request.headers);

    // 3. The Scrubbing Engine (Swap Dummy Keys for Real Keys)
    let keysSwapped = false;
    
    // Check apikey header
    if (modifiedHeaders.get('apikey') === DUMMY_KEY) {
      modifiedHeaders.set('apikey', REAL_ANON_KEY);
      keysSwapped = true;
    }
    
    // Check Authorization header (Supabase uses "Bearer [KEY]")
    const authHeader = modifiedHeaders.get('authorization');
    if (authHeader && authHeader.includes(DUMMY_KEY)) {
      const updatedAuth = authHeader.replace(DUMMY_KEY, REAL_ANON_KEY);
      modifiedHeaders.set('authorization', updatedAuth);
      keysSwapped = true;
    }

    if (keysSwapped) {
      console.log('[Gateway] 🔑 Security Swap: Successfully replaced dummy key with REAL_ANON_KEY.');
    }

    // 4. Forwarding
    const init = {
      method: request.method,
      headers: modifiedHeaders,
      redirect: 'manual'
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // Clone the stream to avoid "body already used" errors if logging/parsing happened
      init.body = request.body;
    }

    try {
      const response = await fetch(targetUrl.toString(), init);
      console.log(`[Gateway] ✅ Backend responded with HTTP ${response.status}`);
      
      if (response.status === 101) return response;

      const responseHeaders = new Headers(response.headers);
      // Ensure the frontend receives the correct CORS headers back
      responseHeaders.set('Access-Control-Allow-Origin', corsOrigin);
      responseHeaders.set('Access-Control-Allow-Credentials', 'true');
      // Allow the frontend to see these specific headers (crucial for pagination and versions)
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