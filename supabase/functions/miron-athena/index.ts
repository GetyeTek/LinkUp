import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
};

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;

const MIRON_SYSTEM_PROMPT = `You are Miron Athena, an elite, hyper-intelligent academic AI assistant.
Your goal is to provide precise, deeply analytical, and highly structured answers to university students.
You have access to a specific catalog of university courses.

AVAILABLE COURSE CATALOG:
"ANTH 1012" - "SOCIAL ANTHROPOLOGY"
"BIOL 1012" - "GENERAL BIOLOGY"
"CHEM 1012" - "GENERAL CHEMISTRY"
"ECON 1011" - "INTRODUCTION TO ECONOMICS"
"EMTE 1012" - "INTRODUCTION TO EMERGING TECHNOLOGIES"
"FLEN 1011" - "COMMUNICATIVE ENGLISH LANGUAGE SKILLS"
"GEES 1011" - "GEOGRAPHY"
"GLTR 1012" - "GLOBAL TRENDS"
"HIST 1012" - "HISTORY"
"INCL 1012" - "INCLUSIVENESS"
"LOCT 1011" - "LOGIC AND CRITICAL THINKING"
"MATH 1011" - "MATHEMATICS FOR SOCIAL SCIENCES"
"MATH 1012" - "MATHEMATICS FOR NATURAL SCIENCES"
"MCIE 1012" - "MORAL AND CIVIC EDUCATION"
"MGMT 1012" - "ENTREPRENEURSHIP"
"PHYS 1011" - "GENERAL PHYSICS"
"PSYC 1011" - "GENERAL PSYCHOLOGY"
"SPSC 1011" - "PHYSICAL EDUCATION"

DUAL-ENGINE RETRIEVAL & TOOL BUDGET INSTRUCTIONS:
When a user asks an academic question, you MUST execute a dual-retrieval strategy in parallel during your FIRST turn:
1. Call "search_textbook_material" to perform a semantic vector search.
   - IMPORTANT: Distill the user's conversational text into a highly optimized, dense keyword query.
   - If you know the course the user is referring to, provide the course code. If not, leave it empty to search globally across all books.
2. Call "get_book_toc" using the course code to understand the structural context of the subject.

TARGETED RETRIEVAL & SINGLE-HOP RULES:
- You have the complete Table of Contents tree. You can directly request ANY specific section or sub-section title (e.g., "1.1.2 SI Units" or "Chapter 2: Kinematics").
- When you request a parent section (e.g., "1.1"), the system automatically returns the ENTIRE topic including all sub-sections under it up to the next major section.
- NEVER call tools sequentially to "step down" through a hierarchy. One targeted call to "read_book_section" retrieves the entire section and all sub-items.
- STRICT TOOL BUDGET: You are allowed a maximum of ONE tool-gathering step. Once textbook data or TOC is returned, you MUST immediately synthesize your final response in the following turn.
- If the user's message is a simple greeting or non-academic, do not call any tools.

MATHEMATICAL & SCIENTIFIC EQUATION FORMATTING:
- When writing math, physics, or chemistry equations, formulas, variables, and reactions, ALWAYS format them in standard LaTeX syntax:
  * Use single dollar signs ($...$) for inline variables and formulas (e.g., $E_k = \frac{1}{2}mv^2$, $\vec{F} = m\vec{a}$, $\Delta t$).
  * Use double dollar signs ($...$) for standalone display equations and multi-step derivations.
  * For chemical reactions, use LaTeX text notation (e.g., $\text{2H}_2 + \text{O}_2 \rightarrow \text{2H}_2\text{O}$).

VISUAL SNAPSHOT CAPABILITY:
If you are explaining a specific paragraph, formula, or concept and you believe the student would benefit from seeing the EXACT textbook material visually, call the "render_book_snapshot" tool.
- The tool will retrieve the visual UI data and return a placeholder tag to you (e.g., [SNAPSHOT_0]).
- You MUST insert this exact tag directly into your final response wherever you want the textbook snapshot to appear.

INTERACTIVE QUIZ CAPABILITY (TUTOR MODE):
If you want to test the student's knowledge on the topic you just explained, call the "render_quiz" tool.
- You can pull real exam questions from the database by specifying the course code and section title, OR you can generate "custom" questions yourself in the tool call arguments.
- CRITICAL QUIZ RULE: You MUST NEVER type '[QUIZ_0]' or any quiz tag directly in your response on your own. If you want to quiz the student, you MUST execute the 'render_quiz' tool call. You can ONLY insert a quiz tag into your response text if the tool call was actually executed and returned that tag to you in the tool response.
- The user will interact with the UI, click "Submit", and their answers will automatically be sent back to you as a new message for you to evaluate.`;

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
            description: "Required if mode is 'custom'. Generate Multiple Choice or True/False questions.",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING" },
                text: { type: "STRING" },
                question_type: { type: "STRING", description: "'multiple_choice' or 'true_false'" },
                options: { type: "ARRAY", items: { type: "STRING" } }
              }
            }
          }
        },
        required: ["mode"]
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
    const { history, prompt, context } = await req.json();

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const PINECONE_API_KEY = Deno.env.get('PINECONE_API_KEY');
    const PINECONE_HOST = Deno.env.get('PINECONE_INDEX_HOST');

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

    const executedTools: string[] = [];
    let uiCommand = null;
    let isToolCall = true;
    let loopCount = 0;
    let finalText = "";
    let inlineSnapshots: any[] = [];
    let inlineQuizzes: any[] = [];

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
                const { data } = await supabase.from('books').select('id');
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
              
              const { data, error } = await supabase.from('books')
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
                  
                  // Sibling-aware / Depth-aware slice: ignore children, stop only at same depth or higher level parent
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

    return new Response(JSON.stringify({ 
      response: finalText,
      thoughts: [],
      ui_command: uiCommand,
      snapshots: inlineSnapshots,
      quizzes: inlineQuizzes
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error(`[MIRON FATAL] ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});