async function fetchTelegramAvatar(tgUserId, env) {
  let avatarUrl = null;
  try {
    const photosRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUserProfilePhotos?user_id=${tgUserId}&limit=1`);
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
          const sbStoragePath = `telegram_${tgUserId}_${Date.now()}.jpg`;
          
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
  return avatarUrl;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Auth Bot Active. Send POST from Telegram Webhook.", { status: 200 });
    }

    try {
      const update = await request.json();
      
      // 1. Handle incoming text commands and contact transmissions
      if (update.message) {
        const msg = update.message;
        if (msg.chat.type === 'private') {
          
          // Handle initial start command or manual login trigger
          if (msg.text && (msg.text.startsWith('/start') || msg.text.startsWith('/login'))) {
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
          
          // Handle SIM-verified Contact Card Transmission
          else if (msg.contact) {
            const contact = msg.contact;
            
            // Anti-spoofing: Ensure they didn't manually share a contact card belonging to another account
            if (contact.user_id !== msg.from.id) {
              await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: msg.chat.id,
                  text: `❌ *Verification Failed*\n\nYou shared a contact card belonging to another user. Please share your own contact to proceed.`,
                  parse_mode: 'Markdown'
                })
              });
              return new Response("OK");
            }

            const phoneNumber = contact.phone_number;
            
            // Fetch Telegram avatar in parallel
            const avatarUrl = await fetchTelegramAvatar(msg.from.id, env);

            // Token Generation
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
                telegram_id: msg.from.id,
                expires_at: expiresAt,
                metadata: {
                  first_name: msg.from.first_name,
                  last_name: msg.from.last_name,
                  username: msg.from.username,
                  avatar_url: avatarUrl,
                  phone: phoneNumber // verified phone now stashed in raw metadata
                }
              })
            });

            if (!sbRes.ok) {
              console.error("Supabase Token Stash Failed:", await sbRes.text());
              return new Response("OK");
            }

            // A. Clean up native keyboards
            await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: msg.chat.id,
                text: `⚡ *Identity Authenticated*\n\nYour verified phone number has been linked to your academic token.`,
                parse_mode: "Markdown",
                reply_markup: { remove_keyboard: true }
              })
            });

            // B. Send active login link
            const linkText = `🛡️ *Secure Gateway Verification*\n\nYour single-use link has been generated. Tap the button below to safely enter the platform and initialize your workspace.\n\nThis connection link will expire automatically in 5 minutes.`;

            const linkRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: msg.chat.id,
                text: linkText,
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [[
                    { text: "⚡ Enter LinkUp", url: `https://getyetek.github.io/LinkUp/?auth_token=${token}` }
                  ]]
                }
              })
            });

            // C. Schedule background expiry cleanup
            if (linkRes.ok) {
              const linkData = await linkRes.json();
              if (linkData.ok) {
                const sentMsgId = linkData.result.message_id;
                ctx.waitUntil((async () => {
                  await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
                  
                  const expiredText = `⚠️ *Session Expired*\n\nThis authentication session has expired. Please request a new token below.`;
                  
                  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: msg.chat.id,
                      message_id: sentMsgId,
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
          }
        }
      }
      
      // 2. Handle inline button callback interactions
      else if (update.callback_query) {
        const cb = update.callback_query;
        const chatId = cb.message.chat.id;
        const messageId = cb.message.message_id;
        const tgUser = cb.from;
        
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cb.id })
        });

        // Start Journey: Resolves DB context to determine user profile status
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
            console.error("Profile check failed:", e.message);
          }

          const actionText = hasProfile 
            ? `🔐 *Secure Portal Access*\n\nWelcome back. Select 'Access Dashboard' below to initiate a secure, single-use authentication sequence.`
            : `✨ *Create Your Identity*\n\nWelcome to LinkUp. Select 'Create Account' below to initialize your academic profile and secure your workspace.`;

          const primaryBtn = hasProfile 
            ? { text: "🔓 Access Dashboard", callback_data: "initiate_auth" }
            : { text: "✨ Create Account", callback_data: "request_contact" };

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

        // Support Hub
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

        // Send native verification trigger (Only runs for unregistered students)
        else if (cb.data === 'request_contact') {
          // Clear active inline markup to prevent collision state
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: `🔄 *Redirecting to secure verification screen...*`,
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: [] }
            })
          });

          // Trigger ReplyKeyboardMarkup sharing request
          const promptText = `🛡️ *Account Verification Required*\n\nTo securely provision your academic workspace and establish your identity, please verify your phone number.\n\nTap the button below to natively share and verify your contact card.`;

          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: promptText,
              parse_mode: "Markdown",
              reply_markup: {
                keyboard: [
                  [{ text: "📱 Share Contact to Verify", request_contact: true }]
                ],
                resize_keyboard: true,
                one_time_keyboard: true
              }
            })
          });
        }

        // Direct Auth for Returning Users
        else if (cb.data === 'initiate_auth') {
          const avatarUrl = await fetchTelegramAvatar(tgUser.id, env);
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