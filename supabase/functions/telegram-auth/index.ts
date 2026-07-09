import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let currentStep = "INIT";
  const logs: string[] = [];
  const log = (msg: string) => { 
      console.log(`[${currentStep}] ${msg}`); 
      logs.push(`[${currentStep}] ${msg}`); 
  };

  try {
    currentStep = "PARSE_REQUEST";
    const bodyText = await req.text();
    log(`Received payload size: ${bodyText.length} bytes`);
    const { auth_token } = JSON.parse(bodyText);
    if (!auth_token) throw new Error("Missing secure token.");

    currentStep = "INIT_CLIENT";
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    currentStep = "DB_FETCH_TOKEN";
    log(`Executing query to fetch token.`);
    const { data: tokenData, error: tokenError } = await supabase
      .from('telegram_login_tokens')
      .delete()
      .eq('token_hash', auth_token)
      .select()
      .single();

    if (tokenError) {
        log(`DB Error: ${JSON.stringify(tokenError)}`);
        throw new Error(`Token invalid or already consumed.`);
    }
    if (!tokenData) throw new Error("Token data is null after fetch.");
    
    log(`Token found for Telegram ID: ${tokenData.telegram_id}`);
    if (new Date(tokenData.expires_at) < new Date()) throw new Error("Login token has expired.");

    const tgId = tokenData.telegram_id;
    const meta = tokenData.metadata || {};
    let targetEmail = "";

    currentStep = "DB_RESOLVE_PROFILE";
    log(`Looking up existing profile for TG ID: ${tgId}`);
    const { data: profile, error: profileError } = await supabase.from('profiles').select('id').eq('telegram_id', tgId).single();

    if (profileError && profileError.code !== 'PGRST116') {
        log(`Profile lookup error: ${JSON.stringify(profileError)}`);
    }

    if (profile) {
      currentStep = "AUTH_GET_USER";
      log(`Profile exists (${profile.id}). Resolving Auth User.`);
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(profile.id);
      
      if (userError) {
          log(`GoTrue Error (getUserById): ${JSON.stringify(userError)}`);
          throw new Error(`GoTrue failed to fetch user: ${userError.message}`);
      }
      if (!userData?.user) throw new Error("Linked user account not found in Auth system.");
      
      targetEmail = userData.user.email!;
      log(`Resolved target email: ${targetEmail}`);
    } else {
      currentStep = "AUTH_CREATE_USER";
      targetEmail = `tg_${tgId}@linkup.invalid`;
      const password = crypto.randomUUID(); 
      const fullName = [meta.first_name, meta.last_name].filter(Boolean).join(" ") || "Scholar";

      log(`No profile found. Provisioning new Auth User: ${targetEmail}`);
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
          phone: meta.phone || null
        }
      });

      if (createError) {
          log(`GoTrue Error (createUser): ${JSON.stringify(createError)}`);
          // Ignore if user already exists from a previous partial run
          if (createError.status !== 422 && createError.message?.indexOf('already registered') === -1) {
              throw new Error(`GoTrue user creation failed: ${createError.message}`);
          }
          log(`User already registered (Failsafe caught 422). Proceeding.`);
      } else {
          log(`Auth User provisioned successfully.`);
      }
    }

    currentStep = "AUTH_GENERATE_LINK";
    log(`Generating magic link for: ${targetEmail}`);
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: targetEmail,
      options: { redirectTo: 'https://getyetek.github.io/LinkUp/' }
    });

    if (linkError) {
        log(`GoTrue Error (generateLink): ${JSON.stringify(linkError)}`);
        throw new Error(`GoTrue link generation failed: ${linkError.message}`);
    }
    
    if (!linkData?.properties?.action_link) {
        throw new Error("GoTrue returned a success response, but action_link is missing.");
    }

    currentStep = "SUCCESS";
    log(`Link generated successfully.`);
    
    return new Response(JSON.stringify({ 
        action_link: linkData.properties.action_link,
        telemetry: logs 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : JSON.stringify(err);
    log(`CRASH: ${errorMsg}`);
    
    let safeDetails = err;
    if (err instanceof Error && ('status' in err || 'name' in err)) {
        safeDetails = { name: (err as any).name, status: (err as any).status, message: err.message };
    }

    return new Response(JSON.stringify({ 
        error: errorMsg, 
        step: currentStep,
        telemetry: logs,
        details: safeDetails 
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});