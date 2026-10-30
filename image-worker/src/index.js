const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Key"
};

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
        JSON.stringify({ status: "online", model: "@cf/black-forest-labs/flux-1-schnell" }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
        status: 405,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }

    // Optional API key enforcement if AUTH_KEY secret is configured in Worker
    if (env.AUTH_KEY) {
      const clientKey = request.headers.get("X-Auth-Key") || url.searchParams.get("key");
      if (!clientKey || clientKey !== env.AUTH_KEY) {
        return new Response(JSON.stringify({ error: "Unauthorized: Invalid or missing X-Auth-Key" }), {
          status: 401,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }
    }

    try {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body provided" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }

      const prompt = (body.prompt || "").trim();
      if (!prompt) {
        return new Response(JSON.stringify({ error: "Missing required parameter: prompt" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }

      const steps = Math.min(Math.max(parseInt(body.steps, 10) || 4, 1), 8);

      const response = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
        prompt: prompt,
        steps: steps
      });

      if (!response || !response.image) {
        return new Response(JSON.stringify({ error: "Workers AI returned empty image output" }), {
          status: 502,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }

      const binaryString = atob(response.image);
      const imageBytes = Uint8Array.from(binaryString, (char) => char.codePointAt(0));

      return new Response(imageBytes, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=86400"
        }
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: err.message || "Internal server error occurred during inference",
          details: String(err)
        }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        }
      );
    }
  }
};