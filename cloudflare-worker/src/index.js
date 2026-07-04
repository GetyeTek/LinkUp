import { Agent, routeAgentRequest, getAgentByName } from "agents";

// ==============================================================================
// 1. THE STATEFUL DURABLE OBJECT VOICE AGENT (MIRON)
// ==============================================================================
export class GeminiLiveAgent extends Agent {
  constructor(state, env) {
    super(state, env);
    this.connections = new Set();
    this.geminiWs = null;
    this.isInitializingGemini = false;
    this.messageQueue = [];
  }

  // Triggered when any user (hostess or attendant) joins this specific stage UUID
  async onConnect(connection) {
    console.log(`[Agent] Client joined live stage instance: ${this.id}`);
    this.connections.add(connection);

    // Accept the client WebSocket connection immediately
    connection.accept();

    // Route incoming audio/text from ANY client on the stage to the single Gemini instance
    connection.addEventListener("message", (event) => {
      const sample = typeof event.data === 'string' ? event.data.substring(0, 150).replace(/\n/g, '') : 'Binary Payload';
      console.log(`[Agent|IN] From Client: ${sample}`);
      
      if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN) {
        try {
          this.geminiWs.send(event.data);
        } catch (err) {
          console.error("[Agent] Error piping client data to shared Gemini:", err.message);
        }
      } else {
        console.log(`[Agent|QUEUE] Upstream WS not ready. Queueing message.`);
        this.messageQueue.push(event.data);
      }
    });

    connection.addEventListener("close", (event) => {
      console.log(`[Agent] Client left the stage. Code: ${event.code}`);
      this.connections.delete(connection);

      // AUTO-CLEANUP: If everyone leaves the stage, close the Gemini pipe to preserve key limits
      if (this.connections.size === 0 && this.geminiWs) {
        console.log("[Agent] Stage is empty. Terminating upstream Gemini session...");
        try {
          this.geminiWs.close(1000, "Stage empty");
        } catch (_) {}
        this.geminiWs = null;
      }
    });

    // Initialize the shared Gemini instance if it's the first connection
    if (!this.geminiWs && !this.isInitializingGemini) {
      await this.initSharedGemini();
    }
  }

  // Spawns the single, shared Gemini instance for this live stage room
  async initSharedGemini() {
    this.isInitializingGemini = true;
    console.log("[Agent] Spawning shared Gemini brain for the stage...");

    let geminiKey;
    try {
      const supabaseUrl = this.env.SUPABASE_URL;
      const serviceRoleKey = this.env.SUPABASE_SERVICE_ROLE_KEY;
      const rpcUrl = `${supabaseUrl}/rest/v1/rpc/get_and_rotate_gemini_key`;

      const dbResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`
        }
      });

      if (!dbResponse.ok) {
        throw new Error(`Supabase RPC status ${dbResponse.status}`);
      }

      const dbData = await dbResponse.json();
      geminiKey = dbData[0].selected_key;
    } catch (err) {
      console.error("[Agent] Failed to lease key for shared stage:", err.message);
      this.broadcast(JSON.stringify({ error: "Database key lease failed" }));
      this.isInitializingGemini = false;
      return;
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiKey}`;
    try {
      const geminiResponse = await fetch(geminiUrl, { headers: { "Upgrade": "websocket" } });
      const ws = geminiResponse.webSocket;
      
      if (!ws) {
        throw new Error("Handshake rejected by Google servers.");
      }

      ws.accept();
      this.geminiWs = ws;
      this.isInitializingGemini = false;
      
      console.log(`[Agent|GEMINI] Handshake accepted! Flushing ${this.messageQueue.length} queued messages...`);
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift();
        try {
          ws.send(msg);
        } catch(e) {
          console.error("[Agent|GEMINI] Error flushing queue msg:", e.message);
        }
      }

      // Broadcast Gemini's raw binary voice/text outputs to ALL clients currently on the stage
      ws.addEventListener("message", async (event) => {
        let data = event.data;
        if (data instanceof ArrayBuffer) {
          data = new TextDecoder().decode(data);
        } else if (data instanceof Blob) {
          try {
            data = await data.text();
          } catch (e) {
            console.error("[Agent] Failed to parse binary Blob payload:", e.message);
            return;
          }
        }
        
        const preview = typeof data === 'string' ? data.substring(0, 150).replace(/\n/g, '') : 'Binary';
        console.log(`[Agent|GEMINI] -> [Clients] Broadcasting: ${preview}`);
        
        // Push the voice bytes to every student/hostess listening on this stage
        this.broadcast(data);
      });

      ws.addEventListener("close", (event) => {
        console.log("[Agent] Shared Gemini closed session.");
        this.geminiWs = null;
        this.broadcast(JSON.stringify({ event: "stage_closed", reason: "Gemini ended session" }));
      });

      ws.addEventListener("error", (err) => {
        console.error("[Agent] Upstream Gemini WS error:", err.message);
      });

      console.log("[Agent] Shared Gemini brain is active and broadcasting to the stage!");

    } catch (err) {
      console.error("[Agent] Failed to initialize Gemini Live connection:", err.message);
      this.broadcast(JSON.stringify({ error: "Gemini connection failed" }));
      this.isInitializingGemini = false;
    }
  }

  // Broadcaster helper: Iterates through all connected clients on the edge
  broadcast(data) {
    for (const conn of this.connections) {
      try {
        conn.send(data);
      } catch (err) {
        console.error("[Agent] Failed to broadcast payload to connection:", err.message);
      }
    }
  }
}

// ==============================================================================
// 2. THE UNIFIED API GATEWAY & ROUTER (RE-INTEGRATED)
// ==============================================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    console.log(`[Gateway] 🚀 Incoming Request: ${request.method} ${url.pathname}`);

    // A. Route AI Stage WebSocket connections directly to our local Durable Object Agent
    if (url.pathname === '/realtime-ai') {
      const agentId = url.searchParams.get("agent");
      if (!agentId) return new Response("Missing agent ID", { status: 400 });
      
      const stub = await getAgentByName(env.GeminiLiveAgent, agentId);
      return stub.fetch(request);
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

    // Detect browser direct media serving, file downloads, or native WebSockets
    const isBypassed = url.pathname.startsWith('/storage/v1/object/public/') || 
                       url.pathname.startsWith('/storage/v1/object/sign/') ||
                       url.pathname.startsWith('/storage/v1/render/image/public/') ||
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