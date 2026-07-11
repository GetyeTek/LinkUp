import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding, x-linkup-client",
};

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

function extractTextFromBlockArray(blocks: any[]) {
    return blocks.map(b => {
        if (!b) return '';
        let text = [];
        if (b.main) text.push(b.main);
        if (b.sub) text.push(b.sub);
        if (b.title) text.push(b.title);
        if (b.body) text.push(b.body);
        if (b.text) text.push(b.text);
        if (b.items && Array.isArray(b.items)) text.push(b.items.join(' '));
        if (b.premises) text.push(b.premises.join(' '));
        if (b.conclusion) text.push(b.conclusion);
        if (b.question) text.push(b.question);
        return text.join(' ').replace(/<[^>]+>/g, '').trim(); 
    }).filter(Boolean).join('\n');
}

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const { book_id, chapter_title } = await req.json();
        
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
        const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

        // 1. Fetch Book & TOC
        const { data: book, error: bookErr } = await supabase.from('books').select('title, toc').eq('id', book_id).single();
        if (bookErr || !book) throw new Error("Book not found.");

        // 2. Flatten TOC to calculate exact page ranges
        const flatToc: any[] = [];
        const traverse = (nodes: any[]) => {
            for (const node of nodes) {
                flatToc.push(node);
                if (node.children) traverse(node.children);
            }
        };
        traverse(book.toc || []);

        const targetIdx = flatToc.findIndex((n: any) => n.title === chapter_title);
        if (targetIdx === -1) throw new Error("Chapter not found in TOC.");

        const startPage = flatToc[targetIdx].page;
        let endPage = 99999;
        
        for (let i = targetIdx + 1; i < flatToc.length; i++) {
            if (flatToc[i].page > startPage) {
                endPage = flatToc[i].page;
                break;
            }
        }

        // 3. Extract Raw Book Pages
        const { data: pages, error: pageErr } = await supabase.from('book_pages')
            .select('content_json')
            .eq('book_id', book_id)
            .gte('page_number', startPage)
            .lt('page_number', endPage)
            .order('page_number', { ascending: true })
            .limit(10); // Safeguard token limits

        if (pageErr) throw pageErr;

        const rawText = pages.map(p => extractTextFromBlockArray(p.content_json || [])).join("\n\n");
        if (!rawText.trim()) throw new Error("No readable text found in this chapter.");

        // 4. API Key Round-Robin
        const { data: keys } = await supabase.from('api_keys').select('*').eq('service', 'gemini').eq('is_active', true).order('last_used_at', { ascending: true, nullsFirst: true });
        const keyRecord = keys?.find(k => !k.cooldown_until || new Date(k.cooldown_until) < new Date());
        if (!keyRecord) throw new Error("No active Gemini API keys available.");
        
        await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRecord.id);

        // 5. Generation Prompt with Strict Tone Control
        const prompt = `You are Miron, a supportive, highly intelligent university classmate.
Your peer is struggling with this textbook section. Your job is to break it down, analyze it, and explain it to them in a way that is incredibly engaging, clear, and colloquial.

CORE LANGUAGE & SCRIPT REQUIREMENTS:
- You MUST write the baseline of your lecture script in AMHARIC using the Ge'ez alphabet (e.g., 'ሰላም', 'እንዴት', 'ማለት', 'ነገር').
- Under no circumstances should the base sentences be written in Latin-transliterated Amharic or plain English. The foundation of the text must be readable Amharic script.

TONAL & LINGUISTIC BLENDING (THE "ETHIO-ENGLISH" PEER VIBE):
- Act like a close, smart classmate talking directly to another student in a relaxed, informal study session. The tone must be friendly, energetic, and highly conversational.
- Naturally blend in English academic, technical, or transitional terms directly in the middle of your Amharic sentences (written in English script, e.g., "thermodynamics", "stipulative definition", "concept", "anyway", "you know", "focus", "clear").
- Use English terminology for words that would sound overly formal, robotic, or unnatural if translated into Amharic. The objective is to sound exactly like a brilliant Ethiopian university student explaining material to their friend in the hallway.
- Do NOT repeat the exact same English filler words over and over. Keep the vocabulary natural, diverse, and fluid.

CRITICAL SPEECH FLOW GUIDELINES (FOR TEXT-TO-SPEECH ENGINES):
- This script will be read aloud by an automated speech synthesizer (TTS model). You must write with absolute phonetic clarity.
- STRICTLY avoid lists, bullet points, asterisks, or formatting tables. Write everything in continuous, flowing, paragraph prose.
- NEVER use brackets (), [], or braces {}. Brackets completely break the phonetic flow of reading engines. If you need to add details or explanations, weave them naturally directly into the sentence structure itself.
- Write out numbers (like years, counts, or math formulas) in words if it makes them easier and more natural to pronounce aloud in conversational flow.

CHUNK & STRUCTURAL SPECIFICATIONS:
- Break the entire generated lecture into 4 to 6 sequential, semantic paragraphs (chunks).
- EACH chunk MUST be a substantial block of text containing EXACTLY 5 to 8 complete sentences. Do not write short, lazy, or sparse chunks.
- Output ONLY a valid JSON object matching this schema, with no markdown formatting wrappers around the JSON:
{
  "chunks": [
    "Chunk 1 text (5-8 sentences, written in Amharic script with English terms blended)...",
    "Chunk 2 text (5-8 sentences, written in Amharic script with English terms blended)..."
  ]
}

Source Material:
${rawText}`;

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${keyRecord.api_key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            })
        });

        if (!res.ok) throw new Error(`Gemini API Error: ${res.status}`);
        const geminiData = await res.json();
        
        let resultJson = { chunks: [] };
        try {
            const rawOutput = geminiData.candidates[0].content.parts[0].text;
            resultJson = JSON.parse(rawOutput);
        } catch (e) {
            throw new Error("Failed to parse JSON chunks from Gemini.");
        }

        return new Response(JSON.stringify(resultJson), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
    }
});