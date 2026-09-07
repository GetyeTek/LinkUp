import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface BlockItem {
  main?: string;
  sub?: string;
  title?: string;
  body?: string;
  text?: string;
  items?: string[];
  premises?: string[];
  conclusion?: string;
  question?: string;
}

const extractTextFromBlocks = (blocks: BlockItem[]): string => {
  if (!Array.isArray(blocks)) return "";
  return blocks.map(b => {
    if (!b) return "";
    const parts: string[] = [];
    if (b.title) parts.push(b.title);
    if (b.main) parts.push(b.main);
    if (b.sub) parts.push(b.sub);
    if (b.body) parts.push(b.body);
    if (b.text) parts.push(b.text);
    if (Array.isArray(b.items)) parts.push(b.items.join(" "));
    if (Array.isArray(b.premises)) parts.push(b.premises.join(" "));
    if (b.conclusion) parts.push(b.conclusion);
    if (b.question) parts.push(b.question);
    return parts.join(" ").replace(/<[^>]+>/g, "").trim();
  }).filter(Boolean).join("\n");
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "cron_next_section";

    // 1. Lease active Gemini key from DB pool
    const { data: keyData, error: keyErr } = await supabase.rpc("lease_gemini_api_key");
    if (keyErr || !keyData || !keyData[0]?.api_key) {
      throw new Error(`API Key Pool Error: ${keyErr?.message || "No active keys available"}`);
    }

    const apiKey = keyData[0].api_key;
    const model = "gemini-2.5-flash";
    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // =========================================================================
    // PIPELINE 1: BATCH MISTAKE VAULT SYNTHESIZER
    // =========================================================================
    if (action === "batch_mistakes") {
      const userId = body.user_id;
      const batchLimit = body.limit || 8;

      if (!userId) {
        return new Response(JSON.stringify({ error: "Missing user_id parameter" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Fetch pending un-synthesized questions via helper RPC
      const { data: rawBatch, error: batchErr } = await supabase.rpc("get_pending_mistake_batch", {
        p_user_id: userId,
        p_limit: batchLimit
      });

      if (batchErr) throw batchErr;

      if (!rawBatch || rawBatch.length === 0) {
        return new Response(JSON.stringify({ 
          success: true, 
          message: "No pending mistake questions to process", 
          processed: 0 
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const prompt = `You are Miron, a high-yield university academic tutor. Below is a batch of questions that a student answered incorrectly on exams or book checkpoints.

Synthesize these questions into active-recall flashcards for rapid revision.

CRITICAL INSTRUCTIONS:
1. EXCLUDE CALCULATIONS & MULTI-STEP WORKOUTS: If a question requires scratchpad numerical arithmetic, algebraic derivations, or lengthy math steps, SKIP IT (do not include it in the output array). Flashcards are strictly for fast retrieval of facts, definitions, core laws, and concepts.
2. NO MULTIPLE-CHOICE FORMAT: Reframe questions into direct conceptual probes. Do NOT provide options A, B, C, D.
   - Example Raw: "Which is not scalar? (A) Mass (B) Temp (C) Velocity"
   - Good Front: "Is velocity a scalar or a vector quantity, and why?"
   - Good Back: "Vector quantity. It has both magnitude (speed) and a defined direction."
3. COMPACT BACK: Keep the answer concise (2 to 4 sentences). Bold key terms with <strong>.
4. Return ONLY a valid JSON array of objects with the exact schema:
[
  {
    "source_question_id": "UUID from input",
    "course_code": "Course Code from input",
    "front": "Direct conceptual prompt",
    "back": "Clear concise explanation",
    "reference_info": "Brief source topic"
  }
]

INPUT QUESTIONS:
${JSON.stringify(rawBatch, null, 2)}`;

      const geminiRes = await fetch(geminiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      });

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        if (geminiRes.status === 429) {
          await supabase.rpc("cooldown_gemini_key", { expired_key: apiKey });
        }
        throw new Error(`Gemini API Error ${geminiRes.status}: ${errText}`);
      }

      const geminiJson = await geminiRes.json();
      const rawOutput = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
      const cards = JSON.parse(rawOutput);

      if (Array.isArray(cards) && cards.length > 0) {
        const rowsToInsert = cards.map(c => ({
          user_id: userId,
          source_question_id: c.source_question_id || null,
          course_code: c.course_code || "General",
          front: c.front,
          back: c.back,
          reference_info: c.reference_info || "Mistake Vault"
        }));

        const { error: insertErr } = await supabase
          .from("user_mistake_flashcards")
          .insert(rowsToInsert);

        if (insertErr) throw insertErr;

        return new Response(JSON.stringify({ 
          success: true, 
          questions_evaluated: rawBatch.length, 
          cards_created: rowsToInsert.length 
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ 
        success: true, 
        questions_evaluated: rawBatch.length, 
        cards_created: 0,
        note: "All questions in batch were calculations or excluded" 
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // =========================================================================
    // PIPELINE 2: TEXTBOOK SECTION INGESTION (ATOMIC LEASE-BACKED PROGRESS)
    // =========================================================================
    let activeJobId: string | null = null;
    let targetBookId = body.book_id;
    let targetCourseCode = body.course_code;
    let targetChapter = body.chapter_title;
    let targetSection = body.section_title;
    let startPage = body.start_page;
    let endPage = body.end_page;

    // 1. Acquire atomic job with SKIP LOCKED if running in automated cron mode
    if (!targetBookId || !targetSection) {
      const { data: jobData, error: jobErr } = await supabase.rpc("acquire_next_flashcard_job");
      if (jobErr) throw jobErr;

      if (!jobData || jobData.length === 0) {
        return new Response(JSON.stringify({ 
          success: true, 
          message: "All textbook sections have been processed. Queue is empty!", 
          pending: false 
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const currentJob = jobData[0];
      activeJobId = currentJob.job_id;
      targetBookId = currentJob.book_id;
      targetCourseCode = currentJob.course_code;
      targetChapter = currentJob.chapter_title;
      targetSection = currentJob.section_title;
      startPage = currentJob.start_page;
      endPage = currentJob.end_page;
    }

    try {
      // 2. Read full section page range
      let pageQuery = supabase
        .from("book_pages")
        .select("page_number, content_json")
        .eq("book_id", targetBookId)
        .gte("page_number", startPage);

      if (endPage) {
        pageQuery = pageQuery.lte("page_number", endPage);
      }

      const { data: pages, error: pageErr } = await pageQuery.order("page_number", { ascending: true });
      if (pageErr) throw pageErr;

      const sectionText = (pages || []).map(p => {
        return `--- PAGE ${p.page_number} ---\n` + extractTextFromBlocks(p.content_json || []);
      }).join("\n\n");

      if (!sectionText.trim()) {
        if (activeJobId) {
          await supabase.rpc("complete_flashcard_job", {
            p_job_id: activeJobId,
            p_cards_count: 0,
            p_status: "skipped",
            p_error: "No readable content extracted from pages"
          });
        }
        return new Response(JSON.stringify({ 
          success: true, 
          section: targetSection, 
          status: "skipped", 
          reason: "Empty page content" 
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 3. Prompt Gemini for High-Yield Flashcards
      const prompt = `You are Miron, a curriculum editor for university freshman courses in Ethiopia.
Extract high-yield conceptual flashcards covering all key concepts from the following textbook section.

SECTION CONTEXT:
Course: ${targetCourseCode}
Chapter: ${targetChapter}
Section: ${targetSection}

EXTRACTION RULES:
1. HIGH-YIELD ONLY: Extract fundamental definitions, laws, principles, core formulas, and key distinctions across the entire section.
2. EXCLUDE HEAVY CALCULATIONS: Do NOT create workout math questions with numerical arithmetic. Focus on concepts.
3. CLEAR FORMATTING: 
   - "front": Direct recall question or concept definition prompt.
   - "back": Concise, accurate answer. Use <strong> for key terms.
4. Output schema MUST be a valid JSON array:
[
  {
    "front": "Prompt text",
    "back": "Answer text",
    "ref_page": ${startPage}
  }
]

SECTION CONTENT:
${sectionText}`;

      const geminiRes = await fetch(geminiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      });

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        if (geminiRes.status === 429) {
          await supabase.rpc("cooldown_gemini_key", { expired_key: apiKey });
        }
        throw new Error(`Gemini API Error ${geminiRes.status}: ${errText}`);
      }

      const geminiJson = await geminiRes.json();
      const rawOutput = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
      const cards = JSON.parse(rawOutput);

      if (Array.isArray(cards) && cards.length > 0) {
        const rowsToInsert = cards.map(c => ({
          book_id: targetBookId,
          course_code: targetCourseCode,
          chapter_title: targetChapter,
          section_title: targetSection,
          front: c.front,
          back: c.back,
          ref_page: c.ref_page || startPage
        }));

        const { error: insertErr } = await supabase
          .from("course_flashcards")
          .insert(rowsToInsert);

        if (insertErr) throw insertErr;

        if (activeJobId) {
          await supabase.rpc("complete_flashcard_job", {
            p_job_id: activeJobId,
            p_cards_count: rowsToInsert.length,
            p_status: "completed"
          });
        }

        return new Response(JSON.stringify({ 
          success: true, 
          section: targetSection, 
          status: "completed", 
          cards_generated: rowsToInsert.length 
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // If section is purely calculations or empty, mark skipped so cron moves forward
      if (activeJobId) {
        await supabase.rpc("complete_flashcard_job", {
          p_job_id: activeJobId,
          p_cards_count: 0,
          p_status: "skipped"
        });
      }

      return new Response(JSON.stringify({ 
        success: true, 
        section: targetSection, 
        status: "skipped", 
        cards_generated: 0 
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (processErr: unknown) {
      const errMsg = processErr instanceof Error ? processErr.message : String(processErr);
      if (activeJobId) {
        await supabase.rpc("complete_flashcard_job", {
          p_job_id: activeJobId,
          p_cards_count: 0,
          p_status: "failed",
          p_error: errMsg
        }).catch(() => {});
      }
      throw processErr;
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});