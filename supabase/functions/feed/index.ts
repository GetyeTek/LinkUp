import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
};

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

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

async function getGeminiKey(supabase: any) {
  const { data: keyData, error: keyErr } = await supabase.rpc('lease_gemini_api_key');
  if (keyErr || !keyData || keyData.length === 0) {
    throw new Error("No active Gemini API keys available in key pool.");
  }
  return keyData[0];
}

async function cooldownKey(supabase: any, keyId: number, apiKey: string) {
  try {
    await supabase.rpc('cooldown_api_key', { p_key_id: keyId });
  } catch {
    await supabase.rpc('cooldown_gemini_key', { expired_key: apiKey });
  }
}

async function filterAndCategorizePosts(supabase: any, posts: any[]) {
  if (!posts || posts.length === 0) return posts;

  const systemPrompt = `You are an elite academic news filter and classifier for Ethiopian university students.
Analyze the provided batch of Telegram posts from university channels and determine if each post is an advertisement/spam or legitimate university/academic news.

CLASSIFICATION RULES:
- Set "is_ad": true for:
  * Commercial advertisements, private course/training sales (e.g. photography, graphic design, programming bootcamps with fee/phone numbers).
  * Product/equipment sales (laptops, phones, SIM cards, stores, electronics).
  * Betting/casino/crypto/forex promotions.
  * Cross-promotional channel links or unrelated bot links.
  * Spam, scams, or non-educational marketing.
- Set "is_ad": false for:
  * University announcements, entrance exams, remedial exams, ministry (MoE/HERQA) updates.
  * Legitimate academic scholarships, university student placements, dormitory/campus notices, graduation updates.
  * Official university student union or educational events.

OUTPUT FORMAT:
Respond with ONLY a valid JSON array of objects with the exact schema (no markdown wrappers):
[
  {
    "telegram_id": number,
    "is_ad": boolean,
    "category": "academic" | "announcement" | "scholarship" | "exam" | "ad" | "spam",
    "clean_title": "Short title in original language (Amharic/English)"
  }
]`;

  const userContent = JSON.stringify(posts.map(p => ({
    telegram_id: p.telegram_id,
    channel: p.channel,
    title: p.title,
    text: p.full_text?.substring(0, 600) || p.snippet || ""
  })), null, 2);

  let attempts = 0;
  while (attempts < 3) {
    try {
      const keyRecord = await getGeminiKey(supabase);
      const apiKey = keyRecord.api_key;
      const keyId = keyRecord.id;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userContent }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
        })
      });

      if (res.status === 429) {
        console.warn(`[Filter] Gemini 429 rate limit. Cooling down key ${keyId}...`);
        await cooldownKey(supabase, keyId, apiKey);
        attempts++;
        continue;
      }

      if (!res.ok) {
        throw new Error(`Gemini API Error: ${res.status} ${await res.text()}`);
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error("Empty response from Gemini.");

      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const classifications: any[] = JSON.parse(cleaned);

      const classMap = new Map(classifications.map((c: any) => [c.telegram_id, c]));

      return posts.map(p => {
        const match = classMap.get(p.telegram_id);
        return {
          ...p,
          is_ad: match ? Boolean(match.is_ad) : false,
          category: match?.category || "academic",
          title: match?.clean_title || p.title
        };
      });

    } catch (err: any) {
      console.error(`[Filter Attempt ${attempts + 1}] Error:`, err.message);
      attempts++;
      if (attempts >= 3) {
        console.warn("[Filter] Fallback engaged: saving posts with default flags.");
        return posts.map(p => ({ ...p, is_ad: false, category: "academic" }));
      }
    }
  }
  return posts.map(p => ({ ...p, is_ad: false, category: "academic" }));
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    
    // Support dynamic channel handles via parameter or body, default to 'tikvahuniversity'
    const rawChannel = body.channel || url.searchParams.get("channel") || "tikvahuniversity";
    const targetChannel = rawChannel
      .replace(/^@/, '')
      .replace(/https?:\/\/t\.me\/(?:s\/)?/i, '')
      .trim()
      .toLowerCase();

    console.log(`[Sync] Checking database for the latest processed post ID in channel: ${targetChannel}...`);

    // 1. Fetch the maximum sequential Telegram ID currently in our database for this channel
    let lastId: number | null = null;
    const { data: maxRecord, error: fetchError } = await supabase
      .from("news_feed")
      .select("telegram_id")
      .eq("channel", targetChannel)
      .order("telegram_id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (maxRecord) {
      lastId = Number(maxRecord.telegram_id);
      console.log(`[Sync] Found last processed ID in DB: ${lastId} for ${targetChannel}. Running incremental update.`);
    } else {
      console.log(`[Sync] No records found for ${targetChannel}. Triggering first-run (fetching 100 historical posts).`);
    }

    let currentUrl = `https://t.me/s/${targetChannel}`;
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
        throw new Error(`Telegram channel '${targetChannel}' returned status code ${response.status}`);
      }

      const html = await response.text();
      const messageBlocks = html.split('<div class="tgme_widget_message_wrap');
      
      // Discard header metadata
      const blocks = messageBlocks.slice(1);
      if (blocks.length === 0) {
        console.log(`[Sync] No message containers found for ${targetChannel}.`);
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

        // Extract raw Amharic/English text content with comprehensive entity decoding
        const textMatch = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        let fullText = textMatch ? decodeTelegramHtml(textMatch[1]) : "";

        // Extract ISO 8601 Timestamp
        const timeMatch = block.match(/<time\s+datetime="([^"]+)"/);
        const timestamp = timeMatch ? timeMatch[1] : null;

        // Extract the inline image background-image URL
        const photoMatch = block.match(/class="tgme_widget_message_photo_wrap[^"]*"[^>]*style="[^"]*background-image:\s*url\('([^']+)'\)/);
        const imageUrl = photoMatch ? photoMatch[1] : null;

        // Create news object if the post has text or an image
        if (fullText || imageUrl) {
          pagePosts.push({
            channel: targetChannel,
            telegram_id: telegramId,
            title: fullText ? fullText.split("\n")[0].substring(0, 60) : "Image Announcement",
            snippet: fullText ? fullText.substring(0, 160) + "..." : "Attached Image Announcement",
            full_text: fullText,
            image_url: imageUrl,
            post_url: `https://t.me/${targetChannel}/${telegramId}`,
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
          currentUrl = `https://t.me/s/${targetChannel}?before=${smallestId}`;
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

    if (allCollected.length > 0) {
      console.log(`[Sync] Filtering and classifying ${allCollected.length} collected records via Gemini AI...`);
      allCollected = await filterAndCategorizePosts(supabase, allCollected);

      const adsCount = allCollected.filter((p: any) => p.is_ad).length;
      console.log(`[Sync] Classification complete: ${allCollected.length - adsCount} academic posts, ${adsCount} ads flagged.`);

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