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
        const prompt = `You are Miron, a supportive university peer.
Read the following textbook section and write a highly engaging, colloquial lecture script based on it.

TONAL REQUIREMENTS:
- Use a highly colloquial, informal Amharic tone. Imagine you are talking directly to a peer in a relaxed study group setting.
- You must naturally blend in English academic, technical, or transitional words where translating them into Amharic would sound stiff or formal. 
- Use English to maintain a casual, conversational, and energetic peer-to-peer vibe.

CRITICAL SPEECH FLOW GUIDELINES (This script will be read by a Text-to-Speech engine):
- Write in phonetically clear, continuous prose.
- Strictly avoid lists, bullet points, asterisks, or formatting tables.
- NEVER use brackets (), [], or braces {}. Brackets interrupt natural speech flow. If you need to add details or explanations, write them out directly in the sentence structure.
- Write numbers as words if it helps the speech sound more conversational.
- Break your script into 4-6 semantic chunks (about 3-5 sentences each).

OUTPUT FORMAT:
Return ONLY a valid JSON object exactly like this:
{
  "chunks": ["chunk 1 text...", "chunk 2 text..."]
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