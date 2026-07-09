export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
        return new Response("Auth Bot Active. Send POST from Telegram Webhook.", { status: 200 });
    }

    try {
      const update = await request.json();
      const msg = update.message;
      
      // We only handle Private Chats for Authentication
      if (msg && msg.chat.type === 'private' && msg.text) {
        if (msg.text.startsWith('/start') || msg.text.startsWith('/login')) {
          
          const token = crypto.randomUUID();
          const expiresAt = new Date(Date.now() + 5 * 60000).toISOString(); // 5 min lifespan

          // 1. Dead-drop the token in Supabase
          const sbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/telegram_login_tokens`, {
            method: 'POST',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              token_hash: token,
              telegram_id: msg.from.id,
              expires_at: expiresAt,
              metadata: {
                first_name: msg.from.first_name,
                last_name: msg.from.last_name,
                username: msg.from.username
              }
            })
          });

          if (!sbRes.ok) {
            console.error("Supabase Token Stash Failed:", await sbRes.text());
            return new Response("OK");
          }

          // 2. Reply to user with the Magic Link
          const tgRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: msg.chat.id,
              text: `🚀 *LinkUp Security Terminal* 🛡️\n\nWelcome, ${msg.from.first_name}!\n\nTap the button below to authenticate your session. This secure link is single-use and expires in 5 minutes.`,
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[
                  { text: "⚡ Enter LinkUp Dashboard", url: `https://getyeteklu2.github.io/LinkUp/?auth_token=${token}` }
                ]]
              }
            })
          });

          if (!tgRes.ok) console.error("Telegram SendMessage Failed:", await tgRes.text());
        }
      }

      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("Worker Crash:", err.message);
      return new Response("OK", { status: 200 }); // Always tell Telegram OK so it stops retrying failed payloads
    }
  }
};