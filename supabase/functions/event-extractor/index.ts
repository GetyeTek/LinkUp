import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
};

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        console.log("[Event Extractor] Initiating background AI processing cycle...");

        // 1. Fetch 10 channels that haven't been processed in the last 4 hours
        const fourHoursAgo = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
        const { data: channels, error: chanErr } = await supabase
            .from("campus_channels")
            .select("id, channel_handle, last_extracted_at")
            .eq("is_active", true)
            .or(`last_extracted_at.is.null,last_extracted_at.lt.${fourHoursAgo}`)
            .limit(10);

        if (chanErr) throw chanErr;
        if (!channels || channels.length === 0) {
            return new Response(JSON.stringify({ message: "No channels require processing at this time." }), { headers: corsHeaders });
        }

        console.log(`[Event Extractor] Processing ${channels.length} groups concurrently.`);

        // --- GEMINI ROTATION & RETRY ENGINE ---
        const callGemini = async (prompt: string, maxRetries = 3): Promise<any[]> => {
            let attempts = 0;
            while (attempts <= maxRetries) {
                // Lease a fresh key
                const { data: keyData, error: keyErr } = await supabase.rpc('lease_gemini_api_key');
                if (keyErr || !keyData || keyData.length === 0) throw new Error("No active Gemini API keys available.");
                const apiKey = keyData[0].api_key;

                const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ role: "user", parts: [{ text: prompt }] }],
                        generationConfig: { responseMimeType: "application/json" }
                    })
                });

                if (res.status === 429) {
                    console.warn(`[Event Extractor] Key exhausted (429). Triggering cooldown and rotating...`);
                    await supabase.rpc('cooldown_gemini_key', { expired_key: apiKey });
                    attempts++;
                    continue;
                }

                if (!res.ok) throw new Error(`Gemini API Error: ${res.status} ${await res.text()}`);
                
                const data = await res.json();
                const rawOutput = data.candidates[0].content.parts[0].text;
                
                // Extremely robust JSON array extraction
                const match = rawOutput.match(/\[[\s\S]*\]/);
                if (match) return JSON.parse(match[0]);
                return [];
            }
            throw new Error("Failed to contact Gemini after multiple round-robin attempts.");
        };

        // 2. Concurrently process all grabbed channels
        const processingPromises = channels.map(async (channel) => {
            try {
                // Fetch unprocessed messages
                let query = supabase.from('campus_feed')
                    .select('telegram_id, sender_name, full_text, telegram_timestamp')
                    .eq('channel_handle', channel.channel_handle)
                    .order('telegram_timestamp', { ascending: true });

                if (channel.last_extracted_at) {
                    query = query.gt('telegram_timestamp', channel.last_extracted_at);
                } else {
                    query = query.limit(150); // First run cap
                }

                const { data: messages, error: msgErr } = await query;
                if (msgErr) throw msgErr;

                // Mark processed time unconditionally so we don't infinitely retry dead/empty channels
                const extractionTime = new Date().toISOString();
                await supabase.from('campus_channels').update({ last_extracted_at: extractionTime }).eq('id', channel.id);

                if (!messages || messages.length === 0) return;

                // Format chat log for AI
                const chatLog = messages.map(m => `[ID: ${m.telegram_id}] [${m.telegram_timestamp}] ${m.sender_name || 'User'}: ${m.full_text}`).join('\n');
                
                const prompt = `You are a university AI data extractor specializing in Ethiopian university campus chat logs.
Analyze the following Telegram group messages and extract ONLY critical academic deadlines, exam schedules, and submission events.
IGNORE casual chatter, greetings, social banter, questions without answers, and spam.

ETHIOPIAN LINGUISTIC & SLANG PARSING:
Messages are written in Amharic (Ge'ez Fidel), English, or Latin-transliterated Amharic (Fidelfont) with student abbreviations and typos.
Recognize these day-of-week terms:
- Monday: Senyo, Segno, ሰኞ
- Tuesday: Maksegno, Makesegno, Makse, ማክሰኞ
- Wednesday: Erob, Rob, እሮብ, ረቡዕ
- Thursday: Hamus, ሐሙስ, ሀሙስ
- Friday: Arb, አርብ, ዓርብ
- Saturday: Kidame, ቅዳሜ
- Sunday: Ehud, እሁድ, እሑድ
Recognize these academic terms:
- "fetena" / ፈተና = exam / quiz
- "mid" / "mid fetena" = midterm exam
- "final" / "final fetena" = final exam
- "assignment" / "asaynment" / "asgebu" = assignment submission

CRITICAL HABESHA 12-HOUR TIME SYSTEM (THE 6-HOUR SHIFT):
Ethiopian university students almost universally use the Habesha 12-hour clock (anchored at sunrise, 6:00 AM Western):
- "Tewat X:00" (ጠዋት) = Western (X + 6) AM EAT.
  * e.g., "Tewat 2:00" = 8:00 AM (08:00).
- "Kese'at X:00" (ከሰዓት) = Western (X + 6 - 12) PM EAT.
  * e.g., "Kese'at 8:00" = 2:00 PM Western (14:00).
  * e.g., "Kese'at 7:00" = 1:00 PM Western (13:00).
  * e.g., "Kese'at 9:00" = 3:00 PM Western (15:00).
  * e.g., "Kese'at 10:00" = 4:00 PM Western (16:00).
- "Mata X:00" (ማታ) = Western (X + 6) PM EAT.
  * e.g., "Mata 2:00" = 8:00 PM Western (20:00).
- If a message specifies explicit Western time like "2:00 PM" or "14:00", respect it directly. But if it says "kese'at X:00", apply the Habesha 6-hour shift!

CALENDAR & TIMEZONE RULES:
- Current server time: ${extractionTime}
- All events occur in Ethiopia (East Africa Time, EAT, UTC+3).
- Derive today's day of week from the current time in EAT (+03:00).
  * If today is Monday (e.g. Oct 12) and a message says "Maksegno", that means tomorrow (Tuesday, Oct 13).
  * Calculate the target date and output the event_date strictly in ISO-8601 format with the +03:00 offset: YYYY-MM-DDTHH:mm:ss+03:00.

OUTPUT FORMAT:
Return strictly a valid JSON array of objects (no markdown wrappers around the JSON):
[
  {
    "title": "Short title in English (e.g. Economics Midterm Exam)",
    "description": "Clear explanation of what is due or scheduled",
    "event_type": "deadline" | "announcement" | "event",
    "event_date": "YYYY-MM-DDTHH:mm:ss+03:00" | null,
    "source_ids": [1234]
  }
]
If nothing critical is found, return an empty array [].

Chat Log to Analyze:
${chatLog}`;

                // 3. Ask Miron Athena to process the log
                const extractedEvents = await callGemini(prompt);

                if (extractedEvents && extractedEvents.length > 0) {
                    // 4. Save to database
                    const insertPayload = extractedEvents.map((ev: any) => ({
                        channel_id: channel.id,
                        title: ev.title,
                        description: ev.description,
                        event_type: ev.event_type,
                        event_date: ev.event_date || null,
                        source_ids: ev.source_ids || []
                    }));

                    const { error: insErr } = await supabase.from('extracted_events').insert(insertPayload);
                    if (insErr) console.error(`[Event Extractor] DB Insert Error for ${channel.channel_handle}:`, insErr.message);
                    else console.log(`[Event Extractor] ✅ Extracted ${extractedEvents.length} events for ${channel.channel_handle}`);
                }

            } catch (err) {
                console.error(`[Event Extractor] ❌ Failed processing channel ${channel.channel_handle}:`, err.message);
            }
        });

        // Await all parallel operations
        await Promise.all(processingPromises);

        return new Response(JSON.stringify({ success: true, processed_channels: channels.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (error) {
        console.error(`[Event Extractor Fatal] ${error.message}`);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }
});