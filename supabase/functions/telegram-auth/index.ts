import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { auth_token } = await req.json();
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

    if (tokenError || !tokenData) throw new Error("Invalid or expired login token.");
    if (new Date(tokenData.expires_at) < new Date()) throw new Error("Login token has expired.");

    const tgId = tokenData.telegram_id;
    const meta = tokenData.metadata || {};
    let targetEmail = "";

    // 2. Resolve User Identity
    const { data: profile } = await supabase.from('profiles').select('id').eq('telegram_id', tgId).single();

    if (profile) {
      // Returning User: Fetch their real email to generate link
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(profile.id);
      if (userError || !userData.user) throw new Error("Linked user account not found.");
      targetEmail = userData.user.email!;
    } else {
      // New User: Provision a secure phantom account
      targetEmail = `tg_${tgId}@linkup.invalid`;
      const password = crypto.randomUUID(); 
      const fullName = [meta.first_name, meta.last_name].filter(Boolean).join(" ") || "Scholar";

      const { error: createError } = await supabase.auth.admin.createUser({
        email: targetEmail,
        password: password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          telegram_id: tgId,
          telegram_username: meta.username,
          registered_with_telegram: true,
          avatar_url: meta.avatar_url,
          phone: meta.phone
        }
      });

      if (createError) throw createError;
      // Postgres trigger 'handle_new_user' maps the rest instantly.
    }

    // 3. Generate Magic OTP Link
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: targetEmail,
      options: { redirectTo: 'https://getyetek.github.io/LinkUp/' }
    });

    if (linkError) throw linkError;

    return new Response(JSON.stringify({ action_link: linkData.properties.action_link }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});