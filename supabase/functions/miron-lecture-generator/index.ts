import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding, x-linkup-client",
};

const GEMINI_MODEL = "gemini-3-flash-preview";

// Core prompt base containing all formatting, personality, tone, and exam strategies (untouched)
const MIRON_CORE_PROMPT_BASE = `You are Miron, an expert peer tutor and a highly supportive classmate. Your peer is struggling with this textbook section. Your job is to write a comprehensive video or audio study script breaking it down, explaining it clearly, and helping them ace their exam.

Write me a script for me to read in a video. The script text you write explains
this chapter in detail. Rules:

1.  You must use an extremely casual and informal tone because what I'm
    addressing is my peer friends. Think of a group study you do with your ride
    or die buddies. But this doesn't mean you should excessively try to use in a
    way that makes you look like sweating to sound cool.

2.  You must write it in Amharic first,blended with English blended. Means, you
    write it in Amharic first(ge'ez/Fidel),but you use English for technical
    words ,terms that aren't meant to be translated,and crucially,things that
    boys in Addis Ababa talk like,slangs,usages,such stuffs. If you see them,they blend English to their
    speech...you must be familiar with it

3.  Don't use brackets or such stuffs that troubles me to read straight. Since
    I'll also give this script to ai to read,you just make everything textual.

4.  Mention things the audience should notice,like exam tips, common tricks,
    things easy to mix up... anything that they should clear out.

5.  Reference to the book sometimes for legitimateness,like occasionally
    referencing the page that you're talking about.

6.  When introducing a difficult concept, explain it using simple, relatable,
    real-world analogies rather than abstract, complex jargon. Clearly
    differentiate between contrasting ideas by listing their distinct features
    side-by-side or in structured lists.

7.  When you first is about to begin, greet them properly and tell what we're
    gonna be studying today,what we'll cover and such introductions.

Details below:

CORE PERSONALITY & TONE:
- Be extremely casual, supportive, and natural. Act like a brilliant close friend leading a relaxed late-night group study session.
- Keep it engaging and friendly, but don't try too hard to sound "cool"—keep the vibe completely authentic.

LANGUAGE & LINGUISTIC BLENDING (THE "ETHIO-ENGLISH" PEER VIBE):
- Write primarily in Amharic using the Ge'ez alphabet. Under no circumstances use Latin-transliterated Amharic for the base text.
- Naturally blend in English academic terms, technical vocabulary, and everyday conversational phrases directly in the middle of your Amharic sentences (written in English script)
- Use English for terms that would sound overly robotic or formal if translated. It should sound exactly like a smart Addis Ababa university student breaking down slides in the hallway.

EXAM PREPARATION & EXPLAINER STRATEGY:
- Use highly relatable real-world analogies to simplify any abstract or complex technical concepts.
- When there are contrasting definitions or categories, differentiate them clearly with side-by-side comparative descriptions or lists woven naturally into paragraphs.
- Point out potential "exam traps", common tricks examiners pull, and high-yield concepts to focus on.
- Occasionally reference the text (e.g., mentioning specific sections or pages) to keep the study session grounded.

CRITICAL FORMATTING LAWS FOR SPEECH ENGINES (TTS-FRIENDLY):
- Strictly avoid lists, bullet points, asterisks, or formatting tables. Write everything in continuous, flowing, paragraph prose.
- NEVER use brackets (), [], or braces {} (EXCEPT for the specific visual board tags defined below). Brackets completely break phonetic reading engines. Weave all other parenthetical details directly into the spoken sentence.
- Write out numbers, percentages, or formulas in spoken words if it makes them more natural to pronounce in conversational speech.

VISUAL BOARD FORMATTING:
If a sentence, term, or formula should be visually printed on the screen while you speak it, you MUST wrap it in [print] tags.
Inside the print tags, you can optionally wrap words in curly-braces to trigger styling animations:
- {u}underlined{u}
- {h}highlighted{h}
- {p}pulsing text{p}
- {b}bold{b}
- {i}italic{i}
- {t}typewriter effect{t}
Example: "Here is how it works: [print]The {u}mitochondria{u} is the {h}powerhouse{h} of the cell.[print]"`;

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
        const body = await req.json();
        const action = body.action || "generate_lecture";
        
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
        const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

        const getGeminiKey = async () => {
            const { data, error } = await supabase.rpc('lease_gemini_api_key');
            if (error || !data || data.length === 0) {
                throw new Error("No active Gemini API keys available.");
            }
            return data[0].api_key;
        };

        const callGeminiWithRetry = async (payload: any, getApiKey: () => Promise<string>, maxRetries = 3) => {
            let attempts = 0;
            while (attempts <= maxRetries) {
                const apiKey = await getApiKey();
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
                
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                if (res.status === 503 && attempts < maxRetries) {
                    console.warn(`[Gemini API] Received 503 Service Unavailable. Retrying immediately (Attempt ${attempts + 1}/${maxRetries})...`);
                    attempts++;
                    continue;
                }
                
                if (!res.ok) {
                    throw new Error(`Gemini API Error: ${res.status}`);
                }
                
                return await res.json();
            }
        };

        if (action === "generate_lecture") {
            const { book_id, chapter_title, conversation_id } = body;
            if (!conversation_id) throw new Error("conversation_id parameter is required for stateful generation.");

            // 1. Fetch Session State for State Machine logic
            let { data: session, error: sessErr } = await supabase.from('live_study_sessions')
                .select('*')
                .eq('conversation_id', conversation_id)
                .maybeSingle();

            if (sessErr) throw sessErr;

            // If the session does not exist, insert a fresh placeholder
            if (!session) {
                const { data: newSession, error: createErr } = await supabase.from('live_study_sessions')
                    .insert({
                        conversation_id,
                        generation_state: 'idle',
                        lecture_chunks: [],
                        lesson_topic: chapter_title
                    })
                    .select()
                    .single();

                if (createErr) throw createErr;
                session = newSession;
            }

            const state = session.generation_state || 'idle';

            // Fast-return if already completed to save processing costs on accidental re-triggers
            if (state === 'completed') {
                return new Response(JSON.stringify({ chunks: session.lecture_chunks, finished: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 2. Fetch Book & TOC to determine midpoint
            const { data: book, error: bookErr } = await supabase.from('books').select('title, toc').eq('id', book_id).single();
            if (bookErr || !book) throw new Error("Book not found.");

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

            const totalPages = endPage - startPage;
            const midpointPage = startPage + Math.ceil(totalPages / 2);

            let batchStartPage = startPage;
            let batchEndPage = endPage;

            // Slice boundaries depending on current transient status
            if (state === 'idle') {
                batchEndPage = midpointPage;
            } else if (state === 'batch_1_complete') {
                batchStartPage = midpointPage;
            }

            // 3. Extract Raw Book Pages for this specific batch
            const { data: pages, error: pageErr } = await supabase.from('book_pages')
                .select('content_json')
                .eq('book_id', book_id)
                .gte('page_number', batchStartPage)
                .lt('page_number', batchEndPage)
                .order('page_number', { ascending: true });

            if (pageErr) throw pageErr;

            const rawText = pages.map(p => extractTextFromBlockArray(p.content_json || [])).join("\n\n");
            if (!rawText.trim()) throw new Error("No readable text found in this chapter batch.");

            let prompt = "";

            if (state === 'idle') {
                // Batch 1 Prompt: Includes introductory elements and leaves session open
                prompt = `${MIRON_CORE_PROMPT_BASE}

CHUNK & STRUCTURAL SPECIFICATIONS (BATCH 1 OF 2):
- Break this batch of the lecture script into at least 50 sequential chunks (paragraphs). You're encouraged to write even more if possible.
- EACH chunk MUST be a fast, punchy block of text containing at least 2 complete sentences. 
- Ensure at least one sentence per chunk is wrapped in a [print] tag to keep the board active.
- Starting Instruction: Since this is the absolute beginning of our session, greet the guys properly and enthusiastically. Tell them what we are going to be studying today and what topics we will cover before diving straight into the material. Set the relaxed, late-night ride-or-die study session tone immediately.
- Ending Instruction: Cover and explain only the first half of the textbook material provided below. Once you reach at least the 50th chunk, do NOT sign off, do NOT say goodbye, and do NOT conclude. Instead, try to land on a clear sub-topic milestone or transition point so the next generation pass can pick up smoothly. Keep the ending fully open-ended. But if you can't get a milestone or subtopic to land on,you can end it anywhere you'd like. 
- Output ONLY a valid JSON object matching this schema, with no markdown formatting wrappers around the JSON:
{
  "chunks": [
    "Chunk 1 text (2 complete sentences, written in Amharic script with English terms blended, including [print] tags)...",
    "Chunk 2 text (2 complete sentences, written in Amharic script with English terms blended, including [print] tags)..."
  ]
}

Source Material (First Half of Chapter):
${rawText}`;
            } else if (state === 'batch_1_complete') {
                // Batch 2 Prompt: Forces absolute continuation and appends terminal closing statements
                const existingChunks = session.lecture_chunks || [];
                
                prompt = `${MIRON_CORE_PROMPT_BASE}

CHUNK & STRUCTURAL SPECIFICATIONS (BATCH 2 OF 2):
- Break this batch of the lecture script into at least 50 sequential chunks (paragraphs). You're encouraged to write more if possible.
- EACH chunk MUST be a fast, punchy block of text containing at least 2 complete sentences. 
- Ensure at least one sentence per chunk is wrapped in a [print] tag to keep the board active.
- Starting Instruction: You MUST pick up exactly from where the first batch of chunks left off. Do NOT greet the audience. Do NOT introduce yourself or what we are covering. Chunk 51 must flow seamlessly from chunk 50 as if it is a single continuous speech stream.
- Ending Instruction: Meticulously explain the second half of the textbook material provided below. Once you complete the material, wrap up the entire session in your final chunks with a highly supportive, casual sign-off wishing them happy study time. 
- Output ONLY a valid JSON object matching this schema, with no markdown formatting wrappers around the JSON:
{
  "chunks": [
    "Chunk 51 text (2 complete sentences, written in Amharic script with English terms blended, including [print] tags)...",
    "Chunk 52 text (2 complete sentences, written in Amharic script with English terms blended, including [print] tags)..."
  ]
}

Here are around 50 chunks generated from the first batch for your direct continuity and contextual reference. Start your first new chunk so that it directly continues from the last sentence of Chunk:
${JSON.stringify(existingChunks, null, 2)}

Source Material (Second Half of Chapter):
${rawText}`;
            }

            // 4. Execution of the batch generation
            const geminiData = await callGeminiWithRetry({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { 
                    responseMimeType: "application/json",
                    maxOutputTokens: 8192
                }
            }, getGeminiKey);
            
            let resultJson = { chunks: [] };
            try {
                const rawOutput = geminiData.candidates[0].content.parts[0].text;
                resultJson = JSON.parse(rawOutput);
            } catch (e) {
                throw new Error("Failed to parse JSON chunks from Gemini.");
            }

            let finalChunks = [];
            let nextState = 'idle';

            if (state === 'idle') {
                finalChunks = resultJson.chunks;
                nextState = 'batch_1_complete';
            } else {
                finalChunks = [...(session.lecture_chunks || []), ...resultJson.chunks];
                nextState = 'completed';
            }

            // 5. Update Database state
            const { error: updateErr } = await supabase.from('live_study_sessions')
                .update({
                    lecture_chunks: finalChunks,
                    raw_source_text: rawText,
                    generation_state: nextState,
                    last_updated_at: new Date().toISOString()
                })
                .eq('conversation_id', conversation_id);

            if (updateErr) throw updateErr;

            return new Response(JSON.stringify({ 
                chunks: finalChunks, 
                finished: nextState === 'completed' 
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        
        if (action === "compile_answers") {
            const { conversation_id, questions } = body;
            
            // 1. Fetch Session State for Stateless Stitching
            const { data: session, error: sessErr } = await supabase.from('live_study_sessions')
                .select('lecture_chunks, raw_source_text')
                .eq('conversation_id', conversation_id)
                .single();
                
            if (sessErr || !session) throw new Error("Active session not found.");
            
            const contents = [
                {
                    role: "user",
                    parts: [{ text: `${MIRON_CORE_PROMPT_BASE}\n\nSource Material:\n${session.raw_source_text}` }]
                },
                {
                    role: "model",
                    parts: [{ text: JSON.stringify({ chunks: session.lecture_chunks }) }]
                },
                {
                    role: "user",
                    parts: [{ text: `Active attendants have just asked the following questions while you were reading:
${questions.map((q: any) => `- [${q.user_id}] ${q.sender_name}: ${q.text}`).join('\n')}

Task: Answer these questions sequentially. 
- Maintain the EXACT same informal, conversational Ethio-English peer tone as your lecture.
- Address each student warmly by their name (e.g., 'Sileshi, ...', 'Alex, ...'). Humans love to be called out!
- Keep each answer to 2-4 flowing sentences.
- If any question is highly offensive, sexual, or malicious, ignore it completely and flag the user in the 'flags' array.

Return ONLY a JSON object matching this exact schema, with no markdown wrappers:
{
  "answers": [ { "user_id": "...", "sender_name": "...", "answer_text": "..." } ],
  "flags": [ { "user_id": "...", "sender_name": "...", "severity": "mute|ban", "reason": "..." } ]
}` }]
                }
            ];

            // callGeminiWithRetry execution
            const geminiData = await callGeminiWithRetry({
                contents,
                generationConfig: { responseMimeType: "application/json" }
            }, getGeminiKey);
            
            let resultJson = { answers: [], flags: [] };
            try {
                const rawOutput = geminiData.candidates[0].content.parts[0].text;
                resultJson = JSON.parse(rawOutput);
                console.log(`[Miron Lecture Generator] Successfully compiled ${resultJson.answers?.length || 0} answers for conversation ID: ${conversation_id}`);
            } catch (e) {
                throw new Error("Failed to parse JSON answers from Gemini.");
            }

            // Save compiled answers directly back into the live_study_sessions table
            const { error: dbErr } = await supabase.from('live_study_sessions')
                .update({ compiled_answers: resultJson.answers })
                .eq('conversation_id', conversation_id);
                
            if (dbErr) {
                console.error(`[Miron Lecture Generator] Failed to save compiled answers to database for conversation ${conversation_id}:`, dbErr.message);
            } else {
                console.log(`[Miron Lecture Generator] Successfully saved compiled answers to database for conversation ${conversation_id}`);
            }

            return new Response(JSON.stringify(resultJson), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        throw new Error("Invalid action.");
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
    }
});