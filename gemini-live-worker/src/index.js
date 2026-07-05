import { Agent, getAgentByName } from "agents";

// ==============================================================================
// THE STATEFUL DURABLE OBJECT VOICE AGENT (MIRON)
// ==============================================================================
export class GeminiLiveAgent extends Agent {
  constructor(state, env) {
    super(state, env);
    this.connections = new Set();
    this.geminiWs = null;
    this.isInitializingGemini = false;
    this.isGeminiSetupComplete = false;
    this.messageQueue = [];
    console.log(`[Agent|DO|INIT] 🏗️ Constructor initialized. DO ID: ${this.id}`);
  }

  async onConnect(connection) {
    console.log(`[Agent|DO|CONNECT] Client joined live stage. Active connections before: ${this.connections.size}`);
    this.connections.add(connection);

    connection.addEventListener("message", (event) => {
      const isString = typeof event.data === 'string';
      const byteLen = isString ? new Blob([event.data]).size : event.data.byteLength;
      
      console.log(`[Agent|CLIENT->DO] Message Received. Type: ${isString ? 'String' : 'Binary/Buffer'}, Size: ${byteLen} bytes`);
      
      if (isString) {
          const sample = event.data.substring(0, 150).replace(/\n/g, '');
          console.log(`[Agent|CLIENT->DO|PAYLOAD] ${sample}`);
      } else {
          console.log(`[Agent|CLIENT->DO|BINARY] ArrayBuffer/Blob of length ${byteLen} received.`);
      }

      if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN && this.isGeminiSetupComplete) {
        try {
          this.geminiWs.send(event.data);
          // Only log string payloads natively to prevent binary log spam, but log the fact it went through
          if (isString && event.data.includes('"realtimeInput"')) {
               // Normal audio frame, silently pipe
          } else {
               console.log(`[Agent|DO->GEMINI] Forwarded ${byteLen} bytes successfully.`);
          }
        } catch (err) {
          console.error(`[Agent|DO->GEMINI] ❌ Send Error: ${err.message}`, err.stack);
        }
      } else {
        if (isString && event.data.includes('"realtimeInput"')) {
           console.log(`[Agent|DO|DROP] Dropping realtime audio frame. Gemini not ready. State: WS=${this.geminiWs?.readyState}, SetupComplete=${this.isGeminiSetupComplete}`);
        } else {
           console.log(`[Agent|DO|QUEUE] ⏳ Upstream not ready. Queueing message. Queue size: ${this.messageQueue.length + 1}`);
           this.messageQueue.push(event.data);
        }
      }
    });

    connection.addEventListener("close", (event) => {
      console.log(`[Agent|DO|DISCONNECT] Client left stage. Code: ${event.code}, Reason: ${event.reason}`);
      this.connections.delete(connection);

      if (this.connections.size === 0 && this.geminiWs) {
        console.log("[Agent|DO|CLEANUP] Stage empty. Closing upstream Gemini WS.");
        try {
          this.geminiWs.close(1000, "Stage empty");
        } catch (e) {
          console.error("[Agent|DO|CLEANUP] Error closing Gemini WS:", e.message);
        }
        this.geminiWs = null;
      }
    });

    if (!this.geminiWs && !this.isInitializingGemini) {
      console.log(`[Agent|DO] First client connected. Triggering Gemini initialization.`);
      await this.initSharedGemini();
    }
  }

  async initSharedGemini() {
    this.isInitializingGemini = true;
    console.log(`[Agent|GEMINI|INIT] 🚀 Starting Gemini initialization sequence for DO: ${this.id}`);

    let geminiKey;
    try {
      const supabaseUrl = this.env?.SUPABASE_URL;
      const serviceRoleKey = this.env?.SUPABASE_SERVICE_ROLE_KEY;
      console.log(`[Agent|GEMINI|DB] Fetching key. Env status -> SUPABASE_URL: ${!!supabaseUrl}, SUPABASE_SERVICE_ROLE_KEY: ${!!serviceRoleKey}`);
      
      if (!supabaseUrl || !serviceRoleKey) {
         throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Worker environment variables.");
      }

      const rpcUrl = `${supabaseUrl}/rest/v1/rpc/lease_gemini_api_key`;
      console.log(`[Agent|GEMINI|DB] Executing POST request to Supabase RPC: ${rpcUrl}`);

      const dbResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`
        }
      });

      console.log(`[Agent|GEMINI|DB] Supabase response status: ${dbResponse.status} ${dbResponse.statusText}`);

      if (!dbResponse.ok) {
        const errText = await dbResponse.text();
        console.error(`[Agent|GEMINI|DB] ❌ RPC Error Response Body: ${errText}`);
        throw new Error(`Supabase RPC HTTP ${dbResponse.status}: ${errText}`);
      }

      const dbData = await dbResponse.json();
      console.log(`[Agent|GEMINI|DB] RPC JSON Parsed successfully. Array length: ${dbData?.length || 0}`);
      
      if (!dbData || !dbData[0] || !dbData[0].api_key) {
         console.error(`[Agent|GEMINI|DB] ❌ Invalid payload structure:`, JSON.stringify(dbData));
         throw new Error("RPC returned empty or invalid key payload: " + JSON.stringify(dbData));
      }
      
      geminiKey = dbData[0].api_key;
      console.log(`[Agent|GEMINI|DB] ✅ Successfully leased Gemini API Key. Masked: ${geminiKey.substring(0, 4)}...${geminiKey.substring(geminiKey.length - 4)}`);
    } catch (err) {
      console.error(`[Agent|GEMINI|DB] ❌ Failed to lease key:`, err.message, err.stack);
      this.broadcast(JSON.stringify({ error: `Database key lease failed: ${err.message}` }));
      this.isInitializingGemini = false;
      return;
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiKey}`;
    try {
      console.log(`[Agent|GEMINI|WS] 🌐 Initiating WebSocket connection to Google... Target URL length: ${geminiUrl.length}`);
      console.log(`[Agent|GEMINI|WS] Handshake headers: { Upgrade: "websocket" }`);
      
      const geminiResponse = await fetch(geminiUrl, { headers: { "Upgrade": "websocket" } });
      console.log(`[Agent|GEMINI|WS] Handshake Response Status: ${geminiResponse.status} ${geminiResponse.statusText}`);
      console.log(`[Agent|GEMINI|WS] Handshake Headers:`, JSON.stringify([...geminiResponse.headers]));

      const ws = geminiResponse.webSocket;
      
      if (!ws) {
        let errText = "Unknown handshake rejection.";
        try {
          errText = await geminiResponse.text();
        } catch (e) {
          console.error("[Agent|GEMINI|WS] Could not read error response text.", e.message);
        }
        console.error(`[Agent|GEMINI|WS] ❌ Websocket missing from response! Body: ${errText}`);
        throw new Error(`Google Handshake HTTP ${geminiResponse.status}: ${errText}`);
      }

      ws.accept();
      this.geminiWs = ws;
      this.isInitializingGemini = false;
      console.log(`[Agent|GEMINI|WS] ✅ WebSocket accepted and mounted!`);

      const setupMessage = {
        setup: {
          model: "models/gemini-3.1-flash-live-preview",
          generationConfig: { responseModalities: ["AUDIO"] }
        }
      };
      
      const setupMessageStr = JSON.stringify(setupMessage);
      console.log(`[Agent|GEMINI|WS] Sending natively constructed Setup Payload: ${setupMessageStr}`);
      
      try {
        ws.send(setupMessageStr);
        console.log("[Agent|GEMINI|WS] ✅ Setup payload sent successfully. Awaiting SetupComplete...");
      } catch (e) {
        console.error("[Agent|GEMINI|WS] ❌ Failed to send setup payload:", e.message, e.stack);
      }
      
      ws.addEventListener("message", async (event) => {
        let data = event.data;
        const isBinary = data instanceof ArrayBuffer || data instanceof Blob;

        if (data instanceof ArrayBuffer) {
          data = new TextDecoder().decode(data);
          console.log(`[Agent|GEMINI->DO] Decoded ArrayBuffer to String. Length: ${data.length}`);
        } else if (data instanceof Blob) {
          try {
            console.log(`[Agent|GEMINI->DO] Blob Size: ${data.size} bytes. Converting to text...`);
            data = await data.text();
            console.log(`[Agent|GEMINI->DO] Blob Text length: ${data.length}`);
          } catch (e) {
            console.error("[Agent|GEMINI->DO] ❌ Failed to parse binary Blob payload:", e.message, e.stack);
            return;
          }
        }
        
        if (typeof data === 'string') {
            const preview = data.substring(0, 250).replace(/\n/g, '\\n');
            if (!preview.includes('serverContent')) {
                console.log(`[Agent|GEMINI->DO|PAYLOAD] -> ${preview}`);
            }
        }
        
        if (typeof data === 'string' && data.includes('"setupComplete"')) {
          console.log("[Agent|GEMINI|WS] 🟢 SetupComplete received! Gemini is fully ready. Unlocking queues...");
          this.isGeminiSetupComplete = true;

          console.log(`[Agent|GEMINI|WS] Flushing ${this.messageQueue.length} queued messages...`);
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            try {
              if (typeof msg === 'string' && msg.includes('"setup"')) {
                console.log("[Agent|GEMINI|WS] Discarding redundant client setup payload from queue.");
                continue;
              }
              ws.send(msg);
            } catch(e) {
              console.error("[Agent|GEMINI|WS] ❌ Error flushing queue msg:", e.message, e.stack);
            }
          }
        }

        this.broadcast(data);
      });

      ws.addEventListener("close", (event) => {
        console.log(`[Agent|GEMINI|WS] 🔴 Upstream Gemini WebSocket Closed.`);
        console.log(`[Agent|GEMINI|WS] Close Code: ${event.code}`);
        console.log(`[Agent|GEMINI|WS] Close Reason: ${event.reason || 'No reason provided'}`);
        console.log(`[Agent|GEMINI|WS] Was Clean: ${event.wasClean}`);
        this.geminiWs = null;
        this.isGeminiSetupComplete = false;
        this.broadcast(JSON.stringify({ 
          event: "stage_closed", 
          reason: "Gemini ended session",
          code: event.code,
          details: event.reason
        }));
      });

      ws.addEventListener("error", (err) => {
        console.error("[Agent|GEMINI|WS] ❌ Upstream Gemini WebSocket Error Triggered.");
        console.error(`[Agent|GEMINI|WS] Error Details: ${err.message || err.error || JSON.stringify(err)}`);
        this.broadcast(JSON.stringify({
          event: "gemini_error",
          error: err.message || "Unknown WebSocket error"
        }));
      });

    } catch (err) {
      console.error("[Agent|GEMINI|INIT] ❌ Failed to initialize Gemini Live connection:", err.message, err.stack);
      this.broadcast(JSON.stringify({ error: `Gemini connection failed: ${err.message}` }));
      this.isInitializingGemini = false;
    }
  }

  broadcast(data) {
    let sentCount = 0;
    let failCount = 0;
    for (const conn of this.connections) {
      try {
        conn.send(data);
        sentCount++;
      } catch (err) {
        console.error(`[Agent|DO|BROADCAST] ❌ Failed to broadcast payload to connection:`, err.message);
        failCount++;
      }
    }
    if (failCount > 0) {
       console.log(`[Agent|DO|BROADCAST] Success: ${sentCount}, Failed: ${failCount}`);
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    console.log(`[GeminiWorker|Router] 🚀 Incoming request: ${request.method} ${request.url}`);
    const url = new URL(request.url);
    
    if (url.pathname === '/realtime-ai') {
      const agentId = url.searchParams.get("agent");
      if (!agentId) {
         console.error("[GeminiWorker|Router] ❌ Missing agent ID in URL");
         return new Response("Missing agent ID", { status: 400 });
      }
      
      console.log(`[GeminiWorker|Router] Resolving Durable Object for Agent ID: ${agentId}`);
      try {
         const stub = await getAgentByName(env.GeminiLiveAgent, agentId);
         console.log(`[GeminiWorker|Router] Forwarding request to DO stub...`);
         return stub.fetch(request);
      } catch(err) {
         console.error(`[GeminiWorker|Router] ❌ Error routing to Agent: ${err.message}\nStack: ${err.stack}`);
         return new Response(`Agent routing error: ${err.message}`, { status: 500 });
      }
    }
    
    return new Response("Gemini Live Edge Worker active. Use /realtime-ai endpoint.", { status: 200 });
  }
}