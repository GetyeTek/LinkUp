export default {
  async fetch(request, env) {
    // Only accept POST requests from Telegram
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (env.TELEGRAM_WEBHOOK_SECRET && secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 403 });
    }

    try {
      const update = await request.json();
      
      // Handle both new messages and edited messages
      const msg = update.message || update.edited_message;
      
      if (msg && msg.text) {
        console.log(`[ShadowScraper] Incoming from Chat ${msg.chat.id}: ${msg.text.substring(0, 50)}...`);

        const payload = {
          telegram_id: msg.message_id,
          channel_handle: msg.chat.username || msg.chat.title || "Private",
          sender_id: msg.from.id,
          sender_name: msg.from.first_name ? `${msg.from.first_name} ${msg.from.last_name || ''}`.trim() : "Unknown",
          sender_username: msg.from.username || null,
          full_text: msg.text,
          telegram_timestamp: new Date(msg.date * 1000).toISOString(),
          metadata: {
            source: "realtime_webhook",
            is_edited: !!update.edited_message,
            reply_to: msg.reply_to_message?.message_id || null
          }
        };

        // Fire to Supabase REST API
        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/campus_feed`, {
          method: "POST",
          headers: {
            "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[ShadowScraper] Supabase Ingestion Failed: ${errText}`);
          return new Response("DB Error", { status: 500 });
        }
      }

      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error(`[ShadowScraper] Fatal Worker Error: ${err.message}`);
      return new Response("Internal Error", { status: 500 });
    }
  }
};