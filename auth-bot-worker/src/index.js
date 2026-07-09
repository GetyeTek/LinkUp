export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
        return new Response("Auth Bot Active. Send POST from Telegram Webhook.", { status: 200 });
    }

    try {
      const update = await request.json();
      
      // 1. Handle incoming text commands
      if (update.message) {
        const msg = update.message;
        
        if (msg && msg.chat.type === 'private' && msg.text) {
          if (msg.text.startsWith('/start') || msg.text.startsWith('/login')) {
            const landingText = `🏛️ *Welcome to LinkUp*\n\nLinkUp is the unified digital environment designed to coordinate your university journey. Seamlessly access textbook resources, engage in real-time academic discussions, explore past exam archives, and organize files in your personal cloud.\n\nBy integrating robust educational resources with high-fidelity peer networks, LinkUp bridges the gap between academic progress and student collaboration.\n\nTap below to begin your academic entry.`;

            await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: msg.chat.id,
                text: landingText,
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [[
                    { text: "⚡ Start Your Journey", callback_data: "start_journey" }
                  ]]
                }
              })
            });
          }
        }
      }
      
      // 2. Handle button callback interactions
      else if (update.callback_query) {
        const cb = update.callback_query;
        const chatId = cb.message.chat.id;
        const messageId = cb.message.message_id;
        const tgUser = cb.from;
        
        // Acknowledge callback immediately to clear loading state in client
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cb.id })
        });

        // STEP 1: Introduce Action Choice based on DB Profile status
        if (cb.data === 'start_journey') {
          let hasProfile = false;
          try {
            const checkRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?telegram_id=eq.${tgUser.id}&select=id`, {
              headers: {
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
              }
            });
            if (checkRes.ok) {
              const rows = await checkRes.json();
              hasProfile = rows && rows.length > 0;
            }
          } catch (e) {
            console.error("Supabase profile resolution failed:", e.message);
          }

          const actionText = hasProfile 
            ? `🔐 *Secure Portal Access*\n\nWelcome back. Select 'Access Dashboard' below to initiate a secure, single-use authentication sequence.`
            : `✨ *Create Your Identity*\n\nWelcome to LinkUp. Select 'Create Account' below to initialize your academic profile and workspace.`;

          const primaryBtn = hasProfile 
            ? { text: "🔓 Access Dashboard", callback_data: "initiate_auth" }
            : { text: "✨ Create Account", callback_data: "initiate_auth" };

          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: actionText,
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [primaryBtn],
                  [{ text: "ℹ️ Help & Support", callback_data: "help_support" }]
                ]
              }
            })
          });
        }

        // STEP 2: General Help panel
        else if (cb.data === 'help_support') {
          const helpText = `ℹ️ *Help & Support*\n\nLinkUp is an enterprise-grade academic assistant designed for university students.\n\n• *Authentication*: Connection tokens are valid for 5 minutes and are strictly single-use for your account security.\n• *Direct Support*: If you experience routing anomalies, contact your class coordinator or system administrator @getyetek.`;
          
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: helpText,
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[
                  { text: "⬅️ Back", callback_data: "start_journey" }
                ]]
              }
            })
          });
        }

        // STEP 3: Issue single-use Token & Start Expiry background task
        else if (cb.data === 'initiate_auth') {
          let avatarUrl = null;
          try {
            const photosRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUserProfilePhotos?user_id=${tgUser.id}&limit=1`);
            const photosData = await photosRes.json();
            
            if (photosData.ok && photosData.result.total_count > 0) {
                const photoSizes = photosData.result.photos[0];
                const bestPhoto = photoSizes[photoSizes.length - 1];
                
                const fileRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${bestPhoto.file_id}`);
                const fileData = await fileRes.json();
                
                if (fileData.ok && fileData.result.file_path) {
                    const tgFileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
                    const imgRes = await fetch(tgFileUrl);
                    
                    if (imgRes.ok) {
                        const imgBuffer = await imgRes.arrayBuffer();
                        const sbStoragePath = `telegram_${tgUser.id}_${Date.now()}.jpg`;
                        
                        const uploadRes = await fetch(`${env.SUPABASE_URL}/storage/v1/object/avatars/${sbStoragePath}`, {
                            method: 'POST',
                            headers: {
                                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                                'Content-Type': 'image/jpeg'
                            },
                            body: imgBuffer
                        });
                        
                        if (uploadRes.ok) {
                            avatarUrl = `${env.SUPABASE_URL}/storage/v1/object/public/avatars/${sbStoragePath}`;
                        }
                    }
                }
            }
          } catch (e) {
            console.error("Avatar fetch sequence failed:", e.message);
          }

          const token = crypto.randomUUID();
          const expiresAt = new Date(Date.now() + 5 * 60000).toISOString();

          const sbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/telegram_login_tokens`, {
            method: 'POST',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              token_hash: token,
              telegram_id: tgUser.id,
              expires_at: expiresAt,
              metadata: {
                first_name: tgUser.first_name,
                last_name: tgUser.last_name,
                username: tgUser.username,
                avatar_url: avatarUrl
              }
            })
          });

          if (!sbRes.ok) {
            console.error("Supabase Token Stash Failed:", await sbRes.text());
            return new Response("OK");
          }

          const authText = `🛡️ *Secure Gateway Verification*\n\nYour single-use link has been generated. Tap the button below to safely authenticate your session.\n\nThis connection link will expire automatically in 5 minutes.`;

          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: authText,
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[
                  { text: "⚡ Enter LinkUp", url: `https://getyetek.github.io/LinkUp/?auth_token=${token}` }
                ]]
              }
            })
          });

          // WaitUntil Expiry Cleaner: Swaps the keyboard layout back to Request New Token
          ctx.waitUntil((async () => {
            await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
            
            const expiredText = `⚠️ *Session Expired*\n\nThis authentication session has expired for your protection. Please request a new token below.`;
            
            await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                message_id: messageId,
                text: expiredText,
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "🔄 Request New Token", callback_data: "start_journey" }],
                    [{ text: "ℹ️ Help & Support", callback_data: "help_support" }]
                  ]
                }
              })
            });
          })());
        }
      }

      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("Worker Crash:", err.message);
      return new Response("OK", { status: 200 });
    }
  }
};