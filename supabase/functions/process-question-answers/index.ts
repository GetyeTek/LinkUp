import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// --- CONFIGURABLE BATCH CONSTANTS ---
const TARGET_BOOK_ID = "38953d3b-7740-4e97-9634-66434e53f024";
const CONCURRENCY_LANES = 5;
const BATCH_SIZE_PER_LANE = 10;
const TOTAL_FETCH_LIMIT = CONCURRENCY_LANES * BATCH_SIZE_PER_LANE; // 50
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview"; 

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

// Helper to cleanly format options to avoid nested JSON parsing issues for the LLM
function formatOptions(options: any): string {
    if (!options) return "None";
    if (Array.isArray(options)) {
        return options.map((opt, idx) => {
            const optText = typeof opt === 'object' ? (opt.text || JSON.stringify(opt)) : opt;
            return `[Index ${idx}]: ${optText}`;
        }).join('\n');
    }
    return JSON.stringify(options);
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

        // 3. Acquire locked questions from the progress queue
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

        // FIX: Join `sections` to include missing shared reading passages and instructions
        const { data: questionsData } = await supabase
            .from('questions')
            .select(`
                id, 
                question_type, 
                text, 
                options, 
                matching_data, 
                media,
                sections (
                    title,
                    instructions,
                    shared_context
                )
            `)
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

    } catch (err: any) {
        console.error(`[FATAL ERROR]`, err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
});

/**
 * Processes a chunk of questions simultaneously in ONE API call inside a concurrent lane.
 */
async function processLane(questions: any[], bookContext: string, supabase: any, laneIndex: number) {
    console.log(`[LANE ${laneIndex}] Started batch processing ${questions.length} questions in a single API call.`);
    
    try {
        // 1. Get a fresh API Key via Round-Robin RPC
        const { data: keyData, error: keyErr } = await supabase.rpc('lease_gemini_api_key');
        if (keyErr || !keyData || keyData.length === 0) throw new Error("Failed to lease Gemini API Key.");
        const apiKey = keyData[0].api_key;
        
        // 2. Build the Strict Batched Instruction Prompt
        const systemPrompt = `You are an elite academic AI processor. Your task is to evaluate a batch of academic questions based on the provided textbook material, determine the correct answers, and generate explanations.

CRITICAL RULES:
1. Base your answer on the textbook text provided. You MUST reference the specific PAGE NUMBER in your explanation.
2. If the textbook does not contain the answer, append this phrase: "Answer compiled via general knowledge (source not found in textbook)."
3. If a question is corrupted, missing required visual media/diagrams referenced in the text ("given below", "in the diagram"), or impossible to solve via text, set "is_invalid": true, specify the reason in "error_message", and set the rest to null.

STRICT FORMATTING BY QUESTION TYPE:

- "true_false": 
  correct_answer: A JSON boolean (true or false).

- "multiple_choice": 
  correct_answer: A JSON integer representing the 0-based index of the correct option.

- "reading_comprehension": 
  If "options" contains strings representing full sub-questions with embedded choices (e.g., "[Index 0]: 1. Q... A. opt1 B. opt2"), parse each string, find the correct choice, and map to an integer (A=0, B=1, C=2, D=3).
  correct_answer: A JSON array of these integers (one per sub-question).

- "short_answer": 
  correct_answer: null. 
  explanation: A comprehensive Markdown breakdown.

- "workout": 
  If it requires drawing chemical structures/diagrams that are impossible to type, set "is_invalid": true.
  correct_answer: null (if single question) or a JSON object mapping keys to answers if sub-options exist (e.g., {"A": "answer", "B": "answer"}).
  explanation: Detailed step-by-step markdown derivation.

- "fill_in_the_blank": 
  correct_answer: A JSON array of strings containing the exact correct word(s) for each blank space.

- "matching": 
  Ignore any pre-existing text prefixes (like "6.", "B.", "C."). Map strictly by the 0-based position index in the provided arrays. Unequal columns may exist.
  correct_answer: A JSON object mapping left column indices to right column indices (e.g., {"0": 5, "1": 2}).

OUTPUT FORMAT:
You MUST respond with a JSON array of objects, one for each question, in the EXACT order provided. Do not include markdown code block wrappers around the JSON.
[
  {
    "question_id": "string (UUID)",
    "is_invalid": boolean,
    "error_message": string | null,
    "correct_answer": any,
    "explanation": string | null
  }
]`;

        // 3. Format all questions into a single batch payload
        const formattedQuestionsList = questions.map((q, idx) => {
            const section = q.sections;
            const sectionContext = section ? `\n--- SECTION CONTEXT ---\nSection Title: ${section.title || 'None'}\nInstructions: ${section.instructions || 'None'}\nReading Passage / Context: ${typeof section.shared_context === 'object' ? JSON.stringify(section.shared_context) : (section.shared_context || 'None')}` : '';
            
            const mediaContext = q.media ? `\nMedia Attached: ${JSON.stringify(q.media)}` : '';

            return `--- QUESTION ${idx + 1} ---
ID: ${q.id}
Type: ${q.question_type}
Text: ${q.text}${sectionContext}${mediaContext}
Options:
${formatOptions(q.options)}
Matching Data:
${q.matching_data ? JSON.stringify(q.matching_data, null, 2) : "None"}
`;
        }).join('\n\n');

        const userPrompt = `TEXTBOOK CONTEXT:
${bookContext}

---
LIST OF QUESTIONS TO PROCESS:
${formattedQuestionsList}
`;

        // 4. Call Gemini ONCE for the entire batch
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
            })
        });

        if (!res.ok) {
            if (res.status === 429) {
                await supabase.rpc('set_key_cooldown_rpc', { key_id: keyData[0].id });
            }
            throw new Error(`Gemini API Error: ${res.status} - ${await res.text()}`);
        }

        const payload = await res.json();
        const rawResponse = payload.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawResponse) throw new Error("Empty response from Gemini.");

        // 5. Parse & Validate JSON Array Robustly
        let aiResults = [];
        try {
            // Strip any rogue markdown code blocks generated by the LLM
            const cleanedResponse = rawResponse.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
            aiResults = JSON.parse(cleanedResponse);
            if (!Array.isArray(aiResults)) throw new Error("Parsed result is not an array");
        } catch (parseErr) {
             throw new Error(`JSON Parsing failed. Raw response snippet: ${rawResponse.substring(0, 100)}...`);
        }

        // 6. Process database updates individually for the completed lane
        for (const result of aiResults) {
            const originalQuestion = questions.find(q => q.id === result.question_id);
            if (!originalQuestion) {
                console.warn(`[LANE ${laneIndex}] AI returned unknown question ID: ${result.question_id}`);
                continue;
            }

            try {
                if (result.is_invalid) {
                    await supabase.from('question_processing_progress')
                        .update({ status: 'invalid', error_message: result.error_message || "Marked invalid by AI." })
                        .eq('question_id', originalQuestion.id);
                    console.log(`[LANE ${laneIndex}] Question ${originalQuestion.id} marked INVALID.`);
                } else {
                    const { error: updateErr } = await supabase.from('questions')
                        .update({ 
                            correct_answer: result.correct_answer, 
                            explanation: result.explanation 
                        })
                        .eq('id', originalQuestion.id);
                        
                    if (updateErr) throw updateErr;

                    await supabase.from('question_processing_progress')
                        .update({ status: 'completed', error_message: null })
                        .eq('question_id', originalQuestion.id);
                        
                    console.log(`[LANE ${laneIndex}] Question ${originalQuestion.id} COMPLETED.`);
                }
            } catch (dbErr: any) {
                console.error(`[LANE ${laneIndex}] DB Update failed for ${originalQuestion.id}:`, dbErr.message);
            }
        }

    } catch (e: any) {
        console.error(`[LANE ${laneIndex}] Batch execution failed:`, e.message);
        // Fallback: If the whole batch fails, mark all questions in this lane as failed for queue resilience
        for (const q of questions) {
            await supabase.from('question_processing_progress')
                .update({ status: 'failed', error_message: `Batch failed: ${e.message}` })
                .eq('question_id', q.id);
        }
    }
}