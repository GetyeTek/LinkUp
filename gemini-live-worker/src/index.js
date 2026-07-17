// ==============================================================================
// THE STATEFUL DURABLE OBJECT VOICE AGENT (BARE METAL WEBSOCKET HIBERNATION)
// ==============================================================================

const sanitizeForSpeech = (txt) => {
    if (!txt) return "";
    return txt.replace(/\[print\]/gi, '').replace(/\{[uhpbit]\}/gi, '');
};

export class GeminiLiveAgent {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.geminiWs = null;
    this.isInitializingGemini = false;
    this.isGeminiSetupComplete = false;
    this.messageQueue = [];
    this.heartbeatTimer = null;
    this.conversationId = null;
    
    // Stateful Playback Engine
    this.readingQueue = [];
    this.currentChunkIndex = 0;
    this.stageState = "idle"; // "idle" | "reading" | "answering_qa" | "resuming_lecture"
    
    this.questionBucket = [];
    this.pendingAnswersQueue = [];
    this.lastAnsweredTime = Date.now();
    this.qaTimer = null;
    
    console.log(`[Agent|DO|INIT] 🏗️ Native Constructor initialized.`);
  }

  async dbHeartbeat() {
    if (!this.conversationId || this.ctx.getWebSockets().length === 0) return;
    const supabaseUrl = this.env?.SUPABASE_URL;
    const serviceKey = this.env?.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) return;

    try {
        const getRes = await fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${this.conversationId}&select=metadata`, {
            headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
        });
        const rows = await getRes.json();
        if (!rows || rows.length === 0) return;
        
        const meta = rows[0].metadata || {};
        
        // Only keep the heartbeat alive if Miron is actively designated as the host
        if (meta.is_live && meta.ai_hosting) {
            meta.live_heartbeat = new Date().toISOString();
            await fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${this.conversationId}`, {
                method: 'PATCH',
                headers: { 
                    'apikey': serviceKey, 
                    'Authorization': `Bearer ${serviceKey}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({ metadata: meta })
            });
        }
    } catch (e) {
        console.error("[Agent|DO|Heartbeat] DB Update Failed", e.message);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.conversationId = url.searchParams.get("agent");

    // Handle the Supabase dynamic chunk append webhook
    if (request.method === "POST" && url.searchParams.get("action") === "append_chunks") {
        try {
            const authHeader = request.headers.get("Authorization");
            const expectedAuth = `Bearer ${this.env?.SUPABASE_SERVICE_ROLE_KEY}`;
            if (authHeader !== expectedAuth) {
                return new Response("Unauthorized webhook trigger", { status: 401 });
            }

            const payload = await request.json();
            const dbChunks = payload.record?.lecture_chunks || [];
            const currentLength = this.readingQueue.length;

            if (dbChunks.length > currentLength) {
                const chunksToAppend = dbChunks.slice(currentLength);
                this.readingQueue.push(...chunksToAppend);
                console.log(`[Agent|DO|WEBHOOK] Webhook matched. Appended ${chunksToAppend.length} chunks. New total: ${this.readingQueue.length}`);
                return new Response(JSON.stringify({ success: true, appended: chunksToAppend.length }), { status: 200 });
            }
            return new Response(JSON.stringify({ success: true, appended: 0, reason: "No new chunks to process" }), { status: 200 });
        } catch (e) {
            console.error("[Agent|DO|WEBHOOK] Exception parsing append webhook:", e.message);
            return new Response(`Error: ${e.message}`, { status: 500 });
        }
    }

    console.log(`[Agent|DO|FETCH] 🚀 Intercepting WebSocket upgrade request...`);
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    // Initialize Miron's autonomous heartbeat engine
    if (!this.heartbeatTimer) {
        this.heartbeatTimer = setInterval(() => this.dbHeartbeat(), 15000);
    }

    // Initialize the Silent Double-Guardrail Bucket Compiler
    if (!this.qaTimer) {
        this.qaTimer = setInterval(async () => {
            if (this.questionBucket.length === 0) return;
            
            const timeSinceLast = Date.now() - this.lastAnsweredTime;
            // Guardrail: >= 3 questions OR >= 2 minutes
            if (this.questionBucket.length >= 3 || timeSinceLast >= 120000) {
                const questionsToProcess = [...this.questionBucket];
                this.questionBucket = [];
                this.lastAnsweredTime = Date.now();
                
                console.log(`[Agent|DO|REST] Bucket filled (${questionsToProcess.length} items). Compiling Q&A answers statelessly...`);

                try {
                    const res = await fetch(`${this.env.SUPABASE_URL}/functions/v1/miron-lecture-generator`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`
                        },
                        body: JSON.stringify({
                            action: 'compile_answers',
                            conversation_id: this.conversationId,
                            questions: questionsToProcess
                        })
                    });

                    if (res.ok) {
                        const data = await res.json();
                        console.log(`[Agent|DO|REST] Received ${data.answers?.length || 0} answers and ${data.flags?.length || 0} flags.`);
                        
                        // Immediately broadcast moderation flags to the Hostess UI
                        if (data.flags && data.flags.length > 0) {
                            this.broadcast(JSON.stringify({ type: "moderation_warning", flags: data.flags }));
                        }
                        
                        // Park answers silently until Miron finishes his current reading chunk
                        if (data.answers && data.answers.length > 0) {
                            this.pendingAnswersQueue.push(...data.answers);
                        }
                    } else {
                        console.error("[Agent|DO|REST] Edge Function failed:", await res.text());
                    }
                } catch(e) {
                    console.error("[Agent|DO|REST] Request threw exception:", e.message);
                }
            }
        }, 5000);
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    console.log(`[Agent|DO|CONNECT] Client securely joined live stage.`);

    // Trigger Gemini sync asynchronously so we don't block the handshake
    if (!this.geminiWs && !this.isInitializingGemini) {
      console.log(`[Agent|DO] First client connected. Triggering Gemini initialization.`);
      this.initSharedGemini();
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const isString = typeof message === 'string';
    const byteLen = isString ? new Blob([message]).size : message.byteLength;
    
    if (isString) {
        // --- INTERCEPT CONTROL MESSAGES (DO STATE MACHINE) ---
        try {
            const parsed = JSON.parse(message);
            if (parsed.action === "start_lecture") {
                console.log(`[Agent|DO|STATE] Intercepted start_lecture. Fetching chunks from database for ${this.conversationId}...`);
                
                try {
                    const res = await fetch(`${this.env.SUPABASE_URL}/rest/v1/live_study_sessions?conversation_id=eq.${this.conversationId}&select=lecture_chunks`, {
                        headers: {
                            'apikey': this.env.SUPABASE_SERVICE_ROLE_KEY,
                            'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`
                        }
                    });
                    
                    if (res.ok) {
                        const rows = await res.json();
                        const chunks = rows[0]?.lecture_chunks || [];
                        console.log(`[Agent|DO|STATE] Successfully loaded ${chunks.length} chunks from DB.`);
                        
                        this.readingQueue = chunks;
                        this.currentChunkIndex = 0;
                        this.stageState = "reading";
                        
                        if (this.readingQueue.length > 0) {
                            const rawChunk = this.readingQueue[0];
                            this.broadcast(JSON.stringify({ type: "chunk_transition", index: 0, chunk: rawChunk }));
                            
                            const textToSpeak = typeof rawChunk === 'object' ? (rawChunk.spoken_text || '') : rawChunk;
                            const cleanChunk = sanitizeForSpeech(textToSpeak);
                            const prompt = `Read the following segment exactly in your informal peer tone:\n\n${cleanChunk}`;
                            const payload = JSON.stringify({
                                clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true }
                            });
                            
                            if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN && this.isGeminiSetupComplete) {
                                this.geminiWs.send(payload);
                            } else {
                                this.messageQueue.push(payload);
                            }
                        }
                    } else {
                        console.error("[Agent|DO|STATE] Failed to fetch chunks:", await res.text());
                    }
                } catch(e) {
                    console.error("[Agent|DO|STATE] Exception fetching DB chunks:", e.message);
                }
                return;
            }
            
            if (parsed.action === "submit_question") {
                console.log(`[Agent|DO|STATE] Queuing silent question from ${parsed.sender}`);
                this.questionBucket.push({
                    user_id: parsed.user_id,
                    sender_name: parsed.sender,
                    text: parsed.text
                });
                return;
            }

            if (parsed.action === "inject_question") {
                console.log(`[Agent|DO|STATE] Intercepted inject_question. Compiling single pinned question immediately...`);
                const singleQuestion = {
                    user_id: parsed.user_id || "pinned_user",
                    sender_name: parsed.sender,
                    text: parsed.text
                };

                this.ctx.waitUntil((async () => {
                    try {
                        const res = await fetch(`${this.env.SUPABASE_URL}/functions/v1/miron-lecture-generator`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`
                            },
                            body: JSON.stringify({
                                action: 'compile_answers',
                                conversation_id: this.conversationId,
                                questions: [singleQuestion]
                              })
                        });

                        if (res.ok) {
                            const data = await res.json();
                            if (data.flags && data.flags.length > 0) {
                                this.broadcast(JSON.stringify({ type: "moderation_warning", flags: data.flags }));
                            }
                            if (data.answers && data.answers.length > 0) {
                                this.pendingAnswersQueue.push(...data.answers);
                                console.log(`[Agent|DO|STATE] Pinned question answer compiled and queued. Total pending answers: ${this.pendingAnswersQueue.length}`);
                            }
                        } else {
                            console.error("[Agent|DO|STATE] Failed to compile injected question:", await res.text());
                        }
                    } catch (e) {
                        console.error("[Agent|DO|STATE] Exception compiling injected question:", e.message);
                    }
                })());
                return;
            }
        } catch(e) { /* Fallthrough for non-JSON or standard WS frames */ }

        const sample = message.substring(0, 150).replace(/\n/g, '');
        console.log(`[Agent|CLIENT->DO|PAYLOAD] ${sample}`);
    } else {
        console.log(`[Agent|CLIENT->DO] Binary payload received. Size: ${byteLen} bytes`);
    }

    if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN && this.isGeminiSetupComplete) {
      try {
        this.geminiWs.send(message);
        if (!isString || !message.includes('"realtimeInput"')) {
             console.log(`[Agent|DO->GEMINI] Forwarded ${byteLen} bytes to Google successfully.`);
        }
      } catch (err) {
        console.error(`[Agent|DO->GEMINI] ❌ Send Error: ${err.message}`, err.stack);
      }
    } else {
      if (isString && message.includes('"realtimeInput"')) {
         console.log(`[Agent|DO|DROP] Dropping realtime audio frame. Gemini not ready.`);
      } else {
         console.log(`[Agent|DO|QUEUE] ⏳ Upstream not ready. Queueing message. Queue size: ${this.messageQueue.length + 1}`);
         this.messageQueue.push(message);
      }
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    console.log(`[Agent|DO|DISCONNECT] Client left stage. Code: ${code}, Reason: ${reason}`);
    
    // Auto-cleanup if all connected clients disconnect.
    // Cloudflare includes the closing socket in getWebSockets() during this event, so we must filter it.
    const activeSockets = this.ctx.getWebSockets().filter(s => s !== ws);
    
    if (activeSockets.length === 0) {
      console.log("[Agent|DO|CLEANUP] Stage is completely empty. Initiating teardown sequence...");
      
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      
      if (this.qaTimer) {
        clearInterval(this.qaTimer);
        this.qaTimer = null;
      }

      if (this.geminiWs) {
        console.log("[Agent|DO|CLEANUP] Closing upstream Gemini WS.");
        try {
          this.geminiWs.close(1000, "Stage empty");
        } catch (e) {
          console.error("[Agent|DO|CLEANUP] Error closing Gemini WS:", e.message);
        }
        this.geminiWs = null;
        this.isGeminiSetupComplete = false;
      }

      // Instantly kill the session in the database to stop the ghost pulsing
      if (this.conversationId) {
        const supabaseUrl = this.env?.SUPABASE_URL;
        const serviceKey = this.env?.SUPABASE_SERVICE_ROLE_KEY;
        
        if (supabaseUrl && serviceKey) {
          console.log(`[Agent|DO|CLEANUP] Nuking live session metadata for ${this.conversationId}`);
          
          try {
            // Fetch current metadata to avoid clobbering other fields
            const getRes = await fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${this.conversationId}&select=metadata`, {
                headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
            });
            
                          const rows = await getRes.json();
              if (rows && rows.length > 0) {
                  const meta = rows[0].metadata || {};
                  
                  // If the stage is still live but Miron has simply been toggled off,
                  // do not scrub the database properties. Let the human stay on stage!
                  if (meta.is_live && !meta.ai_hosting) {
                      console.log("[Agent|DO|CLEANUP] Miron toggled off. Human is still hosting. Preserving DB metadata.");
                      return;
                  }

                  // Scrub live properties
                  delete meta.is_live;
                  delete meta.ai_hosting;
                  delete meta.live_host_id;
                  delete meta.live_status;
                  delete meta.live_heartbeat;
                  delete meta.live_started_at;
                  delete meta.live_topic;

                // Patch conversation metadata
                await fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${this.conversationId}`, {
                    method: 'PATCH',
                    headers: { 
                        'apikey': serviceKey, 
                        'Authorization': `Bearer ${serviceKey}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify({ metadata: meta })
                });
                
                // Delete discovery record so it drops from the global feed
                await fetch(`${supabaseUrl}/rest/v1/live_study_sessions?conversation_id=eq.${this.conversationId}`, {
                    method: 'DELETE',
                    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
                });
                
                console.log("[Agent|DO|CLEANUP] Database successfully scrubbed. The ghost is dead.");
            }
          } catch (e) {
            console.error("[Agent|DO|CLEANUP] DB Teardown Failed", e.message);
          }
        }
      }
    }
  }

  async webSocketError(ws, error) {
    console.error(`[Agent|DO|ERROR] Client WebSocket threw an error:`, error);
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
          generationConfig: { responseModalities: ["AUDIO"] },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
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
            
            // --- NON-INTERRUPTIVE PIVOT PLAYBACK MANAGER ---
            try {
                const parsed = JSON.parse(data);
                if (parsed.serverContent && parsed.serverContent.turnComplete) {
                    if (this.stageState === "reading") {
                        this.currentChunkIndex++;
                        
                        // Pivot check: Did the REST compiler deliver answers?
                        if (this.pendingAnswersQueue.length > 0) {
                            this.stageState = "answering_qa";
                            const ans = this.pendingAnswersQueue.shift();
                            console.log(`[Agent|DO|STATE] Pivoting to Q&A. Delivering answer to ${ans.sender_name}...`);
                            
                            const rawChunk = `[print]{p}Q&A Time!{p}\n\n${ans.answer_text}[print]`;
                            this.broadcast(JSON.stringify({ type: "chunk_transition", index: -1, chunk: rawChunk }));
                            
                            const cleanChunk = sanitizeForSpeech(ans.answer_text);
                            const prompt = `Read the following answer exactly in your conversational tone:\n\n${cleanChunk}`;
                            ws.send(JSON.stringify({
                                clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true }
                            }));
                        } else if (this.currentChunkIndex < this.readingQueue.length) {
                            console.log(`[Agent|DO|STATE] Advancing lecture cursor to chunk ${this.currentChunkIndex}`);
                            const rawChunk = this.readingQueue[this.currentChunkIndex];
                            this.broadcast(JSON.stringify({ type: "chunk_transition", index: this.currentChunkIndex, chunk: rawChunk }));
                            
                            const textToSpeak = typeof rawChunk === 'object' ? (rawChunk.spoken_text || '') : rawChunk;
                            const cleanChunk = sanitizeForSpeech(textToSpeak);
                            const prompt = `Let's continue. Read this segment exactly:\n\n${cleanChunk}`;
                            ws.send(JSON.stringify({
                                clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true }
                            }));
                        } else {
                            // Lecture completed. Final clean-up of bucket if necessary.
                            console.log(`[Agent|DO|STATE] Lecture completed.`);
                            this.stageState = "idle";
                        }
                    } else if (this.stageState === "answering_qa") {
                        // Are there more answers?
                        if (this.pendingAnswersQueue.length > 0) {
                            const ans = this.pendingAnswersQueue.shift();
                            console.log(`[Agent|DO|STATE] Delivering next answer to ${ans.sender_name}...`);
                            
                            const rawChunk = `[print]{p}Q&A Time!{p}\n\n${ans.answer_text}[print]`;
                            this.broadcast(JSON.stringify({ type: "chunk_transition", index: -1, chunk: rawChunk }));
                            
                            const cleanChunk = sanitizeForSpeech(ans.answer_text);
                            const prompt = `Read the following answer exactly in your conversational tone:\n\n${cleanChunk}`;
                            ws.send(JSON.stringify({
                                clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true }
                            }));
                        } else {
                            // Queue empty, pivot back to lecture!
                            this.stageState = "resuming_lecture";
                            
                            this.broadcast(JSON.stringify({ type: "chunk_transition", index: -1, chunk: "" }));
                            
                            const prompt = `Read this exactly: "Alright guys, let's get back to the text!"`;
                            ws.send(JSON.stringify({
                                clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true }
                            }));
                        }
                    } else if (this.stageState === "resuming_lecture") {
                        this.stageState = "reading";
                        if (this.currentChunkIndex < this.readingQueue.length) {
                            console.log(`[Agent|DO|STATE] Resuming lecture at chunk ${this.currentChunkIndex}`);
                            const rawChunk = this.readingQueue[this.currentChunkIndex];
                            this.broadcast(JSON.stringify({ type: "chunk_transition", index: this.currentChunkIndex, chunk: rawChunk }));
                            
                            const textToSpeak = typeof rawChunk === 'object' ? (rawChunk.spoken_text || '') : rawChunk;
                            const cleanChunk = sanitizeForSpeech(textToSpeak);
                            const prompt = `Let's resume the lecture where we left off. Read this segment exactly:\n\n${cleanChunk}`;
                            ws.send(JSON.stringify({
                                clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true }
                            }));
                        } else {
                            console.log(`[Agent|DO|STATE] Lecture completed.`);
                            this.stageState = "idle";
                        }
                    }
                }
            } catch(e) {}
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
    const sockets = this.ctx.getWebSockets();
    let sentCount = 0;
    for (const sock of sockets) {
      try {
        sock.send(data);
        sentCount++;
      } catch (err) {
        console.error(`[Agent|DO|BROADCAST] ❌ Failed to broadcast payload to a connection:`, err.message);
      }
    }
  }
}

// ==============================================================================
// PURE ROUTER
// ==============================================================================
export default {
  async fetch(request, env, ctx) {
    console.log(`[GeminiWorker|Router] 🚀 Incoming request: ${request.method} ${request.url}`);
    const url = new URL(request.url);
    
    if (url.pathname === '/realtime-ai') {
      let agentId = url.searchParams.get("agent");

      // Autodetect conversation_id from standard Supabase webhook payload if not in URL query
      if (!agentId && request.method === "POST") {
        try {
          const clone = request.clone();
          const body = await clone.json();
          agentId = body.record?.conversation_id;
          console.log(`[GeminiWorker|Router] Webhook routing detected for Agent ID: ${agentId}`);
        } catch (e) {
          console.error("[GeminiWorker|Router] Failed to autodetect agent ID from webhook JSON body:", e.message);
        }
      }

      if (!agentId) {
         console.error("[GeminiWorker|Router] ❌ Missing agent ID in URL query and webhook payload");
         return new Response("Missing agent ID", { status: 400 });
      }
      
      console.log(`[GeminiWorker|Router] Resolving Native Durable Object for Stage UUID: ${agentId}`);
      try {
         // Raw native DO initialization
         const id = env.GeminiLiveAgent.idFromName(agentId);
         const stub = env.GeminiLiveAgent.get(id);
         console.log(`[GeminiWorker|Router] Forwarding request to DO stub...`);
         return stub.fetch(request);
      } catch(err) {
         console.error(`[GeminiWorker|Router] ❌ Error routing to Native DO: ${err.message}\nStack: ${err.stack}`);
         return new Response(`Native DO routing error: ${err.message}`, { status: 500 });
      }
    }
    
    return new Response("Gemini Live Edge Worker active. Hit /realtime-ai to initialize DO.", { status: 200 });
  }
}