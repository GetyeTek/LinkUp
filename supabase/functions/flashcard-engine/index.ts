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
  caption?: string;
  items?: string[];
  premises?: string[];
  conclusion?: string;
  question?: string;
  rows?: any[];
  entries?: any[];
}

const formatError = (err: unknown): string => {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const anyErr = err as Record<string, any>;
    return anyErr.message || anyErr.error || anyErr.details || anyErr.hint || JSON.stringify(err);
  }
  return String(err);
};

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
    if (b.caption) parts.push(b.caption);
    if (Array.isArray(b.items)) parts.push(b.items.join(" "));
    if (Array.isArray(b.premises)) parts.push(b.premises.join(" "));
    if (b.conclusion) parts.push(b.conclusion);
    if (b.question) parts.push(b.question);

    // Extract table rows cleanly for LLM synthesis
    if (Array.isArray(b.rows)) {
      b.rows.forEach(r => {
        if (Array.isArray(r)) {
          parts.push(r.map(cell => typeof cell === "object" ? (cell?.text || "") : cell).filter(Boolean).join(" | "));
        }
      });
    }

    // Extract key-value dictionaries
    if (Array.isArray(b.entries)) {
      b.entries.forEach(e => {
        if (typeof e === "object" && e) {
          parts.push(`${e.label || ""}: ${e.value || e.text || ""}`);
        }
      });
    }

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

  const auditLogs: string[] = [];
  const log = (stage: string, message: string, meta?: any) => {
    const timestamp = new Date().toISOString().substring(11, 23);
    const formatted = meta !== undefined
      ? `[${timestamp}][${stage}] ${message} -> ${typeof meta === "object" ? JSON.stringify(meta) : meta}`
      : `[${timestamp}][${stage}] ${message}`;
    console.log(formatted);
    auditLogs.push(formatted);
  };

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "cron_next_section";
    log("Init", `Request accepted. Pipeline Action: "${action}"`, { origin: req.headers.get("origin") || "direct" });

    // 1. Lease active Gemini key from DB pool
    log("KeyLease", "Requesting active Gemini API key from database pool via RPC...");
    const { data: keyData, error: keyErr } = await supabase.rpc("lease_gemini_api_key");
    if (keyErr || !keyData || !keyData[0]?.api_key) {
      log("KeyLease:Error", "Key lease failed!", { error: formatError(keyErr) });
      throw new Error(`API Key Pool Error: ${keyErr?.message || "No active keys available"}`);
    }

    const apiKey = keyData[0].api_key;
    const maskedKey = `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}`;
    const model = "gemini-2.5-flash";
    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    log("KeyLease:Success", `Leased key ID: ${keyData[0].id} (${maskedKey}). Model targeted: "${model}"`);

    // =========================================================================
    // PIPELINE 1: BATCH MISTAKE VAULT SYNTHESIZER
    // =========================================================================
    if (action === "batch_mistakes") {
      const userId = body.user_id;
      const batchLimit = body.limit || 8;

      if (!userId) {
        log("BatchMistakes:Error", "Rejected: Missing user_id parameter in payload.");
        return new Response(JSON.stringify({ error: "Missing user_id parameter", audit_logs: auditLogs }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      log("BatchMistakes:Query", `Fetching un-synthesized mistake questions for user ${userId} (limit: ${batchLimit})...`);
      const { data: rawBatch, error: batchErr } = await supabase.rpc("get_pending_mistake_batch", {
        p_user_id: userId,
        p_limit: batchLimit
      });

      if (batchErr) {
        log("BatchMistakes:Error", "RPC failed", { error: formatError(batchErr) });
        throw new Error(`[batch_mistakes] ${formatError(batchErr)}`);
      }

      if (!rawBatch || rawBatch.length === 0) {
        log("BatchMistakes:Done", "Zero pending mistake questions found. Queue clean.");
        return new Response(JSON.stringify({ 
          success: true, 
          message: "No pending mistake questions to process", 
          processed: 0,
          audit_logs: auditLogs
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      log("BatchMistakes:Synthesis", `Found ${rawBatch.length} questions to synthesize into active-recall probes. Dispatching to Gemini...`);

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

      const tStartGemini = Date.now();
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

      const geminiLatency = Date.now() - tStartGemini;
      log("BatchMistakes:GeminiResponse", `Gemini returned HTTP ${geminiRes.status} in ${geminiLatency}ms`);

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        if (geminiRes.status === 429) {
          log("BatchMistakes:Cooldown", `Key rate-limited. Putting key ${maskedKey} on cooldown.`);
          await supabase.rpc("cooldown_gemini_key", { expired_key: apiKey });
        }
        throw new Error(`Gemini API Error ${geminiRes.status}: ${errText}`);
      }

      const geminiJson = await geminiRes.json();
      const rawOutput = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
      const cards = JSON.parse(rawOutput);
      log("BatchMistakes:CardsParsed", `Received ${cards.length} synthesized cards from LLM.`);

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

        if (insertErr) {
          log("BatchMistakes:InsertError", "Failed to insert mistake flashcards", { error: formatError(insertErr) });
          throw insertErr;
        }

        log("BatchMistakes:Committed", `Committed ${rowsToInsert.length} mistake flashcards to user_mistake_flashcards.`);

        return new Response(JSON.stringify({ 
          success: true, 
          questions_evaluated: rawBatch.length, 
          cards_created: rowsToInsert.length,
          audit_logs: auditLogs
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ 
        success: true, 
        questions_evaluated: rawBatch.length, 
        cards_created: 0,
        note: "All questions in batch were calculations or excluded",
        audit_logs: auditLogs
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
    let targetCardCount = 10;

    // 1. Acquire atomic job with SKIP LOCKED if running in automated cron mode
    if (!targetBookId || !targetSection) {
      log("JobAcquisition", "No manual book/section passed. Calling RPC acquire_next_flashcard_job (SKIP LOCKED)...");
      const { data: jobData, error: jobErr } = await supabase.rpc("acquire_next_flashcard_job");
      if (jobErr) {
        log("JobAcquisition:Error", "acquire_next_flashcard_job failed", { error: formatError(jobErr) });
        throw new Error(`[acquire_next_flashcard_job] ${formatError(jobErr)}`);
      }

      if (!jobData || jobData.length === 0) {
        log("JobAcquisition:Empty", "RPC returned 0 jobs. All textbook sections are up-to-date.");
        return new Response(JSON.stringify({ 
          success: true, 
          message: "All textbook sections have been processed. Queue is empty!", 
          pending: false,
          audit_logs: auditLogs
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
      
      const pageSpan = Math.max(1, (endPage || startPage) - startPage + 1);
      targetCardCount = currentJob.target_cards || Math.max(4, Math.min(25, pageSpan * 3));

      log("JobAcquisition:Success", `Acquired Job ID: ${activeJobId}`, {
        book: currentJob.book_title,
        course_code: targetCourseCode,
        chapter: targetChapter,
        section: targetSection,
        start_page: startPage,
        end_page: endPage,
        span: pageSpan,
        target_card_count: targetCardCount
      });
    } else {
      const pageSpan = Math.max(1, (endPage || startPage) - startPage + 1);
      targetCardCount = Math.max(4, Math.min(25, pageSpan * 3));
      log("JobAcquisition:Manual", `Manual parameters provided: "${targetSection}" (Pages ${startPage} to ${endPage}) in book ${targetBookId}. Target Cards: ${targetCardCount}`);
    }

    try {
      const pageSpan = Math.max(1, (endPage || startPage) - startPage + 1);
      
      // 2. Read full section page range (with duplicate Page 1 scan-ahead resolution)
      let pages: { page_number: number; content_json: any }[] = [];

      log("Page1Analysis", `Inspecting book ${targetBookId} for duplicate Page 1 anomalies...`);
      const { data: pageOneRecords, error: p1Err } = await supabase
        .from("book_pages")
        .select("id")
        .eq("book_id", targetBookId)
        .eq("page_number", 1);

      if (p1Err) {
        log("Page1Analysis:Error", "Failed to query page_number = 1", { error: formatError(p1Err) });
        throw new Error(`[pageOneCheck] ${formatError(p1Err)}`);
      }

      const p1Count = pageOneRecords?.length || 0;
      log("Page1Analysis:Result", `Found ${p1Count} record(s) with page_number = 1.`);

      if (p1Count > 1) {
        log("SequenceDisambiguation", `MULTIPLE PAGE 1s DETECTED (${p1Count}). Engaging scan-ahead sequence analyzer...`);

        const { data: allBookPages, error: allPagesErr } = await supabase
          .from("book_pages")
          .select("id, page_number, page_key, created_at")
          .eq("book_id", targetBookId)
          .order("created_at", { ascending: true });

        if (allPagesErr) throw new Error(`[allPagesQuery] ${formatError(allPagesErr)}`);
        log("SequenceDisambiguation:IndexLoaded", `Loaded index of ${allBookPages?.length || 0} total physical pages for sequence tracing.`);

        // Strategy A: Group by page_key prefix (e.g. "preface-" vs "page-")
        const prefixGroups = new Map<string, typeof allBookPages>();
        for (const p of allBookPages || []) {
          const prefix = (p.page_key || "").replace(/\d+.*$/, "") || "main";
          if (!prefixGroups.has(prefix)) prefixGroups.set(prefix, []);
          prefixGroups.get(prefix)!.push(p);
        }

        const prefixSummary: Record<string, number> = {};
        for (const [k, v] of prefixGroups.entries()) {
          prefixSummary[k] = v.length;
        }
        log("SequenceDisambiguation:Prefixes", "Detected key-family groups:", prefixSummary);

        const candidateChains: Array<{
          source: string;
          maxPage: number;
          pageCount: number;
          pageMap: Map<number, string>;
        }> = [];

        // Evaluate each prefix group
        for (const [prefixName, groupPages] of prefixGroups.entries()) {
          const sortedGroup = [...groupPages].sort((a, b) => a.page_number - b.page_number);
          if (sortedGroup.length > 0 && sortedGroup[0].page_number === 1) {
            const pMap = new Map<number, string>();
            let maxP = 1;
            let lastP = 0;

            for (const item of sortedGroup) {
              if (lastP === 0 || (item.page_number > lastP && item.page_number <= lastP + 5)) {
                pMap.set(item.page_number, item.id);
                lastP = item.page_number;
                if (item.page_number > maxP) maxP = item.page_number;
              }
            }

            candidateChains.push({
              source: `Prefix "${prefixName}"`,
              maxPage: maxP,
              pageCount: pMap.size,
              pageMap: pMap
            });
            log("SequenceDisambiguation:Candidate", `Evaluated candidate chain from prefix "${prefixName}"`, {
              starting_page: 1,
              max_page_reached: maxP,
              sequential_pages_count: pMap.size
            });
          }
        }

        // Strategy B: If all page_keys shared identical prefixes, scan by insertion/chronological chains
        if (candidateChains.length <= 1 && allBookPages && allBookPages.length > 0) {
          log("SequenceDisambiguation:Fallback", "Prefixes identical or singular. Scanning chronological insertion runs...");
          for (let i = 0; i < allBookPages.length; i++) {
            if (allBookPages[i].page_number === 1) {
              const pMap = new Map<number, string>();
              pMap.set(1, allBookPages[i].id);
              let lastNum = 1;
              let maxNum = 1;

              for (let j = i + 1; j < allBookPages.length; j++) {
                const cur = allBookPages[j].page_number;
                if (cur === 1 || cur < lastNum) break;
                if (cur > lastNum && cur <= lastNum + 5) {
                  pMap.set(cur, allBookPages[j].id);
                  lastNum = cur;
                  if (cur > maxNum) maxNum = cur;
                }
              }

              candidateChains.push({
                source: `Chronological Chain at Index ${i}`,
                maxPage: maxNum,
                pageCount: pMap.size,
                pageMap: pMap
              });
              log("SequenceDisambiguation:Candidate", `Evaluated chronological run from Index ${i}`, {
                max_page_reached: maxNum,
                sequential_pages_count: pMap.size
              });
            }
          }
        }

        // Rank candidates: highest maxPage reached, followed by longest continuous sequence
        candidateChains.sort((a, b) => {
          if (b.maxPage !== a.maxPage) return b.maxPage - a.maxPage;
          return b.pageCount - a.pageCount;
        });

        const winningChain = candidateChains[0];
        log("SequenceDisambiguation:Decision", `Crowned winning sequence: ${winningChain?.source}`, {
          max_page_reached: winningChain?.maxPage,
          total_pages_in_chain: winningChain?.pageCount
        });

        const targetIds: string[] = [];
        if (winningChain) {
          for (const [pNum, pId] of winningChain.pageMap.entries()) {
            if (pNum >= startPage && (!endPage || pNum <= endPage)) {
              targetIds.push(pId);
            }
          }
        }

        log("RangeResolution", `Mapped requested range [${startPage}..${endPage || startPage}] against winning sequence. Matched ${targetIds.length} unique page UUID(s).`);

        if (targetIds.length > 0) {
          const { data: resolvedPages, error: resolvedErr } = await supabase
            .from("book_pages")
            .select("page_number, content_json")
            .in("id", targetIds)
            .order("page_number", { ascending: true });

          if (resolvedErr) throw new Error(`[resolvedPages] ${formatError(resolvedErr)}`);
          pages = resolvedPages || [];
        }
      } else {
        // Fast path for books with single continuous sequence
        log("PageQuery:FastPath", `Single continuous sequence confirmed. Querying pages >= ${startPage} and <= ${endPage || "end"}...`);
        let pageQuery = supabase
          .from("book_pages")
          .select("page_number, content_json")
          .eq("book_id", targetBookId)
          .gte("page_number", startPage);

        if (endPage) {
          pageQuery = pageQuery.lte("page_number", endPage);
        }

        const { data: queryPages, error: pageErr } = await pageQuery.order("page_number", { ascending: true });
        if (pageErr) throw new Error(`[pageQuery] ${formatError(pageErr)}`);
        pages = queryPages || [];
      }

      log("PageQuery:Complete", `Loaded ${pages.length} page payload(s) from database.`, {
        page_numbers: pages.map(p => p.page_number)
      });

      // 3. Extract Block Text
      const sectionText = (pages || []).map(p => {
        return `--- PAGE ${p.page_number} ---\n` + extractTextFromBlocks(p.content_json || []);
      }).join("\n\n");

      log("ContentExtraction", `Extracted text from ${pages.length} pages. Total text length: ${sectionText.length} characters.`);

      if (!sectionText.trim()) {
        log("ContentExtraction:Skip", "Page content is completely empty. Marking job as skipped.");
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
          reason: "Empty page content",
          audit_logs: auditLogs
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Log preview of the text being sent to LLM
      const sampleText = sectionText.substring(0, 180).replace(/\n/g, " ");
      log("ContentPreview", `Sample text for prompt: "${sampleText}..."`);

      // 4. Prompt Gemini for High-Yield Flashcards
      const prompt = `You are Miron, an elite academic curriculum tutor for university students in Ethiopia.
Your mission is to generate EXACTLY ${targetCardCount} high-yield, razor-sharp active-recall flashcards from this textbook subsection.

TARGET QUANTITY (MANDATORY):
Generate EXACTLY ${targetCardCount} unique, distinct flashcards. Do not generate fewer. Do not generate repetitive rewordings.

SUBSECTION CONTEXT:
Course: ${targetCourseCode}
Chapter: ${targetChapter}
Hierarchy / Topic: ${targetSection}
Page Range: ${startPage} to ${endPage || startPage} (${pageSpan} page${pageSpan > 1 ? 's' : ''})

SURGICAL FLASHCARD RULES:
1. SHORT, PRECISE & SURGICAL:
   - "front" (The Probe): Maximum 15 words. Direct, punchy, and clear. Zero conversational filler or essay-style preambles.
     * GOOD: "What is a proposition in symbolic logic?"
     * GOOD: "Which sentence types cannot be truth-valued propositions?"
     * BAD: "Can you explain in detail the various characteristics that define a proposition according to..."
   - "back" (The Strike): Maximum 2 sentences. Deliver the exact, accurate conceptual answer immediately. Wrap key technical terms, laws, and definitions in <strong> tags.
     * GOOD: "A declarative statement that is either <strong>true</strong> or <strong>false</strong>, but not both."
     * BAD: "As discussed in the chapter above, when we look at logic, a proposition is considered to be..."
2. 100% CONCEPTUAL MASTERY: Focus on core definitions, foundational laws, governing formulas, and contrasting distinctions. Cover tables, summarized rules, and bolded terms.
3. NO HEAVY ARITHMETIC: Exclude multi-step scratchpad calculations or long algebra.
4. VALID JSON ARRAY: You MUST return a JSON array containing EXACTLY ${targetCardCount} items:
[
  {
    "front": "Short surgical prompt (<= 15 words)",
    "back": "Direct accurate answer (<= 2 sentences). Key terms in <strong>tags</strong>.",
    "ref_page": ${startPage}
  },
  {
    "front": "Second distinct surgical prompt",
    "back": "Second concise answer with <strong>key terms</strong>.",
    "ref_page": ${startPage}
  }
]

SECTION CONTENT:
${sectionText}`;

      log("GeminiSynthesis:Dispatch", `Dispatching prompt to Gemini (${prompt.length} bytes). Target: ${targetCardCount} cards...`);

      const tStartGemini = Date.now();
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

      const geminiLatency = Date.now() - tStartGemini;
      log("GeminiSynthesis:Response", `Gemini responded with HTTP ${geminiRes.status} in ${geminiLatency}ms.`);

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        if (geminiRes.status === 429) {
          log("GeminiSynthesis:Cooldown", `Rate-limited! Cooldown triggered on key ${maskedKey}`);
          await supabase.rpc("cooldown_gemini_key", { expired_key: apiKey });
        }
        throw new Error(`Gemini API Error ${geminiRes.status}: ${errText}`);
      }

      const geminiJson = await geminiRes.json();
      const rawOutput = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
      const cards = JSON.parse(rawOutput);

      log("GeminiSynthesis:Parsed", `Successfully parsed JSON response containing ${cards?.length || 0} cards.`);

      if (Array.isArray(cards) && cards.length > 0) {
        log("SampleCard1", `[Front]: ${cards[0]?.front} | [Back]: ${cards[0]?.back}`);
        if (cards[1]) {
          log("SampleCard2", `[Front]: ${cards[1]?.front} | [Back]: ${cards[1]?.back}`);
        }

        const rowsToInsert = cards.map(c => ({
          book_id: targetBookId,
          course_code: targetCourseCode,
          chapter_title: targetChapter,
          section_title: targetSection,
          front: c.front,
          back: c.back,
          ref_page: c.ref_page || startPage
        }));

        log("DbCommit:Insert", `Inserting ${rowsToInsert.length} flashcard record(s) into course_flashcards...`);
        const { error: insertErr } = await supabase
          .from("course_flashcards")
          .insert(rowsToInsert);

        if (insertErr) {
          log("DbCommit:Error", "Insertion to course_flashcards failed", { error: formatError(insertErr) });
          throw insertErr;
        }
        log("DbCommit:Success", `Committed ${rowsToInsert.length} flashcards to course_flashcards.`);

        if (activeJobId) {
          log("DbCommit:JobComplete", `Updating job ${activeJobId} in book_flashcard_progress to status 'completed'...`);
          await supabase.rpc("complete_flashcard_job", {
            p_job_id: activeJobId,
            p_cards_count: rowsToInsert.length,
            p_status: "completed"
          });
          log("DbCommit:JobComplete:Success", `Job ${activeJobId} marked 'completed'.`);
        }

        return new Response(JSON.stringify({ 
          success: true, 
          section: targetSection, 
          status: "completed", 
          cards_generated: rowsToInsert.length,
          audit_logs: auditLogs
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // If section returned 0 cards
      log("GeminiSynthesis:ZeroCards", "LLM returned zero cards for this section. Marking skipped.");
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
        cards_generated: 0,
        audit_logs: auditLogs
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (processErr: unknown) {
      const errMsg = processErr instanceof Error ? processErr.message : String(processErr);
      log("ExecutionError", `Processing section failed: ${errMsg}`);
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
    const message = formatError(err);
    log("FatalError", message);
    return new Response(JSON.stringify({ error: message, audit_logs: auditLogs }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});