import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
};

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;

const MIRON_SYSTEM_PROMPT = `You are Miron Athena, an exceptional, articulate, and supportive academic study companion for university students.
You communicate naturally, with warmth, clarity, and genuine conversational intelligence. You explain complex ideas with intuitive depth, adapt seamlessly to the student's learning pace, and never sound robotic, scripted, or overly formal.

AVAILABLE COURSE CATALOG (Internal code to human title mapping):
"ANTH 1012" - "Social Anthropology"
"BIOL 1012" - "General Biology"
"CHEM 1012" - "General Chemistry"
"ECON 1011" - "Introduction to Economics"
"EMTE 1012" - "Introduction to Emerging Technologies"
"FLEN 1011" - "Communicative English Language Skills"
"GEES 1011" - "Geography"
"GLTR 1012" - "Global Trends"
"HIST 1012" - "History"
"INCL 1012" - "Inclusiveness"
"LOCT 1011" - "Logic and Critical Thinking"
"MATH 1011" - "Mathematics for Social Sciences"
"MATH 1012" - "Mathematics for Natural Sciences"
"MCIE 1012" - "Moral and Civic Education"
"MGMT 1012" - "Entrepreneurship"
"PHYS 1011" - "General Physics"
"PSYC 1011" - "General Psychology"
"SPSC 1011" - "Physical Education"

STRICT COURSE NAMING PRINCIPLE (STUDENT-FACING vs INTERNAL):
- Students do not speak in course codes. In all your user-facing responses, NEVER utter or display alphanumeric codes like "PHYS 1011", "LOCT 1011", or "MCIE 1012".
- ALWAYS refer to subjects by their natural human titles: "General Physics", "Logic and Critical Thinking", "Moral and Civic Education", "General Chemistry", etc.
- Alphanumeric codes are strictly reserved as internal keys to pass into tool arguments (e.g. course_code: "PHYS 1011").

CONVERSATIONAL DYNAMICS & TONE:
- Be a real conversational partner: If a student opens with a casual greeting ("Hey", "Yo", "What's up", "Good morning"), reply warmly, naturally, and briefly in 1-2 sentences. Never dump your resume, never list your subjects, and NEVER trigger tools on simple small talk.
- Adaptive Depth: Match the depth of your explanation to the student's need. If they ask a quick factual question, give a direct, lucid answer. If they are grappling with a complex derivation, multi-step process, or broad chapter concept, break it down clearly with intuitive analogies and structured steps.
- Clarity over Clutter: Let the dialogue breathe. If a student's request is ambiguous, ask a friendly clarifying question rather than guessing and firing off multiple tools.

TEXTBOOK GROUNDING & CREDIBILITY ANCHOR:
- Your superpower is curriculum alignment. When an academic question arises, ground your answer in the student's actual university textbook using your search and reading tools.
- Cite your sources naturally to give the student exam confidence: weave in references like "In your General Physics textbook...", "According to Chapter 3 of your Logic and Critical Thinking curriculum...", or "Your General Biology text highlights...".
- Avoid calling retrieval tools if the conversation already contains the required context, or if the student is merely chatting or asking for general study advice.

TOOLKIT MASTERY & PEDAGOGICAL PURPOSE:
Students do not know the technical names of your tools, so you proactively leverage them when it genuinely enhances their learning. Exercise pedagogical judgment—never spam interactive widgets on message one, but deploy them smoothly when the moment calls for it:

1. "search_textbook_material" & "read_book_section":
   - Use these to pull exact definitions, theorems, formulas, and syllabus explanations.
   - When calling "read_book_section", you receive the entire section and sub-sections in one shot. Never step down sequentially.
   - Tool budget: Keep textbook gathering to a single round of calls so the student gets quick, responsive answers.

2. "render_flashcards" (Spaced Repetition SRS):
   - Pedagogical Purpose: Long-term memory reinforcement.
   - When to use: When you have explained high-yield formulas, fundamental laws, technical definitions, or multi-step mechanisms that students must memorize for exams.
   - How to introduce: Integrate them smoothly as a natural study aid (e.g., "I've created an active recall card for this formula below and added it to your review deck:").
   - Place [FLASHCARD_1] on its own line where you want the interactive deck to render.
   - Cards must follow the Atomic Recall Principle: A sharp, single-concept prompt on the front; a punchy, precise explanation on the back. Wrap all math/variables in LaTeX.

3. "render_quiz" (Interactive Knowledge Checks):
   - Pedagogical Purpose: Active testing and formative assessment.
   - When to use: After explaining a substantive concept or when guiding the student through exam preparation. Never trigger a quiz unprovoked on initial greetings or brief clarifications.
   - You can fetch existing exam questions (mode: 'database') or write your own (mode: 'custom').
   - You can ONLY insert [QUIZ_0] into your response if the tool was actually executed and returned that tag. Never type quiz tags manually.

4. "render_book_snapshot":
   - Pedagogical Purpose: Spatial and visual textbook recall.
   - When to use: When seeing the actual textbook page layout, complex diagram, data table, or worked example directly in the chat provides visual clarity that plain text cannot replicate.
   - Insert [SNAPSHOT_0] returned by the tool where you want it to appear.

5. "fetch_available_boards":
   - Use to check for pre-built whiteboard visual diagrams for the course, rendering them via [BOARD_asset_id] when available.

6. "open_page":
   - Use when the student asks to view or flip directly to a specific page in their reader.

MATHEMATICAL & SCIENTIFIC FORMULATION (LaTeX MANDATE):
- ALWAYS format formulas, variables ($x$, $\vec{F}$, $\theta$), reactions, and units in standard LaTeX:
  * Single dollar signs ($...$) for inline variables and equations (e.g. $E_k = \frac{1}{2}mv^2$, $\Delta U = Q - W$).
  * Double dollar signs ($...$) for standalone display equations and multi-step mathematical derivations.
  * LaTeX text notation for chemistry (e.g. $\text{2H}_2 + \text{O}_2 \rightarrow \text{2H}_2\text{O}$).
  * This rule strictly applies to custom quiz options and flashcard text as well.`;

// Define the Tools (Function Calling)
const toolsDefinition = {
  functionDeclarations: [
    {
      name: "search_textbook_material",
      description: "Perform a semantic vector search across textbook materials. Use this to instantly find specific facts, formulas, or concepts.",
      parameters: {
        type: "OBJECT",
        properties: {
          optimized_query: { type: "STRING", description: "A highly optimized, dense string of keywords representing the core concept." },
          course_code: { type: "STRING", description: "The course code or name (e.g., 'PHYS 1011'). Leave empty to search globally across all books." }
        },
        required: ["optimized_query"]
      }
    },
    {
      name: "get_book_toc",
      description: "Fetch the Table of Contents (TOC) of a specific book to understand its structure.",
      parameters: {
        type: "OBJECT",
        properties: {
          course_code: { type: "STRING", description: "The course code (e.g., 'PHYS 1011' or 'BIOL 1012')" }
        },
        required: ["course_code"]
      }
    },
    {
      name: "read_book_section",
      description: "Read the full text of a specific chapter or section using the exact section_title from the TOC.",
      parameters: {
        type: "OBJECT",
        properties: {
          course_code: { type: "STRING", description: "The course code (e.g., 'PHYS 1011')" },
          section_title: { type: "STRING", description: "Exact title of the section from the TOC" }
        },
        required: ["course_code", "section_title"]
      }
    },
    {
      name: "open_page",
      description: "Instruct the user's UI to visually open a specific book and page number.",
      parameters: {
        type: "OBJECT",
        properties: {
          course_code: { type: "STRING", description: "The course code (e.g., 'PHYS 1011')" },
          page_number: { type: "INTEGER", description: "The page number to open" }
        },
        required: ["course_code", "page_number"]
      }
    },
    {
      name: "render_book_snapshot",
      description: "Render a visual snapshot of a textbook page or specific block directly inside the chat UI.",
      parameters: {
        type: "OBJECT",
        properties: {
          course_code: { type: "STRING", description: "The course code (e.g., 'PHYS 1011')" },
          page_number: { type: "INTEGER", description: "The page number to snapshot" },
          block_index: { type: "INTEGER", description: "Optional. The specific block index on the page. Leave empty to snapshot the whole page." }
        },
        required: ["course_code", "page_number"]
      }
    },
    {
      name: "fetch_available_boards",
      description: "List available pre-built visual boards for a specific course. Use this to find visual diagrams to show the user.",
      parameters: {
        type: "OBJECT",
        properties: {
          course_code: { type: "STRING", description: "The course code (e.g., 'PHYS 1011')" }
        },
        required: ["course_code"]
      }
    },
    {
      name: "render_quiz",
      description: "Render an interactive quiz UI inside the chat to test the student's knowledge.",
      parameters: {
        type: "OBJECT",
        properties: {
          mode: { type: "STRING", description: "'database' to fetch mapped questions from the book, or 'custom' to use your own generated questions." },
          course_code: { type: "STRING", description: "Required if mode is 'database' (e.g., 'LOCT 1011')." },
          section_title: { type: "STRING", description: "Optional if mode is 'database'. Used to filter questions to a specific chapter/section." },
          limit: { type: "INTEGER", description: "Number of questions to display (Max 3)." },
          custom_questions: {
            type: "ARRAY",
            description: "Required if mode is 'custom'. Generate Multiple Choice or True/False questions. MANDATORY: Every formula, variable, symbol, and option MUST be written in standard LaTeX enclosed in single dollar signs ($...).",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING" },
                text: { type: "STRING", description: "Question text. MUST wrap all math and variables in $...$ LaTeX syntax (e.g. 'What is the value of $\\cos(\\theta)$?')." },
                question_type: { type: "STRING", description: "'multiple_choice' or 'true_false'" },
                options: { type: "ARRAY", description: "Array of options. MUST wrap all math/numbers/variables in $...$ LaTeX syntax (e.g. ['$\\frac{1}{2}$', '$\\sqrt{3}$', '$0$']).", items: { type: "STRING" } },
                correct_answer: { type: "STRING", description: "The correct option matching one of the items in options." }
              }
            }
          }
        },
        required: ["mode"]
      }
    },
    {
      name: "render_flashcards",
      description: "Generate interactive 3D flashcards that are permanently saved to the student's Spaced Repetition (SRS) memory deck. Call this autonomously whenever you explain a core law, formula, definition, contrasting mechanism, or key exam takeaway. You decide the appropriate number of cards needed to test the concept with atomic recall.",
      parameters: {
        type: "OBJECT",
        properties: {
          course_code: { type: "STRING", description: "The course code (e.g. 'PHYS 1011', 'CHEM 1012', 'LOCT 1011', etc.)." },
          topic: { type: "STRING", description: "The topic or chapter title (e.g. 'Doppler Effect', 'Thermodynamics', 'Categorical Logic')." },
          flashcards: {
            type: "ARRAY",
            description: "Array of atomic flashcards. You decide how many cards are necessary based on the topic. MANDATORY: Every formula, variable, symbol, and unit MUST be written in standard LaTeX ($...).",
            items: {
              type: "OBJECT",
              properties: {
                front: { type: "STRING", description: "Crisp, single-concept active recall prompt. Wrap all math/variables in $...$ LaTeX." },
                back: { type: "STRING", description: "Clear, precise explanation or answer. Wrap all math/variables in $...$ LaTeX." },
                ref: { type: "STRING", description: "Reference note or source chapter (e.g. 'Miron AI • Core Law')." },
                is_mistake: { type: "BOOLEAN", description: "Optional. Set to true if this card targets a misconception or mistake the student had." }
              },
              required: ["front", "back"]
            }
          }
        },
        required: ["course_code", "topic", "flashcards"]
      }
    }
  ]
};

const GENERIC_STOP_WORDS = new Set([
  'chapter', 'section', 'unit', 'module', 'part', 'topic', 'lesson',
  'overview', 'introduction', 'summary', 'review', 'exercises', 'questions',
  'problems', 'references', 'appendix', 'the', 'and', 'of', 'in', 'to',
  'for', 'a', 'an', 'on', 'with', 'by', 'about'
]);

const NUMBER_WORD_MAP: Record<string, string> = {
  'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5',
  'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10',
  'eleven': '11', 'twelve': '12', 'thirteen': '13', 'fourteen': '14', 'fifteen': '15',
  'sixteen': '16', 'seventeen': '17', 'eighteen': '18', 'nineteen': '19', 'twenty': '20',
  'i': '1', 'ii': '2', 'iii': '3', 'iv': '4', 'v': '5',
  'vi': '6', 'vii': '7', 'viii': '8', 'ix': '9', 'x': '10',
  'xi': '11', 'xii': '12', 'xiii': '13', 'xiv': '14', 'xv': '15',
  'xvi': '16', 'xvii': '17', 'xviii': '18', 'xix': '19', 'xx': '20'
};

function normalizeTextTokens(str: string): string[] {
  if (!str) return [];
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(t => NUMBER_WORD_MAP[t] || t);
}

function calculateStringSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;
  const l1 = s1.length, l2 = s2.length;
  const matrix: number[][] = Array.from({ length: l1 + 1 }, () => new Array(l2 + 1).fill(0));
  for (let i = 0; i <= l1; i++) matrix[i][0] = i;
  for (let j = 0; j <= l2; j++) matrix[0][j] = j;
  for (let i = 1; i <= l1; i++) {
    for (let j = 1; j <= l2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return 1.0 - (matrix[l1][l2] / Math.max(l1, l2));
}

function findBestMatchingTocNode(tocTree: any[], rawQuery: string, confidenceThreshold = 0.80) {
  if (!tocTree || !Array.isArray(tocTree) || !rawQuery) return null;

  const flatList: any[] = [];
  function flatten(nodes: any[], parentTitle: string | null = null, chapterNum: any = null, depth = 0) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const currChapter = parentTitle ? chapterNum : (i + 1);
      const breadcrumb = parentTitle ? `${parentTitle} > ${n.title}` : n.title;
      flatList.push({
        node: n,
        originalIndex: flatList.length,
        title: n.title,
        page: n.page,
        chapterNum: currChapter,
        depth: depth,
        breadcrumb
      });
      if (n.children && Array.isArray(n.children)) {
        flatten(n.children, n.title, currChapter, depth + 1);
      }
    }
  }
  flatten(tocTree);

  if (flatList.length === 0) return null;

  const queryTokens = normalizeTextTokens(rawQuery);
  const queryMeaningful = queryTokens.filter(t => !GENERIC_STOP_WORDS.has(t));
  const queryNumber = queryTokens.find(t => /^\d+$/.test(t));
  const normalizedQueryStr = queryTokens.join(' ');

  const scored: any[] = [];

  for (const item of flatList) {
    const itemTitleTokens = normalizeTextTokens(item.title);
    const itemBreadcrumbTokens = normalizeTextTokens(item.breadcrumb);
    const itemTitleStr = itemTitleTokens.join(' ');
    const itemBreadcrumbStr = itemBreadcrumbTokens.join(' ');

    if (itemTitleStr === normalizedQueryStr || itemBreadcrumbStr === normalizedQueryStr) {
      scored.push({ item, score: 1.0 });
      continue;
    }

    if (itemTitleStr.includes(normalizedQueryStr) || normalizedQueryStr.includes(itemTitleStr)) {
      scored.push({ item, score: 0.95 });
      continue;
    }

    const itemMeaningful = new Set(itemTitleTokens.filter(t => !GENERIC_STOP_WORDS.has(t)));
    const itemBreadcrumbMeaningful = new Set(itemBreadcrumbTokens.filter(t => !GENERIC_STOP_WORDS.has(t)));
    const targetMeaningful = itemMeaningful.size > 0 ? itemMeaningful : itemBreadcrumbMeaningful;

    if (queryMeaningful.length === 0 || targetMeaningful.size === 0) continue;

    let tokenMatches = 0;
    for (const qToken of queryMeaningful) {
      let bestTokenSim = 0;
      for (const iToken of targetMeaningful) {
        const sim = calculateStringSimilarity(qToken, iToken);
        if (sim > bestTokenSim) bestTokenSim = sim;
      }
      if (bestTokenSim >= 0.80) {
        tokenMatches += bestTokenSim;
      }
    }

    let tokenScore = tokenMatches / Math.max(queryMeaningful.length, 1);

    if (queryNumber) {
      const itemHasNumber = itemTitleTokens.includes(queryNumber) || String(item.chapterNum) === queryNumber;
      if (itemHasNumber) {
        tokenScore = Math.min(1.0, tokenScore + 0.15);
      } else {
        tokenScore = tokenScore * 0.4;
      }
    }

    const strSim = Math.max(
      calculateStringSimilarity(normalizedQueryStr, itemTitleStr),
      calculateStringSimilarity(normalizedQueryStr, itemBreadcrumbStr)
    );

    const compositeScore = Math.max(tokenScore, strSim);
    if (compositeScore >= confidenceThreshold) {
      scored.push({ item, score: compositeScore });
    }
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (top.score < confidenceThreshold) return null;

  if (scored.length > 1) {
    const second = scored[1];
    if (top.score - second.score < 0.10 && top.item.page !== second.item.page) {
      return null;
    }
  }

  return { matchedItem: top.item, flatList };
}

// Helper to flatten UI JSON blocks into readable text for the LLM
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: corsHeaders });
    }
    const token = authHeader.replace('Bearer ', '');

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const PINECONE_API_KEY = Deno.env.get('PINECONE_API_KEY');
    const PINECONE_HOST = Deno.env.get('PINECONE_INDEX_HOST');

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { history, prompt, context } = await req.json();

    // 1. API Key Round-Robin Engine
    async function getGeminiKey() {
      const now = new Date();
      const { data: keys, error } = await supabase
        .from('api_keys')
        .select('*')
        .eq('service', 'gemini')
        .eq('is_active', true)
        .order('last_used_at', { ascending: true, nullsFirst: true });

      if (error) throw error;

      const availableKeys = keys.filter(k => !k.cooldown_until || new Date(k.cooldown_until) < now);
      if (availableKeys.length === 0) throw new Error("No active Gemini API keys available. All are in cooldown.");

      const selected = availableKeys[0];
      await supabase.from('api_keys').update({ last_used_at: now.toISOString() }).eq('id', selected.id);
      return selected;
    }

    async function flagKeyCooldown(keyId: number) {
      const cooldownTime = new Date(Date.now() + 5 * 60000).toISOString(); 
      await supabase.from('api_keys').update({ cooldown_until: cooldownTime }).eq('id', keyId);
    }

    // 2. Gemini Communication Wrapper (Generation & Embedding)
    async function callGemini(contents: any[], tools: any[] = [], systemInstruction?: string) {
      let attempts = 0;
      while (attempts < 3) {
        const keyRecord = await getGeminiKey();
        const payload: any = { contents };
        if (tools.length > 0) payload.tools = tools;
        if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${keyRecord.api_key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.status === 429) {
          await flagKeyCooldown(keyRecord.id);
          attempts++;
          continue;
        }

        if (!res.ok) throw new Error(`Gemini API Error: ${res.status} ${await res.text()}`);
        return await res.json();
      }
      throw new Error("Failed to contact Gemini after multiple round-robin attempts.");
    }

    async function generateEmbedding(text: string) {
      let attempts = 0;
      while (attempts < 3) {
        const keyRecord = await getGeminiKey();
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${keyRecord.api_key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: `models/${GEMINI_EMBEDDING_MODEL}`,
            content: { parts: [{ text }] },
            taskType: "RETRIEVAL_QUERY",
            outputDimensionality: EMBEDDING_DIMENSIONS
          })
        });

        if (res.status === 429) {
          await flagKeyCooldown(keyRecord.id);
          attempts++;
          continue;
        }

        if (!res.ok) throw new Error(`Gemini Embedding Error: ${res.status} ${await res.text()}`);
        const data = await res.json();
        return data.embedding?.values;
      }
      throw new Error("Failed to generate embedding.");
    }

    // 3. Prepare Conversation State
    let messages = [];
    if (context) {
      messages.push({ role: "user", parts: [{ text: `Current Context visible to user:\n"${context}"\n\nAnalyze this context if the user refers to it.` }]});
      messages.push({ role: "model", parts: [{ text: "Acknowledged. I have the context mapped." }]});
    }

    history.forEach((msg: any) => {
      messages.push({
        role: msg.side === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      });
    });
    
    messages.push({ role: "user", parts: [{ text: prompt }] });

    let uiCommand = null;
    let isToolCall = true;
    let loopCount = 0;
    let finalText = "";
    let inlineSnapshots: any[] = [];
    let inlineQuizzes: any[] = [];
    let inlineFlashcards: any[] = [];

    // 4. The Agentic Loop with Parallel Execution & Safety Net
    while (isToolCall && loopCount < 4) {
      const geminiResponse = await callGemini(messages, [toolsDefinition], MIRON_SYSTEM_PROMPT);
      const candidate = geminiResponse.candidates?.[0];

      const functionCallParts = candidate?.content?.parts?.filter((p: any) => p.functionCall) || [];

      if (functionCallParts.length > 0) {
        console.log(`[MIRON LOOP ${loopCount}] Executing ${functionCallParts.length} tool(s) in parallel.`);
        
        const toolExecutionPromises = functionCallParts.map(async (part: any) => {
          const { name, args } = part.functionCall;
          console.log(`  -> Running Tool: ${name}`, args);
          let toolResult: any = {};

          try {
            if (name === "search_textbook_material") {
              if (!PINECONE_API_KEY || !PINECONE_HOST) throw new Error("Pinecone secrets missing.");
              
              const queryVector = await generateEmbedding(args.optimized_query);
              const cleanHost = PINECONE_HOST.replace(/\/$/, '').replace(/^https?:\/\//, '');

              let targetNamespaces: string[] = [];
              if (args.course_code) {
                const { data } = await supabase.from('books').select('id').eq('course_code', args.course_code.toUpperCase().trim()).single();
                if (data) targetNamespaces.push(data.id);
              }

              if (targetNamespaces.length === 0) {
                // Safeguard: Limit to 10 most recent books to prevent Pinecone rate limits on global queries
                const { data } = await supabase.from('books').select('id').order('created_at', { ascending: false }).limit(10);
                if (data) targetNamespaces = data.map(b => b.id);
              }

              const searchPromises = targetNamespaces.map(async (namespace) => {
                const res = await fetch(`https://${cleanHost}/query`, {
                  method: 'POST',
                  headers: { 'Api-Key': PINECONE_API_KEY, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ namespace, vector: queryVector, topK: 3, includeMetadata: true })
                });
                if (!res.ok) return [];
                const resData = await res.json();
                return resData.matches || [];
              });

              const resultsArray = await Promise.all(searchPromises);
              const allMatches = resultsArray.flat();
              allMatches.sort((a: any, b: any) => b.score - a.score);
              const topFive = allMatches.slice(0, 5);

              toolResult = { 
                status: "success", 
                matches: topFive.map(m => m.metadata),
                directive: "Relevant textbook snippets retrieved. Synthesize your final answer to the student now."
              };
            }
            else if (name === "get_book_toc") {
              const code = (args.course_code || args.query || "").toUpperCase().trim();
              
              const { data } = await supabase.from('books')
                .select('id, title, toc, page_offset')
                .eq('course_code', code)
                .single();

              if (data) {
                toolResult = { 
                  status: "success", 
                  book_id: data.id, 
                  title: data.title, 
                  course_code: code, 
                  page_offset: data.page_offset || 0, 
                  toc: data.toc,
                  directive: "TOC structure retrieved. You can directly request any specific section or sub-section title in read_book_section without stepping down."
                };
              } else {
                toolResult = { status: "error", message: `Book with course code ${code} not found.` };
              }
            } 
            else if (name === "read_book_section") {
              const code = (args.course_code || "").toUpperCase().trim();
              
              let query = supabase.from('books').select('id, title, toc, page_offset');
              if (code) {
                query = query.eq('course_code', code);
              } else if (args.book_id) {
                query = query.eq('id', args.book_id);
              }
              const { data: book } = await query.single();
              
              if (book && book.toc) {
                const matchResult = findBestMatchingTocNode(book.toc, args.section_title, 0.80);
                
                if (matchResult) {
                  const { matchedItem, flatList } = matchResult;
                  const startPage = matchedItem.page;
                  const targetDepth = matchedItem.depth;
                  let endPage = 99999;
                  
                  for (let i = matchedItem.originalIndex + 1; i < flatList.length; i++) {
                    const candidateNode = flatList[i];
                    if (candidateNode.depth <= targetDepth && candidateNode.page && candidateNode.page > startPage) {
                      endPage = candidateNode.page;
                      break;
                    }
                  }

                  const offset = book.page_offset || 0;
                  const physicalStartPage = Math.max(1, startPage + offset);
                  const physicalEndPage = endPage === 99999 ? 99999 : Math.max(1, endPage + offset);

                  const { data: pages } = await supabase.from('book_pages')
                    .select('page_number, content_json')
                    .eq('book_id', book.id)
                    .gte('page_number', physicalStartPage)
                    .lt('page_number', physicalEndPage)
                    .order('page_number', { ascending: true })
                    .limit(20);

                  let sectionText = "";
                  if (pages) {
                    sectionText = pages.map(p => `--- PAGE ${p.page_number} ---\n` + extractTextFromBlockArray(p.content_json || [])).join("\n\n");
                  }
                  toolResult = { 
                    status: "success", 
                    matched_section: matchedItem.title, 
                    breadcrumb: matchedItem.breadcrumb,
                    directive: "Section material loaded including all sub-sections. You have all context. Synthesize and write your comprehensive response to the student immediately.",
                    text: sectionText || "Section is empty." 
                  };
                } else {
                  toolResult = { status: "error", message: `Section "${args.section_title}" not found in TOC with sufficient confidence (>=80%).` };
                }
              } else {
                toolResult = { status: "error", message: "Book not found." };
              }
            }
            else if (name === "open_page") {
              const code = (args.course_code || "").toUpperCase().trim();
              let bookId = args.book_id;
              let offset = 0;
              if (code) {
                const { data: b } = await supabase.from('books').select('id, page_offset').eq('course_code', code).single();
                if (b) {
                  bookId = b.id;
                  offset = b.page_offset || 0;
                }
              }
              const physicalPage = Math.max(1, args.page_number + offset);
              uiCommand = { action: 'open_page', book_id: bookId, page_number: physicalPage };
              toolResult = { status: "success", message: "User is being navigated to the page." };
            }
            else if (name === "render_book_snapshot") {
              const code = args.course_code.toUpperCase().trim();
              const { data: book } = await supabase.from('books').select('id, title, page_offset').eq('course_code', code).single();
              
              if (book) {
                const offset = book.page_offset || 0;
                const physicalPage = Math.max(1, args.page_number + offset);

                const { data: page } = await supabase.from('book_pages')
                  .select('content_json')
                  .eq('book_id', book.id)
                  .eq('page_number', physicalPage)
                  .single();
                  
                if (page && page.content_json) {
                  let blocksToRender = page.content_json;
                  if (args.block_index !== undefined && args.block_index !== null) {
                    blocksToRender = [page.content_json[args.block_index]].filter(Boolean);
                  }
                  
                  const snapId = inlineSnapshots.length;
                  inlineSnapshots.push({
                    id: snapId,
                    course_code: args.course_code,
                    book_title: book.title,
                    page_number: physicalPage,
                    blocks: blocksToRender
                  });
                  
                  toolResult = { status: "success", instruction: `Snapshot ready. Insert [SNAPSHOT_${snapId}] to render.` };
                } else {
                  toolResult = { status: "error", message: `Page ${physicalPage} content not found.` };
                }
              } else {
                toolResult = { status: "error", message: "Course code not found." };
              }
            }
            else if (name === "fetch_available_boards") {
              const { data: book } = await supabase.from('books').select('id').eq('course_code', args.course_code.toUpperCase().trim()).single();
              if (book) {
                const { data: boards } = await supabase.from('board_drawings').select('id, toc_node_title, description').eq('book_id', book.id);
                if (boards && boards.length > 0) {
                  toolResult = { 
                    status: "success", 
                    boards: boards.map(b => ({ id: b.id, topic: b.toc_node_title, description: b.description })),
                    instruction: "You can render these instantly by inserting the tag [BOARD_asset_id] directly in your response text."
                  };
                } else {
                  toolResult = { status: "success", message: "No pre-built boards found for this course." };
                }
              } else {
                toolResult = { status: "error", message: "Course not found." };
              }
            }
            else if (name === "render_quiz") {
              let qList = [];
              let quizTitle = args.section_title ? `Knowledge Check: ${args.section_title}` : "Interactive Knowledge Check";

              if (args.mode === 'database') {
                const code = (args.course_code || "").toUpperCase().trim();
                const { data: book } = await supabase.from('books').select('id, toc, page_offset').eq('course_code', code).single();
                if (book && book.toc) {
                  let startPage = 0;
                  let endPage = 99999;
                  if (args.section_title) {
                    const matchResult = findBestMatchingTocNode(book.toc, args.section_title, 0.80);
                    if (matchResult) {
                      const { matchedItem, flatList } = matchResult;
                      startPage = matchedItem.page;
                      const targetDepth = matchedItem.depth;
                      for (let i = matchedItem.originalIndex + 1; i < flatList.length; i++) {
                        const candidateNode = flatList[i];
                        if (candidateNode.depth <= targetDepth && candidateNode.page && candidateNode.page > startPage) {
                          endPage = candidateNode.page;
                          break;
                        }
                      }
                    }
                  }

                  const offset = book.page_offset || 0;
                  const physicalStartPage = Math.max(1, startPage + offset);
                  const physicalEndPage = endPage === 99999 ? 99999 : Math.max(1, endPage + offset);

                  const { data: mappings } = await supabase.from('question_book_mappings')
                    .select('question_id, page_key')
                    .eq('book_id', book.id)
                    .eq('is_valid', true);

                  const validQIds = (mappings || [])
                    .filter(m => {
                      const p = parseInt(m.page_key.replace('page-', ''), 10);
                      return p >= physicalStartPage && p < physicalEndPage;
                    })
                    .map(m => m.question_id);

                  if (validQIds.length > 0) {
                    const { data: dbQs } = await supabase.from('questions').select('id, text, question_type, options, correct_answer').in('id', validQIds).limit(args.limit || 3);
                    qList = dbQs || [];
                  }
                }
              } else {
                qList = args.custom_questions || [];
              }

              if (qList.length > 0) {
                const quizId = inlineQuizzes.length;
                inlineQuizzes.push({ id: quizId, title: quizTitle, questions: qList });
                toolResult = { status: "success", instruction: `Quiz generated. You MUST insert [QUIZ_${quizId}] in your response to render it.` };
              } else {
                toolResult = { status: "error", message: "No questions found matching criteria." };
              }
            }
            else if (name === "render_flashcards") {
              const course = (args.course_code || "GENERAL").toUpperCase().trim();
              const topic = args.topic || "Miron Synthesis";
              const cards = args.flashcards || [];

              if (cards.length > 0) {
                const tags: string[] = [];
                cards.forEach((card: any) => {
                  const cardNum = inlineFlashcards.length + 1;
                  inlineFlashcards.push({
                    id: cardNum,
                    course_code: course,
                    topic: topic,
                    front: card.front,
                    back: card.back,
                    ref: card.ref || `Miron AI • ${topic}`,
                    is_mistake: card.is_mistake || false
                  });
                  tags.push(`[FLASHCARD_${cardNum}]`);
                });

                toolResult = {
                  status: "success",
                  instruction: `Flashcards registered. Insert [FLASHCARD_1] on its own line exactly where you want the student to interact with the deck. All cards in this set will advance in-place right at that position.`
                };
              } else {
                toolResult = { status: "error", message: "No flashcards provided in payload." };
              }
            }
          } catch (e) {
            toolResult = { status: "error", message: e.message };
          }

          return { name, content: toolResult };
        });

        const toolResponses = await Promise.all(toolExecutionPromises);

        messages.push(candidate.content);
        messages.push({
          role: "user",
          parts: toolResponses.map(res => ({
            functionResponse: {
              name: res.name,
              response: { name: res.name, content: res.content }
            }
          }))
        });

        loopCount++;
      } else {
        isToolCall = false;
        finalText = candidate?.content?.parts?.[0]?.text || "My cognitive link was interrupted. Please try again.";
      }
    }

    // Safety Net: If loop ended while still seeking tools, force final answer with tools disabled
    if (isToolCall && !finalText) {
      console.log(`[MIRON SAFETY NET] Tool iterations reached (${loopCount}). Compelling forced synthesis...`);
      messages.push({
        role: "user",
        parts: [{ text: "Tool budget completed. Synthesize and write your complete, final explanation to the student now using all the textbook context gathered above." }]
      });
      try {
        const forcedResponse = await callGemini(messages, [], MIRON_SYSTEM_PROMPT);
        finalText = forcedResponse.candidates?.[0]?.content?.parts?.[0]?.text || "Here is the summary based on the textbook material analyzed above.";
      } catch (e) {
        finalText = "Here is the explanation based on the textbook material reviewed above.";
      }
    }

    // Clean up hallucinated orphan tags if tools were not executed
    if (inlineQuizzes.length === 0) {
      finalText = finalText.replace(/\[QUIZ_\d+\]/g, '').trim();
    }
    if (inlineSnapshots.length === 0) {
      finalText = finalText.replace(/\[SNAPSHOT_\d+\]/g, '').trim();
    }
    if (inlineFlashcards.length === 0) {
      finalText = finalText.replace(/\[FLASHCARD_\d+\]/g, '').trim();
    }

    return new Response(JSON.stringify({ 
      response: finalText,
      thoughts: [],
      ui_command: uiCommand,
      snapshots: inlineSnapshots,
      quizzes: inlineQuizzes,
      flashcards: inlineFlashcards
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error(`[MIRON FATAL] ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});