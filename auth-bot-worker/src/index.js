import { DurableObject } from "cloudflare:workers";

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
          const sbStoragePath = `telegram_${tgUserId}.jpg`;
          
          const uploadRes = await fetch(`${env.SUPABASE_URL}/storage/v1/object/avatars/${sbStoragePath}`, {
            method: 'POST',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'image/jpeg',
              'x-upsert': 'true'
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

// Stateful Session Manager to handle visual expiration reliably (Batched per user)
export class AuthSessionManager extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/schedule-expiry') {
      const { chatId, messageId, tgUserId, delayMs } = await request.json();
      
      // Store reference coordinates and user identity in DO persistence
      let activeSessions = await this.ctx.storage.get('active_sessions') || [];
      activeSessions.push({ chatId, messageId, tgUserId });
      await this.ctx.storage.put('active_sessions', activeSessions);
      
      // Set Alarm to trigger visual recess in 5 minutes (will overwrite existing alarm, which is fine, pushing it back slightly)
      await this.ctx.storage.setAlarm(Date.now() + delayMs);
      
      return new Response("Scheduled", { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  }

  async alarm() {
    const sessions = await this.ctx.storage.get('active_sessions');
    if (!sessions || sessions.length === 0) return;

    const tgUserId = sessions[0].tgUserId;
    
    // Dynamic Self-Healing: Check profile status to render the correct dashboard
    let hasProfile = false;
    try {
      if (tgUserId && this.env.SUPABASE_URL) {
          const checkRes = await fetch(`${this.env.SUPABASE_URL}/rest/v1/profiles?telegram_id=eq.${tgUserId}&select=id`, {
            headers: {
              'apikey': this.env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          });
          if (checkRes.ok) {
            const rows = await checkRes.json();
            hasProfile = rows && rows.length > 0;
          }
      }
    } catch (e) {
      console.error("[SessionManager] Profile check failed:", e.message);
    }

    const actionText = hasProfile 
      ? `🏛️ *Welcome back to LinkUp*\n\nSelect 'Access Dashboard' below to log in.`
      : `🏛️ *Welcome to LinkUp*\n\nSelect 'Create Account' below to set up your academic profile.`;

    const primaryBtn = hasProfile 
      ? { text: "🔓 Access Dashboard", callback_data: "initiate_auth" }
      : { text: "✨ Create Account", callback_data: "request_contact" };

    for (const sess of sessions) {
      try {
        await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: sess.chatId,
            message_id: sess.messageId,
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
        console.log(`[SessionManager] Self-healed expired magic link message ID: ${sess.messageId} back to dashboard.`);
      } catch (e) {
        console.error("[SessionManager] Failed to revert expired message:", e.message);
      }
    }
    
    await this.ctx.storage.delete('active_sessions');
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Auth Bot Active. Send POST from Telegram Webhook.", { status: 200 });
    }

    const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (env.TELEGRAM_WEBHOOK_SECRET && secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 403 });
    }

    try {
      const update = await request.json();
      
      // 1. Handle text commands and Contact transmissions
      if (update.message) {
        const msg = update.message;
        if (msg.chat.type === 'private') {
          
          if (msg.text && (msg.text.startsWith('/start') || msg.text.startsWith('/login'))) {
            let hasProfile = false;
            try {
              const checkRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?telegram_id=eq.${msg.from.id}&select=id`, {
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
              ? `🏛️ *Welcome back to LinkUp*\n\nSelect 'Access Dashboard' below to log in.`
              : `🏛️ *Welcome to LinkUp*\n\nSelect 'Create Account' below to set up your academic profile.`;

            const primaryBtn = hasProfile 
              ? { text: "🔓 Access Dashboard", callback_data: "initiate_auth" }
              : { text: "✨ Create Account", callback_data: "request_contact" };

            await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: msg.chat.id,
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
          
          else if (msg.contact) {
            const contact = msg.contact;
            
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
            const avatarUrl = await fetchTelegramAvatar(msg.from.id, env);

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
                  phone: phoneNumber
                }
              })
            });

            if (!sbRes.ok) {
              console.error("Supabase Token Stash Failed:", await sbRes.text());
              return new Response("OK");
            }

            // Remove native keyboard setup
            await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: msg.chat.id,
                text: `✅ *Verification Successful*\n\nYour phone number has been verified.`,
                parse_mode: "Markdown",
                reply_markup: { remove_keyboard: true }
              })
            });

            const linkText = `🔗 *Authentication Link*\n\nYour single-use login link is ready. Tap below to log in.\n\nThis link will expire in 5 minutes.`;

            const linkRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: msg.chat.id,
                text: linkText,
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [[
                    { text: "Log In to LinkUp", url: `https://getyetek.github.io/LinkUp/?auth_token=${token}` }
                  ]]
                }
              })
            });

            if (linkRes.ok) {
              const linkData = await linkRes.json();
              if (linkData.ok) {
                const sentMsgId = linkData.result.message_id;
                
                // Route to Durable Object namespace to schedule the guaranteed alarm
                const doId = env.AuthSessionManager.idFromName(`user_${msg.from.id}`);
                const doStub = env.AuthSessionManager.get(doId);
                
                ctx.waitUntil(doStub.fetch(new Request(`https://auth-session-manager/schedule-expiry`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chatId: msg.chat.id,
                    messageId: sentMsgId,
                    tgUserId: msg.from.id,
                    delayMs: 5 * 60 * 1000
                  })
                })));
              }
            }
          }
        }
      }
      
      // 2. Handle button triggers
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
            ? `🏛️ *Welcome back to LinkUp*\n\nSelect 'Access Dashboard' below to log in.`
            : `🏛️ *Welcome to LinkUp*\n\nSelect 'Create Account' below to set up your academic profile.`;

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

        else if (cb.data === 'help_support') {
          const helpText = `ℹ️ *Help & Support*\n\nLinkUp is an academic platform for university students.\n\n• *Authentication*: Login links are valid for 5 minutes and are single-use.\n• *Support*: If you need help, please contact your class coordinator or support @getyetek.`;
          
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

        else if (cb.data === 'request_contact') {
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: `🔄 *Redirecting to verification...*`,
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: [] }
            })
          });

          const promptText = `📱 *Account Verification*\n\nTo set up your account, please verify your phone number.\n\nTap the button below to share your contact card.`;

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

          const authText = `🔗 *Authentication Link*\n\nYour single-use login link is ready. Tap below to log in.\n\nThis link will expire in 5 minutes.`;

          const authRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: authText,
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[
                  { text: "Log In to LinkUp", url: `https://getyetek.github.io/LinkUp/?auth_token=${token}` }
                ]]
              }
            })
          });

          if (authRes.ok) {
            const authData = await authRes.json();
            if (authData.ok) {
              const sentMsgId = authData.result.message_id;
              
              // Resolve DO stub and set standard Alarm
              const doId = env.AuthSessionManager.idFromName(`user_${tgUser.id}`);
              const doStub = env.AuthSessionManager.get(doId);
              
              ctx.waitUntil(doStub.fetch(new Request(`https://auth-session-manager/schedule-expiry`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chatId: chatId,
                  messageId: sentMsgId,
                  tgUserId: tgUser.id,
                  delayMs: 5 * 60 * 1000
                })
              })));
            }
          }
        }
      }

      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("Worker Crash:", err.message);
      return new Response("OK", { status: 200 });
    }
  }
};