const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Key"
};

const SYSTEM_INSTRUCTION =
  "You are a real-time inline predictive text engine (Ghost Text / Smart Compose). " +
  "Continue the user's sentence directly and naturally. " +
  "Rules: " +
  "1. Output ONLY the immediate next 3 to 8 words. " +
  "2. Do NOT repeat any words from the prompt. " +
  "3. Do NOT include conversational filler, greetings, quotes, or markdown. " +
  "4. If the sentence already ends with terminal punctuation, output an empty string.";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(
        JSON.stringify({ status: "online", service: "autocomplete-engine", model: "@cf/meta/llama-3.2-1b-instruct" }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
        status: 405,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }

    if (env.AUTH_KEY) {
      const clientKey = request.headers.get("X-Auth-Key") || url.searchParams.get("key");
      if (!clientKey || clientKey !== env.AUTH_KEY) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }
    }

    // === ROUTE: /transform (Native Android In-Place Text Editor) ===
    if (url.pathname === "/transform") {
      let text = "";
      let mode = "fix";

      try {
        const body = await request.json();
        text = (body.text || "").trim();
        mode = (body.mode || "fix").toLowerCase();
      } catch {
        text = (await request.text()).trim();
      }

      if (!text) {
        return new Response("", {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" }
        });
      }

      const instruction = mode === "expand"
        ? "You are a prompt expander and creative writing assistant. Expand the provided text into a vivid, detailed, high-quality prompt while keeping the original core concept intact. Output ONLY the expanded text with no preamble, quotes, or markdown."
        : "You are an expert copyeditor. Fix all typos, spelling mistakes, awkward grammar, and punctuation while strictly preserving the author's original meaning, voice, and casual nuances. Output ONLY the corrected text. Do NOT add conversational filler, explanations, preface, or quotation marks.";

      try {
        const aiResponse = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
          messages: [
            { role: "system", content: instruction },
            { role: "user", content: text }
          ],
          max_tokens: 600,
          temperature: 0.3
        });

        let result = (aiResponse && aiResponse.response) ? aiResponse.response.trim() : text;
        result = result.replace(/^["'`]+|["'`]+$/g, "");
        result = result.replace(/^(Here is the (corrected|polished|revised) text:?\s*)/i, "").trim();

        return new Response(result, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "text/plain; charset=utf-8"
          }
        });
      } catch (err) {
        return new Response(text, {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" }
        });
      }
    }

    try {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }

      const text = (body.text || "").trim();
      if (!text) {
        return new Response(JSON.stringify({ prediction: "" }), {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }

      // Keep only recent context window to maximize speed and minimize token burn
      const context = text.slice(-400);
      const chosenModel = body.model === "3b"
        ? "@cf/meta/llama-3.2-3b-instruct"
        : "@cf/meta/llama-3.2-1b-instruct";

      const startTime = Date.now();
      const aiResponse = await env.AI.run(chosenModel, {
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: `Text to continue:\n${context}` }
        ],
        max_tokens: 12,
        temperature: 0.2
      });

      let raw = (aiResponse && aiResponse.response) ? aiResponse.response : "";

      // Sanitize: strip out markdown artifacts, quotes, or accidental chatter
      raw = raw.replace(/^["'`\s]+/, "").replace(/["'`]+$/, "");
      raw = raw.replace(/^(Sure|Here|Next words?:|Completion:)\s*/i, "");

      // Ensure single leading space if continuing an unfinished word/sentence
      if (raw && !text.endsWith(" ") && !raw.startsWith(" ") && !raw.match(/^[,.!?]/)) {
        raw = " " + raw;
      }

      const inferenceMs = Date.now() - startTime;

      return new Response(
        JSON.stringify({
          prediction: raw,
          inference_ms: inferenceMs,
          model: chosenModel
        }),
        {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json"
          }
        }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message || "Autocomplete inference failure" }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        }
      );
    }
  }
};