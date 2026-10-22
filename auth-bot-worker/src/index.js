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

const I18N = {
  am: {
    welcome_back: "🏛️ *እንኳን ወደ LinkUp በደህና ተመለሱ*\n\nወደ አካውንትዎ ለመግባት ከታች 'ዳሽቦርድ ይክፈቱ' የሚለውን ይጫኑ።",
    welcome_new: "🏛️ *እንኳን ወደ LinkUp በደህና መጡ*\n\nየትምህርት መገለጫዎን (ፕሮፋይል) ለማዘጋጀት ከታች 'አካውንት ይፍጠሩ' የሚለውን ይጫኑ።",
    btn_dashboard: "🔓 ዳሽቦርድ ይክፈቱ",
    btn_create_account: "✨ አካውንት ይፍጠሩ",
    btn_language: "🌐 ቋንቋ / Lang",
    btn_help: "ℹ️ እርዳታ",
    btn_back: "⬅️ ተመለስ",
    lang_prompt: "🌐 *የቋንቋ ምርጫ*\n\nእባክዎ የሚፈልጉትን ቋንቋ ይምረጡ / Please select your preferred language:",
    help_text: "ℹ️ *እርዳታ እና ድጋፍ*\n\nLinkUp ለዩኒቨርሲቲ ተማሪዎች የተዘጋጀ የትምህርት መድረክ ነው።\n\n• *ማረጋገጫ (Login)*: የመግቢያ ሊንኩ የሚያገለግለው ለ 5 ደቂቃ ብቻ ሲሆን ለአንድ ጊዜ አገልግሎት ብቻ የሚሰራ ነው።\n• *ድጋፍ ለማግኘት*: እርዳታ ከፈለጉ የክፍል አስተባባሪዎን ወይም ድጋፍ ሰጪ @linkupregistrationbot ያነጋግሩ።",
    redirecting: "🔄 *ወደ ማረጋገጫ በመቀየር ላይ...*",
    contact_prompt: "📱 *አካውንት ማረጋገጥ*\n\nአካውንትዎን ለማዘጋጀት እባክዎ ስልክ ቁጥርዎን ያረጋግጡ።\n\nከታች በጽሁፍ መጻፊያው ሳጥን ውስጥ የሚገኘውን አራት ማዕዘን ቁልፍ ይጫኑ:\n👇",
    btn_share_contact: "📱 ስልክ ቁጥርን በማጋራት አረጋግጥ",
    contact_mismatch: "❌ *ማረጋገጥ አልተሳካም*\n\nያጋሩት ስልክ ቁጥር የሌላ ሰው ነው። እባክዎ የራስዎን ስልክ ቁጥር ያጋሩ።",
    phone_collision: "❌ *ስልክ ቁጥሩ ቀድሞ ተመዝግቧል*\n\nይህ ስልክ ቁጥር በሌላ ንቁ አካውንት ላይ ተመዝግቧል። እባክዎ በቀጥታ በኢሜይልዎ እና በይለፍ ቃልዎ ይግቡ።",
    verification_success: "✅ *ማረጋገጥ ተሳክቷል*\n\nስልክ ቁጥርዎ በተሳካ ሁኔታ ተረጋግጧል።",
    auth_link_text: "🔗 *የመግቢያ ሊንክ*\n\nየአንድ ጊዜ መግቢያ ሊንክዎ ተዘጋጅቷል። ወደ ስርዓቱ ለመግባት ከታች ያለውን ይጫኑ።\n\nይህ ሊንክ በ 5 ደቂቃ ውስጥ ጊዜው ያልፋል።",
    btn_login: "ወደ LinkUp ግባ",
    invalid_link: "❌ *ልክ ያልሆነ ወይም ጊዜው ያለፈበት ሊንክ*\n\nይህ የማረጋገጫ ሊንክ ጊዜው አልፏል ወይም ትክክል አይደለም። እባክዎ ወደ LinkUp ዌብ መተግበሪያ ተመልሰው እንደገና ይሞክሩ።",
    link_contact_prompt: "🔒 *አካውንት የማገናኘት ጥያቄ*\n\nይህንን የቴሌግራም አካውንት ከዌብ ገጽዎ ጋር ደህንነቱ በተጠበቀ ሁኔታ ለማገናኘት እባክዎ ከታች በጽሁፍ መጻፊያው ሳጥን ውስጥ የሚገኘውን አራት ማዕዘን ቁልፍ ይጫኑ:\n👇",
    link_collision: "❌ *የስልክ ቁጥር መደራረብ*\n\nይህ ስልክ ቁጥር በሌላ ንቁ አካውንት ላይ ተረጋግጧል። አንድ ስልክ ቁጥር ከበርካታ አካውንቶች ጋር ማገናኘት አይቻልም።",
    link_target_taken: "❌ *አካውንት ማገናኘት ተቋርጧል*\n\nይህ የዌብ አካውንት ቀድሞውኑ ከሌላ የቴሌግራም መገለጫ ጋር ተገናኝቷል።",
    link_patch_failed: "❌ *አካውንት ማገናኘት አልተሳካም*\n\nየአካውንትዎን መረጃ ማደስ አልተቻለም። እባክዎ ወደ ብሮውዘርዎ ተመልሰው እንደገና ይሞክሩ።",
    link_success: "✅ *ማንነትዎ ተረጋግጦ አካውንትዎ ተገናኝቷል!*\n\nቴሌግራምዎ ከዌብ ገጽዎ ጋር በተሳካ ሁኔታ ተገናኝቷል።\n\nእባክዎ ወደ ብሮውዘርዎ ይመለሱ — አሁን በቀጥታ ይከፈታል።"
  },
  en: {
    welcome_back: "🏛️ *Welcome back to LinkUp*\n\nSelect 'Access Dashboard' below to log in.",
    welcome_new: "🏛️ *Welcome to LinkUp*\n\nSelect 'Create Account' below to set up your academic profile.",
    btn_dashboard: "🔓 Access Dashboard",
    btn_create_account: "✨ Create Account",
    btn_language: "🌐 Language / ቋንቋ",
    btn_help: "ℹ️ Help & Support",
    btn_back: "⬅️ Back",
    lang_prompt: "🌐 *Language Settings*\n\nPlease select your preferred language / እባክዎ የሚፈልጉትን ቋንቋ ይምረጡ:",
    help_text: "ℹ️ *Help & Support*\n\nLinkUp is an academic platform for university students.\n\n• *Authentication*: Login links are valid for 5 minutes and are single-use.\n• *Support*: If you need help, please contact your class coordinator or support @linkupregistrationbot.",
    redirecting: "🔄 *Redirecting to verification...*",
    contact_prompt: "📱 *Account Verification*\n\nTo set up your account, please verify your phone number.\n\nPlease tap the rectangular button located in the message input area below:\n👇",
    btn_share_contact: "📱 Share Contact to Verify",
    contact_mismatch: "❌ *Verification Failed*\n\nYou shared a contact card belonging to another user. Please share your own contact to proceed.",
    phone_collision: "❌ *Phone Number Collision*\n\nThis phone number is already verified on another account. Please sign into that account directly using your email and password.",
    verification_success: "✅ *Verification Successful*\n\nYour phone number has been verified.",
    auth_link_text: "🔗 *Authentication Link*\n\nYour single-use login link is ready. Tap below to log in.\n\nThis link will expire in 5 minutes.",
    btn_login: "Log In to LinkUp",
    invalid_link: "❌ *Invalid or Expired Link*\n\nThis verification link has expired or is invalid. Please return to the LinkUp web app and tap the verify button again.",
    link_contact_prompt: "🔒 *Account Link Requested*\n\nTo securely link this Telegram account to your web session, please tap the rectangular button located in the message input area below:\n👇",
    link_collision: "❌ *Phone Number Collision*\n\nThis phone number is already verified on another active account. An existing phone number cannot be linked to multiple accounts.",
    link_target_taken: "❌ *Account Link Aborted*\n\nThis web account is already linked to another verified Telegram profile. To protect account integrity, multiple Telegram accounts cannot be bound to the same profile.",
    link_patch_failed: "❌ *Account Link Failed*\n\nWe could not update your account records. Please return to your browser and try again.",
    link_success: "✅ *Identity Verified & Accounts Linked!*\n\nYour Telegram has been successfully bound to your active web session.\n\nPlease return to your browser—it will automatically unlock now."
  }
};

function getMainMenuMarkup(hasProfile, lang = 'am') {
  const t = I18N[lang] || I18N.am;
  const primaryBtn = hasProfile 
    ? { text: t.btn_dashboard, callback_data: `initiate_auth:${lang}` }
    : { text: t.btn_create_account, callback_data: `request_contact:${lang}` };

  return {
    inline_keyboard: [
      [primaryBtn],
      [
        { text: t.btn_language, callback_data: `open_lang:${lang}` },
        { text: t.btn_help, callback_data: `help_support:${lang}` }
      ]
    ]
  };
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
      const expiresAt = Date.now() + (delayMs || 300000);
      
      let activeSessions = await this.ctx.storage.get('active_sessions') || [];
      activeSessions.push({ chatId, messageId, tgUserId, expiresAt });
      await this.ctx.storage.put('active_sessions', activeSessions);
      
      // Earliest-Deadline-First Alarm Scheduling (prevents message drift)
      const earliestAlarm = Math.min(...activeSessions.map(s => s.expiresAt));
      await this.ctx.storage.setAlarm(earliestAlarm);
      
      return new Response("Scheduled", { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  }

  async alarm() {
    const sessions = await this.ctx.storage.get('active_sessions') || [];
    if (sessions.length === 0) return;

    const now = Date.now();
    const expiredSessions = sessions.filter(s => s.expiresAt <= now + 1000);
    const remainingSessions = sessions.filter(s => s.expiresAt > now + 1000);

    for (const sess of expiredSessions) {
      let hasProfile = false;
      try {
        if (sess.tgUserId && this.env.SUPABASE_URL) {
            const checkRes = await fetch(`${this.env.SUPABASE_URL}/rest/v1/profiles?telegram_id=eq.${sess.tgUserId}&select=id`, {
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

      const t = I18N.am;
      const actionText = hasProfile ? t.welcome_back : t.welcome_new;

      try {
        await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: sess.chatId,
            message_id: sess.messageId,
            text: actionText,
            parse_mode: "Markdown",
            reply_markup: getMainMenuMarkup(hasProfile, 'am')
          })
        });
        console.log(`[SessionManager] Reverted message ID: ${sess.messageId} to dashboard.`);
      } catch (e) {
        console.error("[SessionManager] Failed to revert expired message:", e.message);
      }
    }
    
    if (remainingSessions.length > 0) {
      await this.ctx.storage.put('active_sessions', remainingSessions);
      const nextAlarm = Math.min(...remainingSessions.map(s => s.expiresAt));
      await this.ctx.storage.setAlarm(nextAlarm);
    } else {
      await this.ctx.storage.delete('active_sessions');
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Auth Bot Active. Send POST from Telegram Webhook.", { status: 200 });
    }

    const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (!env.TELEGRAM_WEBHOOK_SECRET) {
      console.error("[AuthBot] ⚠️ CRITICAL: TELEGRAM_WEBHOOK_SECRET is unconfigured in worker environment.");
      return new Response("Webhook Secret Missing", { status: 500 });
    }
    if (secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 403 });
    }

    try {
      const update = await request.json();
      
      // 1. Handle text commands and Contact transmissions
      if (update.message) {
        const msg = update.message;
        if (msg.chat.type === 'private') {
          
          if (msg.text && msg.text.startsWith('/start link_')) {
            const linkToken = msg.text.split('link_')[1];

            // 1. Atomically consume and fetch metadata in a single query (Zero TOCTOU window)
            const intentRes = await fetch(`${env.SUPABASE_URL}/rest/v1/telegram_login_tokens?token_hash=eq.${linkToken}&telegram_id=eq.0&expires_at=gt.${new Date().toISOString()}&select=metadata`, {
                method: 'DELETE',
                headers: { 
                    'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 
                    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                    'Prefer': 'return=representation'
                }
            });
            const intentRows = await intentRes.json();
            
            if (!intentRows || intentRows.length === 0 || !intentRows[0]?.metadata?.user_id) {
                await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: msg.chat.id,
                        text: `❌ *Invalid or Expired Link*\n\nThis verification link has expired or is invalid. Please return to the LinkUp web app and tap the verify button again.`,
                        parse_mode: "Markdown"
                    })
                });
                return new Response("OK");
            }
            
            const realUserId = intentRows[0].metadata.user_id;
            
            // Clean up any old pending tokens for this Telegram user
            await fetch(`${env.SUPABASE_URL}/rest/v1/telegram_login_tokens?telegram_id=eq.${msg.from.id}`, {
                method: 'DELETE',
                headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
            });

            // Register the secure pending merge intent
            await fetch(`${env.SUPABASE_URL}/rest/v1/telegram_login_tokens`, {
                method: 'POST',
                headers: {
                    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    token_hash: `verify_${msg.from.id}_${Date.now()}`,
                    telegram_id: msg.from.id,
                    expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
                    metadata: { pending_google_id: realUserId }
                })
            });

            await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: msg.chat.id,
                    text: I18N.am.link_contact_prompt,
                    parse_mode: "Markdown",
                    reply_markup: {
                        keyboard: [
                            [{ text: I18N.am.btn_share_contact, request_contact: true }]
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                })
            });
            return new Response("OK");
          }
          
          else if (msg.text && (msg.text.startsWith('/start') || msg.text.startsWith('/login'))) {
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

            const t = I18N.am;
            const actionText = hasProfile ? t.welcome_back : t.welcome_new;

            await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: msg.chat.id,
                text: actionText,
                parse_mode: "Markdown",
                reply_markup: getMainMenuMarkup(hasProfile, 'am')
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
            
            // 1. Intercept for Magic Migration
            let pendingGoogleId = null;
            try {
                const verifyCheck = await fetch(`${env.SUPABASE_URL}/rest/v1/telegram_login_tokens?telegram_id=eq.${msg.from.id}&select=*`, {
                    headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
                });
                if (verifyCheck.ok) {
                    const rows = await verifyCheck.json();
                    const pendingRow = rows.find(r => r.metadata && r.metadata.pending_google_id);
                    if (pendingRow) {
                        pendingGoogleId = pendingRow.metadata.pending_google_id;
                        await fetch(`${env.SUPABASE_URL}/rest/v1/telegram_login_tokens?id=eq.${pendingRow.id}`, {
                            method: 'DELETE',
                            headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
                        });
                    }
                }
            } catch (e) { console.error("Verify check error", e); }

            if (pendingGoogleId) {
                let normalizedPhone = phoneNumber.replace(/\s+/g, '');
                if (!normalizedPhone.startsWith('+')) {
                    normalizedPhone = '+' + normalizedPhone;
                }

                // Pre-flight Conflict Check: Verify phone is not bound to a different verified account
                try {
                    const phoneCollisionRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?phone=eq.${encodeURIComponent(normalizedPhone)}&id=neq.${pendingGoogleId}&telegram_id=not.is.null&select=id`, {
                        headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
                    });
                    if (phoneCollisionRes.ok) {
                        const existingPhoneOwners = await phoneCollisionRes.json();
                        if (existingPhoneOwners && existingPhoneOwners.length > 0) {
                            await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    chat_id: msg.chat.id,
                                    text: `❌ *Phone Number Collision*\n\nThis phone number is already verified on another active account. An existing phone number cannot be linked to multiple accounts.`,
                                    parse_mode: "Markdown",
                                    reply_markup: { remove_keyboard: true }
                                })
                            });
                            return new Response("OK");
                        }
                    }
                } catch (e) {
                    console.error("Phone collision check error:", e);
                }

                // Security: Prevent linking if destination account is already bound to a different verified Telegram user
                try {
                    const targetCheckRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${pendingGoogleId}&select=registered_with_telegram,telegram_id`, {
                        headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
                    });
                    if (targetCheckRes.ok) {
                        const targetProfiles = await targetCheckRes.json();
                        if (targetProfiles.length > 0) {
                            const tp = targetProfiles[0];
                            if (tp.registered_with_telegram && tp.telegram_id && tp.telegram_id !== msg.from.id) {
                                await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        chat_id: msg.chat.id,
                                        text: `❌ *Account Link Aborted*\n\nThis web account is already linked to another verified Telegram profile. To protect account integrity, multiple Telegram accounts cannot be bound to the same profile.`,
                                        parse_mode: "Markdown",
                                        reply_markup: { remove_keyboard: true }
                                    })
                                });
                                return new Response("OK");
                            }
                        }
                    }
                } catch (e) {
                    console.error("Target profile verification check failed", e);
                }

                // Evict unverified claims holding this phone to prevent collision
                await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?phone=eq.${encodeURIComponent(normalizedPhone)}&telegram_id=is.null`, {
                    method: 'PATCH',
                    headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: null })
                });

                // Safe Migration: Transfer old profile records before deleting the placeholder account
                try {
                    const oldProfileRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?telegram_id=eq.${msg.from.id}&id=neq.${pendingGoogleId}&select=id`, {
                        headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
                    });
                    if (oldProfileRes.ok) {
                        const oldProfiles = await oldProfileRes.json();
                        for (const oldP of oldProfiles) {
                            // Query GoTrue Admin API to inspect the account's real email address
                            const oldUserRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${oldP.id}`, {
                                headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
                            });
                            
                            if (oldUserRes.ok) {
                                const oldUserData = await oldUserRes.json();
                                const oldEmail = oldUserData.email || '';
                                
                                if (oldEmail.endsWith('@linkup.invalid')) {
                                    // 1. Atomically transfer all learning history, notes, attempts, and credits to the Google account
                                    await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/merge_transient_account`, {
                                        method: 'POST',
                                        headers: {
                                            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                                            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                                            'Content-Type': 'application/json'
                                        },
                                        body: JSON.stringify({
                                            p_old_user_id: oldP.id,
                                            p_new_user_id: pendingGoogleId
                                        })
                                    });

                                    // 2. Delete the emptied placeholder auth user
                                    await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${oldP.id}`, {
                                        method: 'DELETE',
                                        headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
                                    });
                                } else {
                                    // CRITICAL SAFEGUARD: It is an established real account. Halt merge and notify user!
                                    let maskedEmail = oldEmail;
                                    const parts = oldEmail.split('@');
                                    if (parts.length === 2) {
                                        const localPart = parts[0];
                                        const domainPart = parts[1];
                                        const len = localPart.length;
                                        if (len <= 1) {
                                            maskedEmail = `*@${domainPart}`;
                                        } else if (len === 2) {
                                            maskedEmail = `${localPart[0]}*@${domainPart}`;
                                        } else if (len <= 4) {
                                            maskedEmail = `${localPart[0]}${'*'.repeat(len - 2)}${localPart[len - 1]}@${domainPart}`;
                                        } else {
                                            maskedEmail = `${localPart.substring(0, 2)}${'*'.repeat(len - 4)}${localPart.substring(len - 2)}@${domainPart}`;
                                        }
                                    }
                                    
                                    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            chat_id: msg.chat.id,
                                            text: `❌ *Account Link Aborted*\n\nTo protect your academic records, accounts cannot be merged.\n\nYour Telegram is already linked to an active account with the email *${maskedEmail}*.\n\nPlease sign into that account directly using your email or the Telegram login button.`,
                                            parse_mode: "Markdown",
                                            reply_markup: { remove_keyboard: true }
                                        })
                                    });
                                    return new Response("OK");
                                }
                            }
                        }
                    }
                } catch (e) { console.error("Identity sentinel check failed", e); }

                // Evaluate Google Profile state for missing or generic data
                let patchPayload = {
                    phone: normalizedPhone,
                    telegram_id: msg.from.id,
                    telegram_username: msg.from.username || null,
                    registered_with_telegram: true
                };

                try {
                    const profRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${pendingGoogleId}&select=full_name,avatar_url`, {
                        headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
                    });
                    
                    if (profRes.ok) {
                        const profiles = await profRes.json();
                        if (profiles.length > 0) {
                            const currentGoogleProfile = profiles[0];
                            
                            // 1. Full Name Fallback
                            const tgFullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
                            if ((!currentGoogleProfile.full_name || currentGoogleProfile.full_name === 'New Scholar') && tgFullName) {
                                patchPayload.full_name = tgFullName;
                            }

                            // 2. Avatar Fallback (Google Default or Missing)
                            const isGoogleAvatarDefault = (url) => {
                                if (!url) return true;
                                if (url.includes('googleusercontent.com') && url.includes('/a/') && !url.includes('/a-/')) return true;
                                if (url.includes('ui-avatars.com')) return true;
                                return false;
                            };

                            if (isGoogleAvatarDefault(currentGoogleProfile.avatar_url)) {
                                const tgAvatar = await fetchTelegramAvatar(msg.from.id, env);
                                if (tgAvatar) patchPayload.avatar_url = tgAvatar;
                            }
                        }
                    }
                } catch (e) { 
                    console.error("Profile evaluation failed", e); 
                }

                // Inject enriched identity into the active profile with strict status assertion
                const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${pendingGoogleId}`, {
                    method: 'PATCH',
                    headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(patchPayload)
                });

                if (!patchRes.ok) {
                    console.error("Profile patch error:", await patchRes.text());
                    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: msg.chat.id,
                            text: `❌ *Account Link Failed*\n\nWe could not update your account records. Please return to your browser and try again.`,
                            parse_mode: "Markdown",
                            reply_markup: { remove_keyboard: true }
                        })
                    });
                    return new Response("OK");
                }

                await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: msg.chat.id,
                        text: `✅ *Identity Verified & Accounts Linked!*\n\nYour Telegram has been successfully bound to your active web session.\n\nPlease return to your browser—it will automatically unlock now.`,
                        parse_mode: "Markdown",
                        reply_markup: { remove_keyboard: true }
                    })
                });
                return new Response("OK");
            }

            // 2. Standard Login Path
            let standardPhone = phoneNumber.replace(/\s+/g, '');
            if (!standardPhone.startsWith('+')) {
                standardPhone = '+' + standardPhone;
            }

            // Pre-flight Check: Ensure phone is not already verified on another account
            try {
                const phoneCheckRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?phone=eq.${encodeURIComponent(standardPhone)}&telegram_id=neq.${msg.from.id}&telegram_id=not.is.null&select=id`, {
                    headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
                });
                if (phoneCheckRes.ok) {
                    const existingOwners = await phoneCheckRes.json();
                    if (existingOwners && existingOwners.length > 0) {
                        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chat_id: msg.chat.id,
                                text: `❌ *Phone Number Collision*\n\nThis phone number is already verified on another account. Please sign into that account directly using your email and password.`,
                                parse_mode: "Markdown",
                                reply_markup: { remove_keyboard: true }
                            })
                        });
                        return new Response("OK");
                    }
                }
            } catch (e) {
                console.error("Standard login phone check error:", e);
            }

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
                text: I18N.am.verification_success,
                parse_mode: "Markdown",
                reply_markup: { remove_keyboard: true }
              })
            });

            const linkRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: msg.chat.id,
                text: I18N.am.auth_link_text,
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [[
                    { text: I18N.am.btn_login, url: `https://getyetek.github.io/LinkUp/?auth_token=${token}` }
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

        const [action, lang = 'am'] = (cb.data || '').split(':');
        const t = I18N[lang] || I18N.am;

        if (action === 'start_journey' || action === 'set_lang') {
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

          const actionText = hasProfile ? t.welcome_back : t.welcome_new;

          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: actionText,
              parse_mode: "Markdown",
              reply_markup: getMainMenuMarkup(hasProfile, lang)
            })
          });
        }

        else if (action === 'open_lang') {
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: t.lang_prompt,
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "🇪🇹 አማርኛ", callback_data: "set_lang:am" },
                    { text: "🇬🇧 English", callback_data: "set_lang:en" }
                  ],
                  [
                    { text: t.btn_back, callback_data: `start_journey:${lang}` }
                  ]
                ]
              }
            })
          });
        }

        else if (action === 'help_support') {
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: t.help_text,
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[
                  { text: t.btn_back, callback_data: `start_journey:${lang}` }
                ]]
              }
            })
          });
        }

        else if (action === 'request_contact') {
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: t.redirecting,
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: [] }
            })
          });

          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: t.contact_prompt,
              parse_mode: "Markdown",
              reply_markup: {
                keyboard: [
                  [{ text: t.btn_share_contact, request_contact: true }]
                ],
                resize_keyboard: true,
                one_time_keyboard: true
              }
            })
          });
        }

        else if (action === 'initiate_auth') {
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

          const authRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: t.auth_link_text,
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[
                  { text: t.btn_login, url: `https://getyetek.github.io/LinkUp/?auth_token=${token}` }
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