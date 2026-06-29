import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("[Sync] Checking database for the latest processed post ID...");

    // 1. Fetch the maximum sequential Telegram ID currently in our database
    let lastId: number | null = null;
    const { data: maxRecord, error: fetchError } = await supabase
      .from("news_feed")
      .select("telegram_id")
      .eq("channel", "tikvahuniversity")
      .order("telegram_id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (maxRecord) {
      lastId = Number(maxRecord.telegram_id);
      console.log(`[Sync] Found last processed ID in DB: ${lastId}. Running incremental update.`);
    } else {
      console.log("[Sync] No records found. Triggering first-run (fetching 100 historical posts).");
    }

    let currentUrl = `https://t.me/s/tikvahuniversity`;
    let allCollected: any[] = [];
    let page = 1;
    let keepScraping = true;
    const maxTargetCount = lastId ? 200 : 100; // Safeguard limits

    // 2. The Pagination Scraping Loop
    while (keepScraping && allCollected.length < maxTargetCount && page <= 8) {
      console.log(`[Sync] Fetching Page ${page}: ${currentUrl}`);
      
      const response = await fetch(currentUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });

      if (!response.ok) {
        throw new Error(`Telegram returned status code ${response.status}`);
      }

      const html = await response.text();
      const messageBlocks = html.split('<div class="tgme_widget_message_wrap');
      
      // Discard header metadata
      const blocks = messageBlocks.slice(1);
      if (blocks.length === 0) {
        console.log("[Sync] No message containers found.");
        break;
      }

      const pagePosts: any[] = [];
      const messageIds: number[] = [];

      for (const block of blocks) {
        // Extract sequential post ID
        const postMatch = block.match(/data-post="[^"]*\/(\d+)"/);
        const telegramId = postMatch ? parseInt(postMatch[1], 10) : null;
        
        if (!telegramId) continue;
        messageIds.push(telegramId);

        // If we hit/pass our last synced ID during an incremental run, stop paging backward
        if (lastId && telegramId <= lastId) {
          keepScraping = false;
          continue;
        }

        // Extract raw Amharic/English text content
        const textMatch = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        let fullText = textMatch ? textMatch[1] : "";
        fullText = fullText
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .trim();

        // Extract ISO 8601 Timestamp
        const timeMatch = block.match(/<time\s+datetime="([^"]+)"/);
        const timestamp = timeMatch ? timeMatch[1] : null;

        // Extract the inline image background-image URL
        const photoMatch = block.match(/class="tgme_widget_message_photo_wrap[^"]*"[^>]*style="[^"]*background-image:\s*url\('([^']+)'\)/);
        const imageUrl = photoMatch ? photoMatch[1] : null;

        // Create news object if the post has text or an image
        if (fullText || imageUrl) {
          pagePosts.push({
            channel: "tikvahuniversity",
            telegram_id: telegramId,
            title: fullText ? fullText.split("\n")[0].substring(0, 60) : "Image Announcement",
            snippet: fullText ? fullText.substring(0, 160) + "..." : "Attached Image Announcement",
            full_text: fullText,
            image_url: imageUrl,
            post_url: `https://t.me/tikvahuniversity/${telegramId}`,
            telegram_timestamp: timestamp || new Date().toISOString()
          });
        }
      }

      if (pagePosts.length > 0) {
        allCollected = [...allCollected, ...pagePosts];
      }

      // Check if we need to paginate further backward
      if (keepScraping && messageIds.length > 0) {
        const smallestId = Math.min(...messageIds);
        if (lastId && smallestId <= lastId) {
          keepScraping = false;
        } else {
          currentUrl = `https://t.me/s/tikvahuniversity?before=${smallestId}`;
          page++;
          // Sleep for 500ms to be a polite scraper
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } else {
        break;
      }
    }

    // 3. Process gathered collection
    // Sort oldest-to-newest so database writes are sequential
    allCollected.sort((a, b) => a.telegram_id - b.telegram_id);

    // If first-run, slice exactly the newest 100 posts to satisfy requirements
    if (!lastId && allCollected.length > 100) {
      console.log(`[Sync] Back-filled ${allCollected.length} posts. Trimming down to the last 100.`);
      allCollected = allCollected.slice(-100);
    }

    console.log(`[Sync] Attempting database upsert for ${allCollected.length} collected records.`);

    if (allCollected.length > 0) {
      const { error: upsertError } = await supabase
        .from("news_feed")
        .upsert(allCollected, { onConflict: "channel,telegram_id" });

      if (upsertError) throw upsertError;
    }

    return new Response(JSON.stringify({
      success: true,
      records_synced: allCollected.length,
      mode: lastId ? "incremental" : "initial-backfill"
    }), { 
      status: 200, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });

  } catch (error) {
    console.error(`[Sync-Fatal] ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});