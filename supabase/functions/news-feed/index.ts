import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding, x-linkup-client",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    
    const page = Math.max(0, parseInt(body.page || url.searchParams.get("page") || "0", 10));
    const limit = Math.min(50, Math.max(1, parseInt(body.limit || url.searchParams.get("limit") || "15", 10)));
    const rawChannel = body.channel || url.searchParams.get("channel") || "";
    const channel = rawChannel.replace(/^@/, '').trim().toLowerCase();

    const start = page * limit;
    const end = start + limit - 1;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let query = supabase
      .from("news_feed")
      .select("id, channel, telegram_id, title, snippet, full_text, image_url, post_url, telegram_timestamp")
      .eq("is_ad", false)
      .order("telegram_timestamp", { ascending: false })
      .range(start, end);

    if (channel) {
      query = query.eq("channel", channel);
    }

    const { data, error } = await query;

    if (error) throw error;

    return new Response(JSON.stringify({ news: data || [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`[News-Feed Error]`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});