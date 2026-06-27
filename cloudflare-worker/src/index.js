export default {
  async fetch(request, env, ctx) {
    // --- HARDCODED SECRETS (As requested for zero-config deployment) ---
    const REAL_SUPABASE_URL = 'https://ryaxynjczfwqyqvpmorl.supabase.co';
    const REAL_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5YXh5bmpjemZ3cXlxdnBtb3JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDkwMTEsImV4cCI6MjA5NzEyNTAxMX0.739vHhzkh4as9K4afPylbaMBsupGR_rFTgpATDYiWOY';
    
    // The fake key the frontend sends to trick sniffers
    const DUMMY_KEY = 'lk_live_9a38f2e7b1c4d9e0a2f8d73b';

    const url = new URL(request.url);
    console.log(`[Gateway] 🚀 Incoming Request: ${request.method} ${url.pathname}`);

    // 1. CORS Preflight (Crucial for browser security checks)
    if (request.method === 'OPTIONS') {
      console.log('[Gateway] 🛡️ Resolving CORS Preflight');
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept-encoding',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // 2. Map request to the real Supabase backend
    const targetUrl = new URL(url.pathname + url.search, REAL_SUPABASE_URL);
    console.log(`[Gateway] 🔀 Routing to: ${targetUrl.toString()}`);

    const modifiedHeaders = new Headers(request.headers);

    // 3. The Scrubbing Engine (Swap Dummy Keys for Real Keys)
    let keysSwapped = false;
    if (modifiedHeaders.get('apikey') === DUMMY_KEY) {
      modifiedHeaders.set('apikey', REAL_ANON_KEY);
      keysSwapped = true;
    }
    
    const authHeader = modifiedHeaders.get('authorization');
    if (authHeader && authHeader.includes(DUMMY_KEY)) {
      modifiedHeaders.set('authorization', `Bearer ${REAL_ANON_KEY}`);
      keysSwapped = true;
    }

    if (keysSwapped) {
      console.log('[Gateway] 🔑 Security Swap: Successfully replaced frontend dummy keys with real backend credentials.');
    } else {
      console.log('[Gateway] ⚠️ Warning: No dummy key found in headers. Proceeding as generic request.');
    }

    // 4. Forwarding (Native support for REST and WebSockets)
    const init = {
      method: request.method,
      headers: modifiedHeaders,
      redirect: 'manual'
    };

    // Body cannot be attached to GET or HEAD requests
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    try {
      console.log('[Gateway] ⏳ Executing fetch to backend...');
      const response = await fetch(targetUrl.toString(), init);
      console.log(`[Gateway] ✅ Backend responded with HTTP ${response.status}`);
      
      // Native WebSocket Passthrough (For Supabase Realtime/Chat)
      if (response.status === 101) {
         console.log('[Gateway] ⚡ WebSocket Upgrade Detected! Establishing direct realtime proxy tunnel.');
         return response;
      }

      // Standard HTTP Response: Clone and inject wildcard CORS so frontend doesn't block it
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Expose-Headers', 'x-supabase-api-version');

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