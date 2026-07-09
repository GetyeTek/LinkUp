import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const bodyText = await req.text();
    const { auth_token } = JSON.parse(bodyText);
    if (!auth_token) throw new Error("Missing secure token.");

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Verify and Consume Token
    const { data: tokenData, error: tokenError } = await supabase
      .from('telegram_login_tokens')
      .delete()
      .eq('token_hash', auth_token)
      .select()
      .single();

    if (tokenError || !tokenData) {
        console.error("Token error:", tokenError);
        throw new Error("Invalid or expired login token.");
    }
    if (new Date(tokenData.expires_at) < new Date()) throw new Error("Login token has expired.");

    const tgId = tokenData.telegram_id;
    const meta = tokenData.metadata || {};
    let targetEmail = "";

    // 2. Resolve User Identity
    const { data: profile } = await supabase.from('profiles').select('id').eq('telegram_id', tgId).single();

    if (profile) {
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(profile.id);
      if (userError || !userData?.user) {
          console.error("User fetch error:", userError);
          throw new Error("Linked user account not found.");
      }
      targetEmail = userData.user.email!;
    } else {
      targetEmail = `tg_${tgId}@linkup.invalid`;
      const password = crypto.randomUUID(); 
      const fullName = [meta.first_name, meta.last_name].filter(Boolean).join(" ") || "Scholar";

      // Normalize Telegram phone format to satisfy Postgres check constraint
      let normalizedPhone = meta.phone || null;
      if (normalizedPhone) {
          normalizedPhone = normalizedPhone.toString().replace(/\s+/g, '');
          if (!normalizedPhone.startsWith('+')) {
              normalizedPhone = '+' + normalizedPhone;
          }

          // Self-Healing Trust Hierarchy: Evict low-trust unverified manual registrations claiming this phone
          await supabase
              .from('profiles')
              .update({ phone: null })
              .eq('phone', normalizedPhone)
              .is('telegram_id', null);

          // Pre-emptively verify if phone number is already taken by a high-trust user
          const { data: phoneCheck } = await supabase
              .from('profiles')
              .select('id')
              .eq('phone', normalizedPhone)
              .maybeSingle();

          if (phoneCheck) {
              throw new Error("PHONE_ALREADY_TAKEN");
          }
      }

      const { error: createError } = await supabase.auth.admin.createUser({
        email: targetEmail,
        password: password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          telegram_id: tgId,
          telegram_username: meta.username || null,
          registered_with_telegram: true,
          avatar_url: meta.avatar_url || null,
          phone: normalizedPhone
        }
      });

      if (createError) {
          console.error("Create User Error:", createError);
          // Failsafe: Ignore if user already exists from a previous partial run
          if (createError.status !== 422 && createError.message?.indexOf('already registered') === -1) {
              throw new Error(`GoTrue user creation failed: ${createError.message}`);
          }
      }
    }

    // 3. Generate Magic OTP Link
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: targetEmail,
      options: { redirectTo: 'https://getyetek.github.io/LinkUp/' }
    });

    if (linkError) {
        console.error("Link Generation Error:", linkError);
        throw linkError;
    }

    return new Response(JSON.stringify({ action_link: linkData.properties.action_link }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Auth Edge Function Failed:", err);
    
    // Safely extract the message to avoid {} stringification
    let errorMsg = "Internal Server Error";
    if (err instanceof Error) {
        errorMsg = err.message;
    } else if (err && typeof err === 'object' && err.message) {
        errorMsg = err.message;
    } else if (typeof err === 'string') {
        errorMsg = err;
    }

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});