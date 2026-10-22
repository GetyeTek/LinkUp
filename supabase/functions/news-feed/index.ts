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

    // Helper: Algorithmic Feed Interleaver with Anti-Clumping & Priority Spacing
    const interleaveFeed = (newsItems: any[], featuredEvents: any[]) => {
      if (!featuredEvents || featuredEvents.length === 0) {
        return newsItems.map(n => ({ type: 'news', data: n, id: `feed-item-${n.id}` }));
      }

      const sortByWeight = (arr: any[]) => [...arr].sort((a, b) => 
        (b.weight ?? 10) - (a.weight ?? 10) || String(b.id).localeCompare(String(a.id))
      );

      const tierHigh = sortByWeight(featuredEvents.filter(e => (e.weight ?? 10) > 80));
      const tierMid = sortByWeight(featuredEvents.filter(e => (e.weight ?? 10) >= 50 && (e.weight ?? 10) <= 80));
      const tierLow = sortByWeight(featuredEvents.filter(e => (e.weight ?? 10) >= 30 && (e.weight ?? 10) < 50));
      const tierLowest = sortByWeight(featuredEvents.filter(e => (e.weight ?? 10) < 30));

      const result: any[] = [];
      let newsIdx = 0;

      const pushNewsUntil = (targetCount: number) => {
        while (newsIdx < targetCount && newsIdx < newsItems.length) {
          result.push({ type: 'news', data: newsItems[newsIdx], id: `feed-item-${newsItems[newsIdx].id}` });
          newsIdx++;
        }
      };

      const pushAnnouncement = (event: any) => {
        if (result.length > 0 && result[result.length - 1].type === 'announcement' && newsIdx < newsItems.length) {
          result.push({ type: 'news', data: newsItems[newsIdx], id: `feed-item-${newsItems[newsIdx].id}` });
          newsIdx++;
        }
        result.push({ type: 'announcement', data: event, id: `feed-item-${event.id}` });
      };

      // 1. High Priority (> 80): Slot 0, spaced by news
      if (tierHigh.length > 0) {
        pushAnnouncement(tierHigh.shift());
      }
      while (tierHigh.length > 0) {
        pushNewsUntil(newsIdx + 2);
        pushAnnouncement(tierHigh.shift());
      }

      // 2. Advance to News post #3
      pushNewsUntil(Math.max(newsIdx, 3));

      // 3. Middle Priority (50 - 80)
      while (tierMid.length > 0) {
        pushAnnouncement(tierMid.shift());
        if (tierMid.length > 0) pushNewsUntil(newsIdx + 2);
      }

      // 4. Advance to News post #7
      pushNewsUntil(Math.max(newsIdx, 7));

      // 5. Low Priority (30 - 49)
      while (tierLow.length > 0) {
        pushAnnouncement(tierLow.shift());
        if (tierLow.length > 0) pushNewsUntil(newsIdx + 2);
      }

      // 6. Advance to News post #11
      pushNewsUntil(Math.max(newsIdx, 11));

      // 7. Lowest Priority (< 30)
      while (tierLowest.length > 0) {
        pushAnnouncement(tierLowest.shift());
        if (tierLowest.length > 0) pushNewsUntil(newsIdx + 2);
      }

      // 8. Append remaining news items
      while (newsIdx < newsItems.length) {
        result.push({ type: 'news', data: newsItems[newsIdx], id: `feed-item-${newsItems[newsIdx].id}` });
        newsIdx++;
      }

      return result;
    };

    // Case 1: Announcements-only filter
    if (channel === 'announcements') {
      if (page === 0) {
        const { data: eventsData, error: eventErr } = await supabase.rpc("get_featured_events");
        if (eventErr) throw eventErr;
        const events = eventsData || [];
        const formatted = events.map((e: any) => ({
          type: 'announcement',
          data: e,
          id: `feed-item-${e.id}`
        }));
        return new Response(JSON.stringify({ 
          feed: formatted, 
          has_more: false, 
          announcement_count: events.length 
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ feed: [], has_more: false, announcement_count: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Case 2: Specific Channel Filter (e.g. 'tikvah' / 'tikvahuniversity')
    if (channel && channel !== 'all') {
      const { data, error } = await supabase
        .from("news_feed")
        .select("id, channel, telegram_id, title, snippet, full_text, image_url, post_url, telegram_timestamp")
        .eq("is_ad", false)
        .ilike("channel", `%${channel}%`)
        .order("telegram_timestamp", { ascending: false })
        .range(start, end);

      if (error) throw error;
      const formatted = (data || []).map((p: any) => ({
        type: 'news',
        data: p,
        id: `feed-item-${p.id}`
      }));
      return new Response(JSON.stringify({
        feed: formatted,
        has_more: (data || []).length === limit,
        announcement_count: 0
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Case 3: Unified Main Stream (All Updates)
    const { data: newsData, error: newsErr } = await supabase
      .from("news_feed")
      .select("id, channel, telegram_id, title, snippet, full_text, image_url, post_url, telegram_timestamp")
      .eq("is_ad", false)
      .order("telegram_timestamp", { ascending: false })
      .range(start, end);

    if (newsErr) throw newsErr;

    if (page === 0) {
      const { data: eventsData } = await supabase.rpc("get_featured_events");
      const featured = eventsData || [];
      const unified = interleaveFeed(newsData || [], featured);

      return new Response(JSON.stringify({
        feed: unified,
        has_more: (newsData || []).length === limit,
        announcement_count: featured.length
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const simpleMapped = (newsData || []).map((n: any) => ({
      type: 'news',
      data: n,
      id: `feed-item-${n.id}`
    }));

    return new Response(JSON.stringify({
      feed: simpleMapped,
      has_more: (newsData || []).length === limit
    }), {
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