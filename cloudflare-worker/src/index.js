import { Agent, routeAgentRequest } from "agents";

export class GeminiLiveAgent extends Agent {
  async onConnect(connection) {
    console.log(`[Agent] Connection request received on instance: ${this.id}`);

    let geminiKey;
    
    // 1. Fetch the API Key from Supabase Pool (Done BEFORE touching WebSocketPair to avoid hangs)
    try {
      const supabaseUrl = this.env.SUPABASE_URL;
      const serviceRoleKey = this.env.SUPABASE_SERVICE_ROLE_KEY;

      console.log(`[Agent] Querying Supabase RPC at: ${supabaseUrl}`);
      
      if (!supabaseUrl || !serviceRoleKey) {
        throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY inside Cloudflare environment secrets.");
      }

      const rpcUrl = `${supabaseUrl}/rest/v1/rpc/get_and_rotate_gemini_key`;
      
      const dbResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`
        }
      });

      console.log(`[Agent] Supabase response status: ${dbResponse.status} ${dbResponse.statusText}`);

      if (!dbResponse.ok) {
        const dbErrText = await dbResponse.text();
        throw new Error(`Supabase RPC failed with status ${dbResponse.status}. Raw DB Response: ${dbErrText}`);
      }

      const dbData = await dbResponse.json();
      console.log("[Agent] Supabase RPC JSON parsed successfully.", JSON.stringify(dbData));

      if (!Array.isArray(dbData) || dbData.length === 0 || !dbData[0].selected_key) {
        throw new Error("Supabase RPC returned success but no keys were returned. Is your 'api_keys' table empty, or are all keys inactive/cooldown?");
      }

      geminiKey = dbData[0].selected_key;
      console.log("[Agent] Successfully selected and rotated an active Gemini API Key.");

    } catch (dbErr) {
      console.error("[Agent] CRITICAL DATABASE ERROR:", dbErr.message);
      if (dbErr.stack) console.error(dbErr.stack);
      connection.close(1011, "Database key-retrieval failure");
      return;
    }

    // 2. Handshake with Gemini's Multimodal Live API
    let geminiResponse;
    const geminiUrl = `https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiKey}`;
    
    try {
      console.log("[Agent] Initiating outbound WebSocket handshake to Google Gemini...");
      geminiResponse = await fetch(geminiUrl, {
        headers: { "Upgrade": "websocket" }
      });
      console.log(`[Agent] Gemini response status: ${geminiResponse.status} ${geminiResponse.statusText}`);
    } catch (fetchErr) {
      console.error("[Agent] CRITICAL GEMINI HANDSHAKE FETCH ERROR:", fetchErr.message);
      connection.close(1011, "Failed to connect to Google Gemini");
      return;
    }

    const geminiWs = geminiResponse.webSocket;
    if (!geminiWs) {
      let rawDetails = "";
      try {
        rawDetails = await geminiResponse.text();
      } catch (readErr) {
        rawDetails = `Could not read response text: ${readErr.message}`;
      }

      console.error("[Agent] GEMINI REJECTED HANDSHAKE:", geminiResponse.status, rawDetails);
      connection.close(1011, "Gemini handshake rejected");
      return;
    }

    // Accept both local client connection and outbound Gemini WS
    connection.accept();
    geminiWs.accept();

    // 3. Establish Bidirectional Bridging (Pipe client <-> Gemini)
    
    // Client (Browser) message -> Forwarded to Gemini
    connection.addEventListener("message", (event) => {
      try {
        geminiWs.send(event.data);
      } catch (err) {
        console.error("[Agent] Error forwarding message from browser to Gemini:", err.message);
        try {
          connection.send(JSON.stringify({
            error: "Error forwarding message to Gemini",
            message: err.message
          }));
        } catch (_) {}
      }
    });

    connection.addEventListener("close", (event) => {
      console.log(`[Agent] Browser closed connection. Code: ${event.code}, Reason: ${event.reason}`);
      try {
        geminiWs.close(event.code, event.reason);
      } catch (_) {}
    });

    connection.addEventListener("error", (err) => {
      console.error("[Agent] Browser WebSocket error event:", err);
    });

    // Gemini message -> Forwarded back to Client (Browser)
    geminiWs.addEventListener("message", (event) => {
      try {
        let data = event.data;
        if (data instanceof ArrayBuffer) {
          data = new TextDecoder().decode(data);
        } else if (data instanceof Blob) {
          data.text().then(text => {
            connection.send(text);
          }).catch(blobErr => {
            connection.send(JSON.stringify({
              error: "Failed to read binary Blob message from Gemini",
              message: blobErr.message
            }));
          });
          return;
        }
        connection.send(data);
      } catch (err) {
        console.error("[Agent] Error forwarding message from Gemini to browser:", err.message);
        try {
          connection.send(JSON.stringify({
            error: "Error forwarding Gemini message to browser",
            message: err.message
          }));
        } catch (_) {}
      }
    });

    geminiWs.addEventListener("close", (event) => {
      console.log(`[Agent] Gemini closed connection. Code: ${event.code}, Reason: ${event.reason}`);
      try {
        connection.close(event.code, event.reason);
      } catch (_) {}
    });

    geminiWs.addEventListener("error", (err) => {
      console.error("[Agent] Outbound Gemini WebSocket error event:", err);
      try {
        connection.send(JSON.stringify({
          error: "Outbound Gemini WebSocket error occurred",
          message: err.message
        }));
      } catch (_) {}
    });

    console.log("[Agent] Handshake finalized. WebSocket pair pipe is active.");
  }
}

export default {
  async fetch(request, env) {
    return (await routeAgentRequest(request, env)) ?? new Response("Connect using WebSockets.", { status: 426 });
  }
};