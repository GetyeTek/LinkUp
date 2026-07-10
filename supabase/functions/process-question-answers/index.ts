import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// --- CONFIGURABLE BATCH CONSTANTS ---
const TARGET_BOOK_ID = "38953d3b-7740-4e97-9634-66434e53f024";
const CONCURRENCY_LANES = 5;
const BATCH_SIZE_PER_LANE = 10;
const TOTAL_FETCH_LIMIT = CONCURRENCY_LANES * BATCH_SIZE_PER_LANE; // 50
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview"; // Uses large context window

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper to flatten nested JSON blocks from the book
function extractTextFromBlocks(blocks: any[]) {
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
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );

        console.log(`[PROCESSOR] Starting batch job for Book: ${TARGET_BOOK_ID}`);

        // 1. Fetch Course Name
        const { data: bookData, error: bookErr } = await supabase
            .from('books')
            .select('title, course_code')
            .eq('id', TARGET_BOOK_ID)
            .single();
        if (bookErr || !bookData) throw new Error("Target book not found.");
        const courseName = `${bookData.course_code || ''} - ${bookData.title}`.trim();

        // 2. Fetch & Compile Entire Book Context (RAG Foundation)
        console.log(`[PROCESSOR] Compiling book pages into memory...`);
        const { data: pagesData } = await supabase
            .from('book_pages')
            .select('page_number, content_json')
            .eq('book_id', TARGET_BOOK_ID)
            .order('page_number', { ascending: true });

        let compiledBookContext = `COURSE MATERIAL: ${courseName}\n\n`;
        if (pagesData) {
            pagesData.forEach(p => {
                compiledBookContext += `\n--- PAGE ${p.page_number} ---\n`;
                compiledBookContext += extractTextFromBlocks(p.content_json || []) + '\n';
            });
        }

        // 3. Acquire 50 locked questions from the progress queue
        console.log(`[PROCESSOR] Acquiring up to ${TOTAL_FETCH_LIMIT} pending questions...`);
        const { data: acquiredJobs, error: acquireErr } = await supabase.rpc('acquire_question_answers_jobs', {
            p_book_id: TARGET_BOOK_ID,
            p_limit: TOTAL_FETCH_LIMIT
        });
        
        if (acquireErr) throw acquireErr;
        if (!acquiredJobs || acquiredJobs.length === 0) {
            return new Response(JSON.stringify({ message: "Queue is empty. No pending questions." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const acquiredIds = acquiredJobs.map((j: any) => j.q_id);
        console.log(`[PROCESSOR] Locked ${acquiredIds.length} questions. Fetching full question data...`);

        const { data: questionsData } = await supabase
            .from('questions')
            .select('id, question_type, text, options, matching_data')
            .in('id', acquiredIds);
            
        if (!questionsData) throw new Error("Failed to fetch questions payload.");

        // 4. Concurrency Lane Strategy
        console.log(`[PROCESSOR] Distributing into ${CONCURRENCY_LANES} concurrent lanes...`);
        const lanes = [];
        
        for (let i = 0; i < CONCURRENCY_LANES; i++) {
            const laneChunk = questionsData.slice(i * BATCH_SIZE_PER_LANE, (i + 1) * BATCH_SIZE_PER_LANE);
            if (laneChunk.length > 0) {
                lanes.push(processLane(laneChunk, compiledBookContext, supabase, i));
            }
        }

        await Promise.all(lanes);
        
        return new Response(JSON.stringify({ message: `Successfully processed batch of ${acquiredIds.length} questions.` }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (err) {
        console.error(`[FATAL ERROR]`, err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
});

/**
 * Processes a chunk of 10 questions sequentially inside a concurrent lane.
 */
async function processLane(questions: any[], bookContext: string, supabase: any, laneIndex: number) {
    console.log(`[LANE ${laneIndex}] Started processing ${questions.length} questions.`);
    
    for (const q of questions) {
        try {
            // 1. Get a fresh API Key via Round-Robin RPC
            const { data: keyData, error: keyErr } = await supabase.rpc('lease_gemini_api_key');
            if (keyErr || !keyData || keyData.length === 0) throw new Error("Failed to lease Gemini API Key. Rotation empty or cooled down.");
            const apiKey = keyData[0].api_key;
            
            // 2. Build the Strict Instruction Prompt
            const systemPrompt = `You are an elite academic AI processor. Your task is to evaluate an academic question based on the provided textbook material, determine the correct answer, and generate an explanation.

CRITICAL RULES:
1. Base your answer on the textbook text provided. You MUST reference the specific PAGE NUMBER in your explanation.
2. If the textbook does not contain the answer, you MUST use your general knowledge, but you MUST explicitly append this exact phrase to the end of your explanation: "Answer compiled via general knowledge (source not found in textbook)."
3. If the question is corrupted, incomplete, missing its options, or mathematically impossible, set "is_invalid": true, write the reason in "error_message", and set the rest to null.

STRICT FORMATTING BY QUESTION TYPE:

- "true_false": 
  correct_answer: A JSON boolean (true or false).
  explanation: Markdown text explaining why.

- "multiple_choice": 
  correct_answer: A JSON integer representing the 0-based index of the correct option.
  explanation: Markdown text explaining why this option is correct and why distractors are wrong.

- "reading_comprehension": 
  correct_answer: A JSON array of integers (0-based option indices) for each sub-question.
  explanation: A Markdown numbered list explaining the answer for each sub-question, quoting the text.

- "short_answer": 
  correct_answer: null. 
  explanation: A comprehensive Markdown grammatical or theoretical breakdown.

- "workout": 
  If it's a single question: correct_answer: null. explanation: Detailed step-by-step markdown derivation/equation.
  If it has sub-options (A, B, C): correct_answer: A JSON object defining the answer for each key. explanation: Detailed markdown breakdown resolving each sub-option separately.

- "fill_in_the_blank": 
  correct_answer: A JSON array of strings (one string key per blank space). If 1 blank, 1 string. If 2 blanks, 2 strings.
  explanation: A concise Markdown theoretical explanation for each blank.

- "matching": 
  correct_answer: A JSON object mapping the left column 0-based indices to the right column 0-based indices (e.g. {"0": 2, "1": 0}).
  explanation: Markdown text breaking down the matching pairs clearly.

OUTPUT FORMAT (Respond ONLY with valid JSON):
{
  "is_invalid": boolean,
  "error_message": string | null,
  "correct_answer": any,
  "explanation": string | null
}`;

            const userPrompt = `TEXTBOOK CONTEXT:
${bookContext}

---
QUESTION TO PROCESS:
Type: ${q.question_type}
Text: ${q.text}
Options: ${JSON.stringify(q.options || [])}
Matching Data: ${JSON.stringify(q.matching_data || {})}
`;

            // 3. Call Gemini
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                    generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
                })
            });

            if (!res.ok) {
                // If 429 Rate Limit, cooldown the key manually
                if (res.status === 429) {
                    await supabase.rpc('set_key_cooldown_rpc', { key_id: keyData[0].id });
                }
                throw new Error(`Gemini API Error: ${res.status} - ${await res.text()}`);
            }

            const payload = await res.json();
            const rawResponse = payload.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!rawResponse) throw new Error("Empty response from Gemini.");

            // 4. Parse & Validate JSON
            const aiData = JSON.parse(rawResponse);

            if (aiData.is_invalid) {
                // Log as invalid
                await supabase.from('question_processing_progress')
                    .update({ status: 'invalid', error_message: aiData.error_message || "Marked invalid by AI." })
                    .eq('question_id', q.id);
                console.log(`[LANE ${laneIndex}] Question ${q.id} marked INVALID.`);
            } else {
                // Update questions table
                const { error: updateErr } = await supabase.from('questions')
                    .update({ 
                        correct_answer: aiData.correct_answer, 
                        explanation: aiData.explanation 
                    })
                    .eq('id', q.id);
                    
                if (updateErr) throw updateErr;

                // Mark completed in queue
                await supabase.from('question_processing_progress')
                    .update({ status: 'completed', error_message: null })
                    .eq('question_id', q.id);
                    
                console.log(`[LANE ${laneIndex}] Question ${q.id} COMPLETED.`);
            }

        } catch (e) {
            console.error(`[LANE ${laneIndex}] Error processing question ${q.id}:`, e.message);
            // Mark as failed in queue
            await supabase.from('question_processing_progress')
                .update({ status: 'failed', error_message: e.message })
                .eq('question_id', q.id);
        }
    }
}