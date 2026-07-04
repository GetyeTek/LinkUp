import { Agent, routeAgentRequest } from "agents";

export class GeminiLiveAgent extends Agent {
  constructor(state, env) {
    super(state, env);
    this.connections = new Set();
    this.geminiWs = null;
    this.isInitializingGemini = false;
  }

  // Triggered when any user (hostess or attendant) joins this specific stage UUID
  async onConnect(connection) {
    console.log(`[Agent] Client joined live stage instance: ${this.id}`);
    this.connections.add(connection);

    // Accept the client WebSocket connection immediately
    connection.accept();

    // Route incoming audio/text from ANY client on the stage to the single Gemini instance
    connection.addEventListener("message", (event) => {
      if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN) {
        try {
          this.geminiWs.send(event.data);
        } catch (err) {
          console.error("[Agent] Error piping client data to shared Gemini:", err.message);
        }
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

export default {
  async fetch(request, env) {
    return (await routeAgentRequest(request, env)) ?? new Response("Connect using WebSockets.", { status: 426 });
  }
};