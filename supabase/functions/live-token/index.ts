import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AccessToken } from 'https://esm.sh/livekit-server-sdk@1.2.6';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { conversation_id } = await req.json();
    if (!conversation_id) throw new Error("Missing conversation_id");

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("Missing Authorization header");

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!, 
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Authenticate user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    // 2. Verify Membership and Role
    const { data: member, error: memberError } = await supabase
        .from('conversation_members')
        .select('role')
        .eq('conversation_id', conversation_id)
        .eq('user_id', user.id)
        .single();

    if (memberError || !member) throw new Error("Access Denied. Not a member of this squad.");

    // 3. Establish LiveKit Privileges
    const isHost = member.role === 'owner' || member.role === 'admin';
    const roomName = `squad_${conversation_id}`;

    const at = new AccessToken(
        Deno.env.get('LIVEKIT_API_KEY')!, 
        Deno.env.get('LIVEKIT_API_SECRET')!, 
        { identity: user.id }
    );

    at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: isHost,      // Only the host can broadcast audio
        canSubscribe: true,      // Everyone can listen
        canPublishData: true,    // For custom signaling if needed later
    });

    const livekitToken = await at.toJwt();
    const wsUrl = Deno.env.get('LIVEKIT_URL')!;

    return new Response(JSON.stringify({ token: livekitToken, ws_url: wsUrl }), { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });

  } catch (error) {
    console.error(`[LIVE-TOKEN ERROR] ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 403, headers: corsHeaders });
  }
});