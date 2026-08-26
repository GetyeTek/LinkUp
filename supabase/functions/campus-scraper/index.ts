import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function decodeTelegramHtml(rawHtml: string): string {
  if (!rawHtml) return "";
  return rawHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&#8203;/gi, "")
    .replace(/&zwnj;|&zwj;/gi, "")
    .replace(/"/gi, '"')
    .replace(/&apos;|'/gi, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/gi, '"')
    .replace(/&lsquo;|&rsquo;|&#8216;|&#8217;/gi, "'")
    .replace(/&mdash;|&#8212;/gi, "—")
    .replace(/&ndash;|&#8211;/gi, "–")
    .replace(/&bull;|&#8226;/gi, "•")
    .replace(/&hellip;|&#8230;/gi, "…")
    .replace(/</gi, "<")
    .replace(/>/gi, ">")
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ""; }
    })
    .replace(/&/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    // Initialize Supabase Admin Client
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') || '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    try {
        console.log("[Campus Scraper] Initializing concurrent multi-channel extraction...");

        // 1. Fetch active PUBLIC targets only
        const { data: channels, error: fetchErr } = await supabase
            .from('campus_channels')
            .select('*')
            .eq('is_active', true)
            .eq('is_private', false);

        if (fetchErr) throw fetchErr;
        if (!channels || channels.length === 0) {
            return new Response(JSON.stringify({ message: "No active channels to scrape." }), { headers: corsHeaders });
        }

        let totalScraped = 0;

        // 2. Process all channels concurrently
        const scrapePromises = channels.map(async (channel) => {
            let currentHighestId = channel.last_scraped_id || 0;
            let oldestIdInPage = Infinity;
            let hasNewPages = true;
            let url = `https://t.me/s/${channel.channel_handle}`;
            
            const channelPosts = [];

            // 3. Loop deeply backwards until we hit already-scraped messages
            while (hasNewPages) {
                const response = await fetch(url);
                if (!response.ok) break; // Channel might be private or deleted
                
                const html = await response.text();
                
                // Match individual message blocks (Parses Telegram Web Preview DOM)
                const messageBlockRegex = /data-post="[^/]+\/(\d+)"([\s\S]*?)<time datetime="([^"]+)"/g;
                let match;
                let foundNewInPage = false;
                let pageHasMessages = false;

                while ((match = messageBlockRegex.exec(html)) !== null) {
                    pageHasMessages = true;
                    const postId = parseInt(match[1], 10);
                    const blockHtml = match[2];
                    const timeStr = match[3];

                    if (postId < oldestIdInPage) oldestIdInPage = postId;

                    // If this post is newer than the last time we checked
                    if (postId > channel.last_scraped_id) {
                        foundNewInPage = true;
                        if (postId > currentHighestId) currentHighestId = postId;

                        // Extract Clean Text with comprehensive entity decoding
                        const textMatch = /<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/.exec(blockHtml);
                        let cleanText = textMatch ? decodeTelegramHtml(textMatch[1]) : null;

                        // Extract Image (if attached)
                        const imgMatch = /background-image:url\(['"]?([^'"]+)['"]?\)/.exec(blockHtml);
                        const imageUrl = imgMatch ? imgMatch[1] : null;

                        // Only ingest if it actually contains data
                        if (cleanText || imageUrl) {
                            channelPosts.push({
                                telegram_id: postId,
                                channel_handle: channel.channel_handle,
                                full_text: cleanText,
                                image_url: imageUrl,
                                telegram_timestamp: timeStr,
                                metadata: { source: "edge_scraper", is_private: false }
                            });
                        }
                    }
                }

                // 4. Pagination Logic: Move to previous page if we haven't hit the bottom of new content yet
                if (pageHasMessages && foundNewInPage && oldestIdInPage > channel.last_scraped_id) {
                    url = `https://t.me/s/${channel.channel_handle}?before=${oldestIdInPage}`;
                } else {
                    hasNewPages = false; // We hit the barrier of already-scraped data
                }
            }

            // 5. Batch Insert & Update Tracker for this specific channel
            if (channelPosts.length > 0) {
                const { error: insertErr } = await supabase
                    .from('campus_feed')
                    .upsert(channelPosts, { onConflict: 'channel_handle, telegram_id' });
                    
                if (!insertErr) {
                    await supabase
                        .from('campus_channels')
                        .update({ last_scraped_id: currentHighestId })
                        .eq('id', channel.id);
                    
                    totalScraped += channelPosts.length;
                    console.log(`[Campus Scraper] ✅ ${channel.channel_handle}: Extracted ${channelPosts.length} new records.`);
                } else {
                    console.error(`[Campus Scraper] ❌ Insert Error for ${channel.channel_handle}:`, insertErr);
                }
            } else {
                console.log(`[Campus Scraper] ⚡ ${channel.channel_handle}: Up to date.`);
            }
        });

        // Await all concurrent scrapers to finish
        await Promise.all(scrapePromises);

        return new Response(JSON.stringify({ 
            success: true, 
            message: `Scrape cycle complete. Ingested ${totalScraped} new campus announcements.` 
        }), { 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });

    } catch (err) {
        console.error("[Campus Scraper] Fatal Error:", err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
});