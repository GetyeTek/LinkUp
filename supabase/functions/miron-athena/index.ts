import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
};

const GEMINI_MODEL = "gemini-3.6-flash";
const GROQ_MODEL = "qwen/qwen3.8-27b";
const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;

const MIRON_SYSTEM_PROMPT = `You are Miron Athena, an exceptional, articulate, and supportive academic study companion for university students.
You communicate naturally, with warmth, clarity, and genuine conversational intelligence. You explain complex ideas with intuitive depth, adapt seamlessly to the student's learning pace, and never sound robotic, scripted, or overly formal.

AVAILABLE COURSE TEXTBOOKS (Internal course_code key to textbook title):
"ANTH 1012" - "Anthropology"
"BIOL 1012" - "Biology"
"CHEM 1012" - "Chemistry"
"ECON 1011" - "Economics"
"EMTE 1012" - "Emerging Technology"
"FLEN 1011" - "English Skill I"
"GEES 1011" - "Geography"
"GLTR 1012" - "Global Affairs"
"HIST 1012" - "History"
"INCL 1012" - "Inclusiveness"
"LOCT 1011" - "Logic and Critical Thinking"
"MATH 1011" - "Math For Social Science"
"MATH 1012" - "Math For Natural Science"
"MCIE 1012" - "Civics"
"MGMT 1012" - "Entrepreneurship"
"PHYS 1011" - "Physics"
"PSYC 1011" - "Psychology"
"SPSC 1011" - "Physical Fitness"

NATURAL COURSE & INTENT UNDERSTANDING:
- Students talk casually. Naturally deduce the relevant course from the student's conversation, context, or topic intention rather than requiring rigid, exact titles or formal institutional names.
- In student-facing responses, always refer to subjects naturally (e.g., "Physics", "Chemistry", "Civics", "Biology") rather than alphanumeric codes.
- Use the alphanumeric code strictly as the internal course_code parameter when calling tools.

ABSOLUTE IMMERSION & NO 4TH-WALL BREAKING:
- You are an authentic university peer tutor, not an AI software interface or chatbot.
- NEVER mention 'tools', 'functions', 'calls', 'backend', 'APIs', 'databases', 'system limitations', or internal course codes in your conversation.
- SILENT EXECUTION: NEVER narrate or announce tool calls in text (e.g. NEVER say 'Let me check the Table of Contents for you', 'Hold on while I check the book', or 'Calling the tool').
- When you need textbook context, execute the tool SILENTLY in the background and deliver the finished, natural study response immediately. If a technical issue occurs, handle it gracefully and humanly without technical excuses or robotic apologies.

STUDY COMPANION NATURAL WORKFLOW:
- The Prepared Partner Posture: When a student mentions a course they want to study (e.g. 'Let's study Physics', 'Help me with Civics'), act like an elite classmate who already has that student's textbook open on the desk. Immediately and silently call "get_book_toc" to inspect the curriculum. Respond with genuine familiarity, naturally presenting the major chapters/topics so the student feels in expert hands (e.g. "Awesome! In Physics we've got Chapter 1 (Vectors), Chapter 2 (1D Kinematics), Chapter 3 (2D Motion & Projectiles)... where do you want to jump in?").
- The Chapter Deep-Dive: Once the student picks a chapter or topic (e.g. 'Chapter 3'), use the exact title obtained from the TOC to silently call "read_book_section". Deliver a lucid, comprehensive synthesis and actively guide them on what laws, concepts, or formulas they should focus on for exam mastery.
- Never Ask What Is in the Book: NEVER ask the student what is inside their own textbook, what a chapter is called, or what courses you have access to. If a subject is mentioned, check the book yourself silently.
- Prudent Tool Usage: Execute tools whenever you genuinely need textbook material or syllabus mapping to support the student's study session. However, do NOT be trigger-happy: never call tools on basic greetings, casual banter, or general study advice where no textbook lookup is warranted.

TOOLKIT MASTERY & PEDAGOGICAL PURPOSE:
1. "read_book_section" & "get_book_toc":
   - Use these silently to retrieve exact definitions, theorems, formulas, and syllabus explanations directly from the student's curriculum textbook.
   - When calling "read_book_section", pass the exact section title obtained from the TOC. You receive the entire section and sub-sections in one shot.

2. "render_flashcards" (Spaced Repetition SRS):
   - Pedagogical Purpose: Long-term memory reinforcement.
   - When to use: When you have explained high-yield formulas, fundamental laws, technical definitions, or multi-step mechanisms that students must memorize for exams.
   - How to introduce: Integrate them smoothly as a natural study aid (e.g., "I've created an active recall card for this formula below and added it to your review deck:").
   - Place [FLASHCARD_1] on its own line where you want the interactive deck to render.
   - Cards must follow the Atomic Recall Principle: A sharp, single-concept prompt on the front; a punchy, precise explanation on the back. Wrap all math/variables in LaTeX.

3. "render_quiz" (Interactive Knowledge Checks):
   - Pedagogical Purpose: Active testing and formative assessment.
   - When to use: After explaining a substantive concept, when reviewing a chapter, or whenever the student wants to be tested. You choose whether to pull archived university questions (mode: 'database') or generate your own (mode: 'custom').
   - Mode Selection Guide:
     * 'database': Pulls authentic past university exam questions mapped to that textbook chapter. Use this whenever you want to test the student against real university exam standards.
     * 'custom': Generates your own targeted questions on the fly. Ideal for verifying formulas or concepts you just explained, or when testing specific problem-solving techniques.
   - Silent Fallback: If 'database' mode reports that no archived questions are mapped to that section, do NOT mention database limitations or backend messages to the user. Silently call 'render_quiz' again with mode: 'custom' in that exact turn to generate your own questions on the spot.
   - Dynamic Count: You choose how many questions to present (maximum ceiling: 20) based on the depth of the topic or what the student asked for. Do not force an artificial limit.
   - Tag Requirement: You can ONLY insert [QUIZ_0] into your response if the tool was executed and returned that tag.

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
          limit: { type: "INTEGER", description: "Number of questions to display (Maximum ceiling: 20). Choose an appropriate count dynamically based on the student's request or topic depth." },
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

function convertToOpenAISchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(convertToOpenAISchema);
  const result: any = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type' && typeof v === 'string') {
      result[k] = v.toLowerCase();
    } else {
      result[k] = convertToOpenAISchema(v);
    }
  }
  return result;
}

const groqTools = toolsDefinition.functionDeclarations.map(fn => ({
  type: "function",
  function: {
    name: fn.name,
    description: fn.description,
    parameters: convertToOpenAISchema(fn.parameters)
  }
}));

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
    const reqStart = performance.now();
    const elapsed = () => `${(performance.now() - reqStart).toFixed(0)}ms`;
    console.log(`⏱️ [REQ START] Incoming request received`);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const PINECONE_API_KEY = Deno.env.get('PINECONE_API_KEY');
    const PINECONE_HOST = Deno.env.get('PINECONE_INDEX_HOST');

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const { history, prompt, context } = await req.json();

    // 1. API Key Round-Robin Engine (Groq & Gemini)
    async function getApiKey(service: 'groq' | 'gemini') {
      const now = new Date();
      const { data: keys, error } = await supabase
        .from('api_keys')
        .select('*')
        .eq('service', service)
        .eq('is_active', true)
        .order('last_used_at', { ascending: true, nullsFirst: true });

      if (error) throw error;

      const availableKeys = (keys || []).filter((k: any) => !k.cooldown_until || new Date(k.cooldown_until) < now);
      if (availableKeys.length === 0) throw new Error(`No active ${service} API keys available. All are in cooldown.`);

      const selected = availableKeys[0];
      await supabase.from('api_keys').update({ last_used_at: now.toISOString() }).eq('id', selected.id);
      return selected;
    }

    async function flagKeyCooldown(keyId: number) {
      const cooldownTime = new Date(Date.now() + 30000).toISOString(); 
      await supabase.from('api_keys').update({ cooldown_until: cooldownTime }).eq('id', keyId);
    }

    // 2. Groq Primary Communication Wrapper
    async function callGroq(messages: any[], tools: any[] = []) {
      let attempts = 0;
      while (attempts < 3) {
        const groqStart = performance.now();
        const keyRecord = await getApiKey('groq');
        const payload: any = {
          model: GROQ_MODEL,
          messages,
          temperature: 0.6
        };
        if (tools.length > 0) {
          payload.tools = tools;
          payload.tool_choice = "auto";
        }

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${keyRecord.api_key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (res.status === 429) {
          await flagKeyCooldown(keyRecord.id);
          attempts++;
          continue;
        }

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Groq API Error: ${res.status} ${errText}`);
        }

        const data = await res.json();
        const dur = (performance.now() - groqStart).toFixed(0);
        const u = data.usage;
        const usageLog = u ? `[tokens: prompt=${u.prompt_tokens}, comp=${u.completion_tokens}, time=${u.total_time ? u.total_time.toFixed(2) + 's' : 'N/A'}]` : '';
        console.log(`⚡ [GROQ CALL] took ${dur}ms ${usageLog}`);
        return data;
      }
      throw new Error("Failed to contact Groq after multiple round-robin attempts.");
    }

    // 3. Gemini Primary Communication Wrapper
    async function callGemini(contents: any[], tools: any[] = [], systemInstruction?: string) {
      let attempts = 0;
      while (attempts < 3) {
        const geminiStart = performance.now();
        const keyRecord = await getApiKey('gemini');
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
        const data = await res.json();
        const dur = (performance.now() - geminiStart).toFixed(0);
        console.log(`⚡ [GEMINI CALL] took ${dur}ms`);
        return data;
      }
      throw new Error("Failed to contact Gemini after multiple round-robin attempts.");
    }

    async function generateEmbedding(text: string) {
      const embStart = performance.now();
      let attempts = 0;
      while (attempts < 3) {
        const keyRecord = await getApiKey('gemini');
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
        const dur = (performance.now() - embStart).toFixed(0);
        console.log(`🧠 [GEMINI EMBEDDING] took ${dur}ms (text length: ${text.length})`);
        return data.embedding?.values;
      }
      throw new Error("Failed to generate embedding.");
    }

    let uiCommand: any = null;
    let finalText = "";
    let extractedThoughts: string[] = [];
    let inlineSnapshots: any[] = [];
    let inlineQuizzes: any[] = [];
    let inlineFlashcards: any[] = [];

    // Unified Tool Execution Engine
    async function executeTool(name: string, args: any) {
      const toolStart = performance.now();
      console.log(`🔧 [TOOL START] ${name} at +${elapsed()}`, JSON.stringify(args));
      let toolResult: any = {};

      try {
        if (name === "get_book_toc") {
          const tocStart = performance.now();
          const code = (args.course_code || args.query || "").toUpperCase().trim();
          
          const { data } = await supabase.from('books')
            .select('id, title, toc, page_offset')
            .eq('course_code', code)
            .single();

          const tocDur = (performance.now() - tocStart).toFixed(0);
          console.log(`📑 [GET TOC] took ${tocDur}ms for course: ${code}`);

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
          const sectionStart = performance.now();
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
                sectionText = pages.map((p: any) => `--- PAGE ${p.page_number} ---\n` + extractTextFromBlockArray(p.content_json || [])).join("\n\n");
              }

              const sectionDur = (performance.now() - sectionStart).toFixed(0);
              console.log(`📖 [READ SECTION DB] took ${sectionDur}ms for "${matchedItem.title}" (${pages?.length || 0} pages loaded)`);

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
                const queryLimit = Math.min(20, Math.max(1, args.limit || 5));
                const { data: dbQs } = await supabase.from('questions').select('id, text, question_type, options, correct_answer').in('id', validQIds).limit(queryLimit);
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
          } else if (args.mode === 'database') {
            toolResult = { 
              status: "no_database_questions", 
              instruction: "No archived university exam questions are currently mapped to this exact chapter in the database. Do not mention this to the user—silently fall back immediately to render_quiz with mode: 'custom' to generate your own targeted questions right now." 
            };
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
      } catch (e: any) {
        toolResult = { status: "error", message: e.message };
      }

      return toolResult;
    }

    // 4. Helper: Native SSE Stream Reader for Gemini
    async function streamGeminiTurn(
      contents: any[],
      tools: any[] | null,
      systemInstruction: string,
      onTextChunk: (text: string) => void
    ) {
      let attempts = 0;
      while (attempts < 3) {
        const keyRecord = await getApiKey('gemini');
        const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${keyRecord.api_key}`;

        const payload: any = { contents };
        if (tools && tools.length > 0) payload.tools = tools;
        if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };

        const res = await fetch(streamUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.status === 429) {
          await flagKeyCooldown(keyRecord.id);
          attempts++;
          continue;
        }

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Gemini Stream Error: ${res.status} ${errText}`);
        }

        if (!res.body) throw new Error("Gemini stream body missing.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let fullText = '';
        const functionCalls: any[] = [];
        const modelParts: any[] = [];

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr) continue;

            try {
              const parsed = JSON.parse(jsonStr);
              const parts = parsed.candidates?.[0]?.content?.parts || [];
              for (const part of parts) {
                modelParts.push(part);
                if (part.functionCall) {
                  functionCalls.push(part.functionCall);
                } else if (part.text) {
                  fullText += part.text;
                  onTextChunk(part.text);
                }
              }
            } catch (_) {}
          }
        }

        return { fullText, functionCalls, modelParts };
      }
      throw new Error("Failed to stream Gemini after multiple attempts.");
    }

    // 5. Execution Engine: Full-Duplex SSE Stream
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const sendEvent = (type: string, data: any = {}) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
          } catch (e) {
            console.warn("[Miron SSE] Controller write error:", e);
          }
        };

        try {
          console.log(`[MIRON STREAM] Initiating real-time turn with primary model: Gemini (${GEMINI_MODEL})`);

          let geminiMessages: any[] = [];
          if (context) {
            geminiMessages.push({ role: "user", parts: [{ text: `Current Context visible to user:\n"${context}"\n\nAnalyze this context if the user refers to it.` }]});
            geminiMessages.push({ role: "model", parts: [{ text: "Acknowledged. I have the context mapped." }]});
          }

          const trimmedHistory = history.slice(-6);
          trimmedHistory.forEach((msg: any) => {
            geminiMessages.push({
              role: msg.side === 'user' ? 'user' : 'model',
              parts: [{ text: msg.text }]
            });
          });

          geminiMessages.push({ role: "user", parts: [{ text: prompt }] });

          let geminiLoop = 0;
          let shouldLoopTools = true;

          while (shouldLoopTools && geminiLoop < 3) {
            console.log(`🔄 [GEMINI STREAM TURN ${geminiLoop}] at +${elapsed()}`);

            const turnResult = await streamGeminiTurn(
              geminiMessages,
              geminiLoop === 0 ? [toolsDefinition] : null,
              MIRON_SYSTEM_PROMPT,
              (chunkText) => {
                finalText += chunkText;
                sendEvent('chunk', { delta: chunkText });
              }
            );

            if (turnResult.functionCalls.length > 0) {
              const toolNames = turnResult.functionCalls.map((fc: any) => fc.name).join(', ');
              console.log(`🛠️ [TOOLS DETECTED] [${toolNames}] at +${elapsed()}`);

              for (const fc of turnResult.functionCalls) {
                const { name, args } = fc;
                if (name === 'read_book_section') {
                  sendEvent('status', { message: `Reading ${args.section_title || 'textbook section'}...` });
                } else if (name === 'render_flashcards') {
                  sendEvent('status', { message: `Preparing interactive study cards for ${args.topic || 'topic'}...` });
                } else if (name === 'render_quiz') {
                  sendEvent('status', { message: `Preparing knowledge check...` });
                } else {
                  sendEvent('status', { message: `Consulting course materials...` });
                }
              }

              const toolExecutionPromises = turnResult.functionCalls.map(async (fc: any) => {
                const toolResult = await executeTool(fc.name, fc.args);
                return { name: fc.name, content: toolResult };
              });

              const toolResponses = await Promise.all(toolExecutionPromises);

              geminiMessages.push({
                role: "model",
                parts: turnResult.modelParts
              });
              geminiMessages.push({
                role: "user",
                parts: toolResponses.map(res => ({
                  functionResponse: {
                    name: res.name,
                    response: { name: res.name, content: res.content }
                  }
                }))
              });

              sendEvent('status', { message: 'Synthesizing response...' });
              geminiLoop++;
            } else {
              shouldLoopTools = false;
            }
          }

        } catch (geminiErr: any) {
          console.warn(`[MIRON GEMINI STREAM FAILED] ${geminiErr.message}. Executing Groq streaming fallback...`, geminiErr);
          try {
            sendEvent('status', { message: 'Switching cognitive engine...' });
            const groqMessages: any[] = [
              { role: "system", content: MIRON_SYSTEM_PROMPT }
            ];
            const trimmed = history.slice(-6);
            trimmed.forEach((m: any) => groqMessages.push({ role: m.side === 'user' ? 'user' : 'assistant', content: m.text }));
            groqMessages.push({ role: "user", content: prompt });

            const keyRecord = await getApiKey('groq');
            const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${keyRecord.api_key}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model: GROQ_MODEL,
                messages: groqMessages,
                temperature: 0.6,
                stream: true
              })
            });

            if (groqRes.ok && groqRes.body) {
              const reader = groqRes.body.getReader();
              const decoder = new TextDecoder();
              let sseBuf = '';
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                sseBuf += decoder.decode(value, { stream: true });
                const lines = sseBuf.split('\n');
                sseBuf = lines.pop() || '';
                for (const l of lines) {
                  const tr = l.trim();
                  if (!tr.startsWith('data:')) continue;
                  const jsonStr = tr.slice(5).trim();
                  if (jsonStr === '[DONE]') break;
                  try {
                    const parsed = JSON.parse(jsonStr);
                    const deltaContent = parsed.choices?.[0]?.delta?.content || '';
                    if (deltaContent) {
                      finalText += deltaContent;
                      sendEvent('chunk', { delta: deltaContent });
                    }
                  } catch (_) {}
                }
              }
            } else {
              const groqFallback = await callGroq(groqMessages, []);
              finalText = groqFallback.choices?.[0]?.message?.content || "Here is the response.";
              sendEvent('chunk', { delta: finalText });
            }
          } catch (err: any) {
            sendEvent('error', { message: err.message });
          }
        } finally {
          // Clean orphan tags from completed text
          if (inlineQuizzes.length === 0) finalText = finalText.replace(/\[QUIZ_\d+\]/g, '').trim();
          if (inlineSnapshots.length === 0) finalText = finalText.replace(/\[SNAPSHOT_\d+\]/g, '').trim();
          if (inlineFlashcards.length === 0) finalText = finalText.replace(/\[FLASHCARD_\d+\]/g, '').trim();

          console.log(`🏁 [MIRON COMPLETED] Total request runtime: ${elapsed()} | Final text: ${finalText.length} chars | Flashcards: ${inlineFlashcards.length}`);

          sendEvent('done', {
            snapshots: inlineSnapshots,
            quizzes: inlineQuizzes,
            flashcards: inlineFlashcards,
            ui_command: uiCommand,
            thoughts: extractedThoughts
          });

          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });

  } catch (error) {
    console.error(`[MIRON FATAL] ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});