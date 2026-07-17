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
                
                const prompt = `You are a university AI data extractor. Analyze the following Telegram group chat logs and extract ONLY critical information: Deadlines, Announcements, and specific Events.
IGNORE standard conversational chatter, greetings, questions without conclusions, and spam.

CRITICAL TIME AWARENESS:
The current time is: ${extractionTime}
If a message says "tomorrow at 5PM", "this Friday", or gives a relative date, calculate the exact ISO-8601 timestamp based on the provided current time and the timestamp attached to the message.

OUTPUT INSTRUCTIONS:
Return strictly a JSON array of objects matching this exact schema:
[
  {
    "title": "A short, punchy title",
    "description": "Detailed explanation of the event/deadline",
    "event_type": "deadline" | "announcement" | "event",
    "event_date": "YYYY-MM-DDTHH:mm:ssZ" | null,
    "source_ids": [1234, 1235] // Array of integers representing the Telegram message IDs that provided this info
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