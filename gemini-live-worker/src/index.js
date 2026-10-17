import { getEncoding } from "js-tiktoken";

// ==============================================================================
// THE STATEFUL DURABLE OBJECT VOICE AGENT (BARE METAL WEBSOCKET HIBERNATION)
// ==============================================================================

const sanitizeForSpeech = (txt) => {
    if (!txt) return "";
    return txt.replace(/\[print\]/gi, '').replace(/\{[uhpbit]\}/gi, '');
};

const GREETING_TEMPLATES = {
  male: [
    "ሰላም ${name}፣ እንዴት ነህ? ዛሬ አብረን እንድናጠና የምትፈልገውን ኮርስ ከታች ምረጥ።",
    "እንዴት ነህ ${name}። የምናጠናውን ኮርስ ምረጥ።",
    "እንኳን ደህና መጣህ ${name}። ዛሬ ምንድነው ምናጠናው?",
    "${name}፣ ደህና ነህ? ዛሬ ምን እናጥና? መምረጥ ትችላለህ።",
    "ሰላም ${name}! ዛሬ በምን ኮርስ እንጀምር?",
    "እንኳን ደህና መጣህ ${name}! ዛሬ አዲስ ነገር ለመማር ዝግጁ ነህ? ከታች ምረጥ።",
    "ሰላም ${name}! ዛሬ ምን እናጠና?",
    "እንዴት ነህ ${name}! ዛሬ ከእኔ ጋር የምታጠናው ኮርስ የየትኛው ነው?",
    "ሰላም ${name}! ዛሬ የትኛው ኮርስ ላይ እንወጥር?",
    "ሰላም ${name}! ዛሬ ጥናታችንን በምን እንጀምር? የሚመችህን ኮርስ ምረጥ።",
    "ሰላም ${name}! ዛሬ ፈታኝ የሆነውን ኮርስ ለመጋፈጥ ዝግጁ ነህ? ከታች ምረጥ!"
  ],
  female: [
    "ሰላም ${name}፣ እንዴት ነሽ? ዛሬ አብረን እንድናጠና የምትፈልጊውን ኮርስ ከታች ምረጪ።",
    "እንዴት ነሽ ${name}። የምናጠናውን ኮርስ ምረጪ።",
    "እንኳን ደህና መጣሽ ${name}። ዛሬ ምንድነው ምናጠናው?",
    "${name}፣ ደህና ነሽ? ዛሬ ምን እናጥና? መምረጥ ትችያለሽ።",
    "ሰላም ${name}! ዛሬ በምን ኮርስ እንጀምር?",
    "እንኳን ደህና መጣሽ ${name}! ዛሬ አዲስ ነገር ለመማር ዝግጁ ነሽ? ከታች ምረጪ።",
    "ሰላም ${name}! ዛሬ ምን እናጠና?",
    "እንዴት ነሽ ${name}! ዛሬ ከእኔ ጋር የምታጠኚው ኮርስ የየትኛው ነው?",
    "ሰላም ${name}! ዛሬ የትኛው ኮርስ ላይ እንወጥር?",
    "ሰላም ${name}! ዛሬ ጥናታችንን በምን እንጀምር? የሚመችሽን ኮርስ ምረጪ።",
    "ሰላም ${name}! ዛሬ ፈታኝ የሆነውን ኮርስ ለመጋፈጥ ዝግጁ ነሽ? ከታች ምረጪ!"
  ],
  neutral: [
    "ሰላም ${name}! ዛሬ በምን ኮርስ እንጀምር?",
    "ሰላም ${name}! ዛሬ ምን እናጠና?",
    "ሰላም ${name}! ዛሬ የትኛው ኮርስ ላይ እንወጥር?"
  ]
};

function pickGreeting(name, sex) {
  const s = (sex || "").toLowerCase();
  let list = GREETING_TEMPLATES.neutral;
  if (s === 'male' || s === 'm') {
    list = GREETING_TEMPLATES.male;
  } else if (s === 'female' || s === 'f') {
    list = GREETING_TEMPLATES.female;
  }
  const chosen = list[Math.floor(Math.random() * list.length)];
  return chosen.replace(/\$\{name\}/g, name || 'Scholar');
}

const COURSE_SELECTION_TEMPLATES = {
  male: [
    "መልካም! አሁን ደግሞ እንድናጠና የምትፈልገውን ሴክሽን ምረጥ።",
    "እሺ ${course}ን መርጠሃል። አሁን ደግሞ እንድናጠና የምትፈልገውን ምዕራፍ ወይም ሴክሽን ምረጥ።",
    "${course} ጥሩ ምርጫ ነው። ከ${course} ውስጥ የትኛውን ሴክሽን ነው ማጥናት የምትፈልገው?",
    "አሪፍ! አሁን ደግሞ ከ${course} ውስጥ የምንጀምርበትን ምዕራፍ ምረጥ።",
    "መልካም! ${course}ን ይዘናል። አሁን የትኛውን ሴክሽን እናጥና?",
    "ተመችቶኛል! ${course}ን ለመጨረስ ዝግጁ ነን። ከየትኛው ሴክሽን እንጀምር?",
    "በጣም ጥሩ! አሁን ከ${course} የምትፈልገውን ምዕራፍ ወይም ሴክሽን ምረጥ።",
    "እሺ ${course}ን መርጠሃል። ቀጥሎ የምናጠናውን ሴክሽን ምረጥ።"
  ],
  female: [
    "መልካም! አሁን ደግሞ እንድናጠና የምትፈልጊውን ሴክሽን ምረጪ።",
    "እሺ ${course}ን መርጠሻል። አሁን ደግሞ እንድናጠና የምትፈልጊውን ምዕራፍ ወይም ሴክሽን ምረጪ።",
    "${course} ጥሩ ምርጫ ነው። ከ${course} ውስጥ የትኛውን ሴክሽን ነው ማጥናት የምትፈልጊው?",
    "አሪፍ! አሁን ደግሞ ከ${course} ውስጥ የምንጀምርበትን ምዕራፍ ምረጪ።",
    "መልካም! ${course}ን ይዘናል። አሁን የትኛውን ሴክሽን እናጥና?",
    "ተመችቶኛል! ${course}ን ለመጨረስ ዝግጁ ነን። ከየትኛው ሴክሽን እንጀምር?",
    "በጣም ጥሩ! አሁን ከ${course} የምትፈልጊውን ምዕራፍ ወይም ሴክሽን ምረጪ።",
    "እሺ ${course}ን መርጠሻል። ቀጥሎ የምናጠናውን ሴክሽን ምረጪ።"
  ],
  neutral: [
    "መልካም! ${course}ን ይዘናል። አሁን የትኛውን ሴክሽን እናጥና?",
    "ተመችቶኛል! ${course}ን ለመጨረስ ዝግጁ ነን። ከየትኛው ሴክሽን እንጀምር?"
  ]
};

function pickCourseResponse(course, sex) {
  const s = (sex || "").toLowerCase();
  let list = COURSE_SELECTION_TEMPLATES.neutral;
  if (s === 'male' || s === 'm') {
    list = COURSE_SELECTION_TEMPLATES.male;
  } else if (s === 'female' || s === 'f') {
    list = COURSE_SELECTION_TEMPLATES.female;
  }
  const chosen = list[Math.floor(Math.random() * list.length)];
  return chosen.replace(/\$\{course\}/g, course || 'ትምህርቱን');
}

const GENERIC_STOP_WORDS = new Set([
  'chapter', 'section', 'unit', 'module', 'part', 'topic', 'lesson',
  'overview', 'introduction', 'summary', 'review', 'exercises', 'questions',
  'problems', 'references', 'appendix', 'the', 'and', 'of', 'in', 'to',
  'for', 'a', 'an', 'on', 'with', 'by', 'about'
]);

const NUMBER_WORD_MAP = {
  'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5',
  'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10',
  'eleven': '11', 'twelve': '12', 'thirteen': '13', 'fourteen': '14', 'fifteen': '15',
  'sixteen': '16', 'seventeen': '17', 'eighteen': '18', 'nineteen': '19', 'twenty': '20',
  'i': '1', 'ii': '2', 'iii': '3', 'iv': '4', 'v': '5',
  'vi': '6', 'vii': '7', 'viii': '8', 'ix': '9', 'x': '10',
  'xi': '11', 'xii': '12', 'xiii': '13', 'xiv': '14', 'xv': '15',
  'xvi': '16', 'xvii': '17', 'xviii': '18', 'xix': '19', 'xx': '20'
};

const GROQ_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_book_toc",
      description: "Fetch the Table of Contents of a specific university course book.",
      parameters: {
        type: "object",
        properties: {
          course_code: { type: "string", description: "The course code (e.g. 'PHYS 1011', 'LOCT 1011', 'BIOL 1012', 'CHEM 1012', etc.)" }
        },
        required: ["course_code"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_book_section",
      description: "Read the full text of a specific chapter or section from the course book.",
      parameters: {
        type: "object",
        properties: {
          course_code: { type: "string", description: "The course code (e.g. 'PHYS 1011')" },
          section_title: { type: "string", description: "Exact title of the section from the TOC" }
        },
        required: ["course_code", "section_title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_book_page",
      description: "Read the text of a specific page or range of pages from the course book.",
      parameters: {
        type: "object",
        properties: {
          course_code: { type: "string", description: "The course code (e.g. 'PHYS 1011')" },
          start_page: { type: "integer", description: "Starting page number" },
          end_page: { type: "integer", description: "Optional ending page number" }
        },
        required: ["course_code", "start_page"]
      }
    }
  }
];

function normalizeTextTokens(str) {
  if (!str) return [];
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(t => NUMBER_WORD_MAP[t] || t);
}

function calculateStringSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;
  const l1 = s1.length, l2 = s2.length;
  const matrix = Array.from({ length: l1 + 1 }, () => new Array(l2 + 1).fill(0));
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

function findBestMatchingTocNode(tocTree, rawQuery, confidenceThreshold = 0.80) {
  if (!tocTree || !Array.isArray(tocTree) || !rawQuery) return null;

  const flatList = [];
  function flatten(nodes, parentTitle = null, chapterNum = null, depth = 0) {
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

  const scored = [];

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

const MIRON_MASTER_BASE = `You are Miron, an expert university peer tutor and a dedicated study partner to \${studentName}. You are conducting an interactive 1-on-1 voice study session.

AUTHENTIC TONE & COMPLETE IMMERSION:
- Maintain an authentic, normal peer tone—grounded, natural, articulate, and direct. Avoid exaggerated slang or forced casualness.
- NEVER mention, speak, or write course codes (e.g., 'PHYS 1011', 'BIOL 1012') to \${studentName}. Refer to all courses strictly by their friendly names (e.g., 'Physics', 'General Biology'). Course codes are strictly for internal tool function calls.
- NEVER reveal background operations. Never say or imply you are pulling context, reading pages, inspecting the Table of Contents (TOC), executing calls, or looking things up. Execute all tool operations completely silently and deliver the content directly.

COURSE CATALOG:
You have access to textbooks for the following courses:
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

STUDY WORKFLOW & THE DEEP GRIND PROTOCOL:
- Natural Course Mapping: Deduce the relevant course from context (e.g., "Physics" -> "PHYS 1011").
- The Prepared Partner Posture: When the student mentions a subject, act like an elite classmate who already has the book open. Silently call "get_book_toc" to review the curriculum, then outline the major chapters so the student can pick where to start.
- Never Ask What Is in the Book: Silently retrieve what you need using the tools. Refer naturally to the book and page number as an orienting anchor.

THE DECONSTRUCTION DOCTRINE (NO SURFACE-LEVEL DEFINITIONS):
- NEVER just state a definition or translate a heading.
- Dissect every concept into its anatomical pillars. Break down every single component in depth.
- Walk through concrete, real-life scenarios showing how those components interact.

SUBSTANTIAL YET PACED EXPLANATIONS:
- Deliver rich, comprehensive mini-lectures that drain the nuance of the specific concept.
- Maintain conversational flow. Do not output massive walls of text.

BAN LAZY CHECK-INS & ESCAPE HATCHES:
- NEVER end an explanation with lazy pass-the-mic questions like "Is that clear?", "Do you understand?", or "Any questions?".
- Instead, conclude by challenging \${studentName} with an active thought experiment or an application question based directly on the deep explanation you just gave.

THE SECTION GRIND (ONE CHUNK AT A TIME):
When studying a section from "read_book_section":
1. The Overview Map: Provide a generous overview of what the entire section covers to set context.
2. Isolate Chunk #1: Immediately latch onto the very first concept. Apply the Deconstruction Doctrine fully. Do NOT touch Chunk #2 yet.
3. Application Challenge: Conclude Chunk #1 with an active, thought-provoking application challenge.
4. Hold Ground: Stay on that specific concept, discussing and clarifying it, until \${studentName} demonstrates understanding or explicitly asks to move on.`;

export class GeminiLiveAgent {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.geminiWs = null;
    this.isInitializingGemini = false;
    this.isGeminiSetupComplete = false;
    this.messageQueue = [];
    this.heartbeatTimer = null;
    this.conversationId = null;
    
    // Stateful Playback Engine
    this.readingQueue = [];
    this.currentChunkIndex = 0;
    this.stageState = "idle"; // "idle" | "reading" | "answering_qa" | "resuming_lecture"
    
    this.questionBucket = [];
    this.pendingAnswersQueue = [];
    this.lastAnsweredTime = Date.now();
    this.qaTimer = null;
    this.cleanupTimeout = null;

    // --- MISSION CONTROL & COGNITION STATE ---
    this.logRing = [];
    this.sseClients = new Set();
    this.activeRooms = new Map();
    this.groqChatHistory = [];
    this.tokenizer = null;
    this.currentBookId = null;
    this.currentCourseCode = null;
    this.lastPromptTokens = 0;
    this.userSex = null;
    this.hasGreeted = false;
    this.pendingTemplateSpeech = null;
    this.isSpeakingTemplate = false;
    this.isGeneratingSectionSummary = false;
    this.userSex = null;
    this.hasGreeted = false;
    this.pendingTemplateSpeech = null;
    this.isSpeakingTemplate = false;
    this.isGeneratingSectionSummary = false;

    // --- 1-ON-1 COGNITIVE PIPELINE STATE (GROQ BRAIN + GEMINI VOICE) ---
    this.pendingUserSpeech = "";
    this.speechDebounceTimer = null;
    this.translationQueue = [];
    this.isGeminiTranslating = false;
    this.isGeminiFallbackActive = false;

    // Restore persistent log ring and active rooms across DO hibernation
    this.ctx.blockConcurrencyWhile(async () => {
      try {
        const storedLogs = await this.ctx.storage.get('log_ring');
        if (storedLogs && Array.isArray(storedLogs)) {
          this.logRing = storedLogs;
        }
        const storedRooms = await this.ctx.storage.get('active_rooms');
        if (storedRooms && Array.isArray(storedRooms)) {
          this.activeRooms = new Map(storedRooms);
        }
      } catch (e) {}
    });
    
    console.log(`[Agent|DO|INIT] 🏗️ Native Constructor initialized.`);
  }

  notifyRegistry(action, payload) {
    if (!this.env?.GeminiLiveAgent) return;
    this.ctx.waitUntil((async () => {
      try {
        const globalId = this.env.GeminiLiveAgent.idFromName("debug-global");
        const globalStub = this.env.GeminiLiveAgent.get(globalId);
        await globalStub.fetch(`https://gemini-live-worker/registry-${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (e) {}
    })());
  }

  emitLog(category, message, meta = {}) {
    const entry = {
      id: crypto.randomUUID(),
      time: new Date().toLocaleTimeString(),
      category,
      message,
      meta
    };
    this.logRing.push(entry);
    if (this.logRing.length > 150) this.logRing.shift();
    this.ctx.waitUntil(this.ctx.storage.put('log_ring', this.logRing));

    const sseMsg = `data: ${JSON.stringify(entry)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.writer.write(new TextEncoder().encode(sseMsg));
      } catch (e) {
        this.sseClients.delete(client);
      }
    }
    console.log(`[Agent|${category}] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');

    // God-Mode Relay: Mirror log to debug-global so global inspector sees all active traffic
    if (this.conversationId && this.conversationId !== 'debug-global' && this.env?.GeminiLiveAgent) {
      this.ctx.waitUntil((async () => {
        try {
          const globalId = this.env.GeminiLiveAgent.idFromName("debug-global");
          const globalStub = this.env.GeminiLiveAgent.get(globalId);
          await globalStub.fetch("https://gemini-live-worker/internal-log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entry: {
                ...entry,
                room: this.conversationId,
                student: this.studentName || 'Scholar'
              }
            })
          });
        } catch (e) {}
      })());
    }
  }

  countTokens(text) {
    if (!text) return 0;
    if (!this.tokenizer) {
      try { this.tokenizer = getEncoding("o200k_base"); }
      catch (e) { this.tokenizer = getEncoding("cl100k_base"); }
    }
    return this.tokenizer.encode(text).length;
  }

  sliceTextToTokenBudget(text, maxTokens, continuationNotice = "") {
    if (!this.tokenizer) {
      try { this.tokenizer = getEncoding("o200k_base"); }
      catch (e) { this.tokenizer = getEncoding("cl100k_base"); }
    }
    const tokens = this.tokenizer.encode(text);
    if (tokens.length <= maxTokens) {
      return { text, originalTokens: tokens.length, finalTokens: tokens.length, isSliced: false };
    }

    const noticeTokens = continuationNotice ? this.tokenizer.encode(continuationNotice).length : 0;
    const targetSlice = Math.max(0, maxTokens - noticeTokens);
    const sliced = tokens.slice(0, targetSlice);
    const decoded = this.tokenizer.decode(sliced) + continuationNotice;
    const finalTokens = targetSlice + noticeTokens;
    const tokensRemoved = tokens.length - finalTokens;

    this.emitLog("SLICER", `✂️ Sliced textbook payload: ${tokens.length} -> ${finalTokens} tokens (-${tokensRemoved} tokens trimmed for TPM budget)`, {
      original_tokens: tokens.length,
      final_tokens: finalTokens,
      tokens_saved: tokensRemoved,
      max_budget: maxTokens
    });

    return {
      text: decoded,
      originalTokens: tokens.length,
      finalTokens,
      isSliced: true
    };
  }

  async leaseGroqKey() {
    const supabaseUrl = this.env?.SUPABASE_URL;
    const serviceKey = this.env?.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/lease_groq_api_key`, {
      method: 'POST',
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error(`Groq Key Lease Failed: ${await res.text()}`);
    const rows = await res.json();
    if (!rows || rows.length === 0 || !rows[0].api_key) throw new Error("No active Groq API keys available");
    return { id: rows[0].id, apiKey: rows[0].api_key };
  }

  async cooldownGroqKey(keyId, seconds = 60) {
    try {
      const supabaseUrl = this.env?.SUPABASE_URL;
      const serviceKey = this.env?.SUPABASE_SERVICE_ROLE_KEY;
      await fetch(`${supabaseUrl}/rest/v1/rpc/cooldown_groq_api_key`, {
        method: 'POST',
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_id: keyId, p_seconds: seconds })
      });
      this.emitLog("GROQ", `⚠️ Groq Key #${keyId} placed on ${seconds}s cooldown.`, { keyId });
    } catch (e) {
      console.error("[Agent|Groq|Cooldown]", e.message);
    }
  }

  speakPreformattedAmharic(amharicText) {
    if (!amharicText) return;
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN || !this.isGeminiSetupComplete) {
      console.log("[Agent|DO|TEMPLATE] Upstream not ready yet. Queuing preformatted speech.");
      this.pendingTemplateSpeech = amharicText;
      return;
    }

    this.isSpeakingTemplate = true;
    const prompt = `[VOICE SYNTHESIS DIRECTIVE] Read and speak the following exact Amharic text aloud to ${this.studentName} with an authentic, warm, and natural university peer tone. Do NOT translate into English or any other language. Do NOT add introductory or concluding commentary. Speak only these exact Amharic words:\n\n${amharicText}`;

    const payload = JSON.stringify({
      clientContent: {
        turns: [{ role: "user", parts: [{ text: prompt }] }],
        turnComplete: true
      }
    });

    this.geminiWs.send(payload);
    this.broadcast(JSON.stringify({
      type: "miron_thought",
      text: amharicText
    }));
    this.emitLog("GEMINI", `🎙️ Spoke preformatted Amharic template: "${amharicText}"`);
  }

  processTranslationQueue() {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN || !this.isGeminiSetupComplete) return;
    if (this.isGeminiTranslating || this.translationQueue.length === 0) return;

    const chunk = this.translationQueue.shift();
    this.isGeminiTranslating = true;
    
    const prompt = `Translate and speak the following explanation in natural, authentic Amharic (using the Ge'ez/Fidel alphabet) with a normal, grounded peer tone, blended smoothly with English technical terms to ${this.studentName}. Sound like an authentic university peer studying together in an authentic normal tone. Speak the translation directly:\n\n${chunk}`;
    
    const payload = JSON.stringify({
        clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true }
    });
    
    this.geminiWs.send(payload);
    this.emitLog("GEMINI", `Translating chunk (${chunk.length} chars). ${this.translationQueue.length} chunks remaining.`);
  }

  async executeTool(name, args) {
    this.broadcast(JSON.stringify({ type: "tool_call_state", executing: true }));
    const authHeaders = {
      'apikey': this.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`
    };

    const fetchWithTimeout = async (url, options = {}, timeoutMs = 2500) => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
      } catch (err) {
        clearTimeout(id);
        throw err;
      }
    };

    let result = {};
    try {
      if (name === "get_book_toc") {
        const code = (args.course_code || "").toUpperCase().trim();
        const res = await fetchWithTimeout(`${this.env.SUPABASE_URL}/rest/v1/books?course_code=eq.${code}&is_published=eq.true&select=id,title,toc,page_offset`, { headers: authHeaders });
        const json = await res.json();
        if (json && json.length > 0) {
          const tocTokens = this.countTokens(JSON.stringify(json[0].toc || []));
          result = { status: "success", book_id: json[0].id, title: json[0].title, page_offset: json[0].page_offset || 0, toc: json[0].toc, tokens: tocTokens };
        } else {
          result = { status: "error", message: `Book for course ${code} not found.` };
        }
      } else if (name === "read_book_section") {
        const code = (args.course_code || "").toUpperCase().trim();
        const res = await fetchWithTimeout(`${this.env.SUPABASE_URL}/rest/v1/books?course_code=eq.${code}&is_published=eq.true&select=id,toc,page_offset`, { headers: authHeaders });
        const json = await res.json();
        
        if (json && json.length > 0 && json[0].toc) {
          const bookId = json[0].id;
          const offset = json[0].page_offset || 0;
          const matchResult = findBestMatchingTocNode(json[0].toc, args.section_title, 0.80);

          if (matchResult) {
            const { matchedItem, flatList } = matchResult;
            const startPage = matchedItem.page;
            const targetDepth = matchedItem.depth;
            let endPage = 99999;
            for (let i = matchedItem.originalIndex + 1; i < flatList.length; i++) {
              const candidate = flatList[i];
              if (candidate.depth <= targetDepth && candidate.page && candidate.page > startPage) {
                endPage = candidate.page;
                break;
              }
            }

            const physicalStart = Math.max(1, startPage + offset);
            const physicalEnd = endPage === 99999 ? 99999 : Math.max(1, endPage + offset);

            const pageRes = await fetchWithTimeout(`${this.env.SUPABASE_URL}/rest/v1/book_pages?book_id=eq.${bookId}&page_number=gte.${physicalStart}&page_number=lt.${physicalEnd}&select=page_number,content_json&order=page_number.asc`, { headers: authHeaders });
            const pages = await pageRes.json();
            
            const extractTextFromBlockArray = (blocks) => {
              return (blocks || []).map(b => {
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
            };

            const rawSectionText = (pages || []).map(p => `--- PAGE ${p.page_number} ---\n` + extractTextFromBlockArray(p.content_json || [])).join("\n\n");
            const sliced = this.sliceTextToTokenBudget(rawSectionText, 2200, "\n\n[...Section content truncated to protect TPM budget...]");
            result = { 
              status: "success", 
              matched_section: matchedItem.title,
              breadcrumb: matchedItem.breadcrumb,
              text: sliced.text || "Section is empty.",
              tokens: sliced.finalTokens,
              original_tokens: sliced.originalTokens,
              is_sliced: sliced.isSliced
            };
          } else {
            result = { status: "error", message: `Section "${args.section_title}" not found in TOC with sufficient confidence (>=80%).` };
          }
        } else {
          result = { status: "error", message: "Course book not found." };
        }
      } else if (name === "read_book_page") {
        const code = (args.course_code || "").toUpperCase().trim();
        const start = args.start_page;
        const end = args.end_page || (start + 1);

        const res = await fetchWithTimeout(`${this.env.SUPABASE_URL}/rest/v1/books?course_code=eq.${code}&is_published=eq.true&select=id,page_offset`, { headers: authHeaders });
        const json = await res.json();

        if (json && json.length > 0) {
          const bookId = json[0].id;
          const offset = json[0].page_offset || 0;
          const physicalStart = Math.max(1, start + offset);
          const physicalEnd = Math.max(1, end + offset);

          const pageRes = await fetchWithTimeout(`${this.env.SUPABASE_URL}/rest/v1/book_pages?book_id=eq.${bookId}&page_number=gte.${physicalStart}&page_number=lte.${physicalEnd}&select=page_number,content_json&order=page_number.asc`, { headers: authHeaders });
          const pages = await pageRes.json();

          const extractTextFromBlockArray = (blocks) => {
            return (blocks || []).map(b => {
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
          };

          const rawSectionText = (pages || []).map(p => `--- PAGE ${p.page_number} ---\n` + extractTextFromBlockArray(p.content_json || [])).join("\n\n");
          const sliced = this.sliceTextToTokenBudget(rawSectionText, 2200, "\n\n[...Pages content truncated to protect TPM budget...]");
          result = { 
            status: "success", 
            text: sliced.text || "Pages are empty or do not exist.",
            tokens: sliced.finalTokens,
            original_tokens: sliced.originalTokens,
            is_sliced: sliced.isSliced
          };
        } else {
          result = { status: "error", message: "Course book not found." };
        }
      }
    } catch (err) {
      result = { status: "error", message: err.message };
    } finally {
      this.broadcast(JSON.stringify({ type: "tool_call_state", executing: false }));
    }
    return result;
  }

  async executeGroqCognitiveTurn(userMsg) {
    if (!userMsg || !userMsg.trim()) return;

    try {
      this.emitLog("GROQ", `Cognitive turn initiated for: "${userMsg.slice(0, 100)}"`);

      const { id: keyId, apiKey } = await this.leaseGroqKey();

      this.groqChatHistory.push({ role: "user", content: userMsg });

      const systemPrompt = MIRON_MASTER_BASE.replace(/\$\{studentName\}/g, this.studentName) + `

      CRITICAL LINGUISTIC & FORMATTING RULES (PRIMARY BRAIN):
- Authentic, Normal Tone: Speak in an authentic, normal peer tone—clear, articulate, grounded, and engaging. Do not use forced casual slang or overly hype speech.
- STRICT COURSE NAME RULE: NEVER mention, write, or reveal course codes (e.g. 'PHYS 1011', 'BIOL 1012') in your speech. Always use the friendly, natural course name (e.g. 'Physics', 'Biology'). Course codes are strictly for internal tool arguments.
- NO 4TH-WALL OR BACKEND EXPOSURE: NEVER reveal what you are doing behind the scenes. Never mention checking the Table of Contents, pulling textbook pages, seeing the TOC, querying functions, or retrieving context. Present the material directly as natural knowledge.
- Formulate your entire response in clear, concise English. Do NOT generate in Amharic script.
- CHUNKING ARCHITECTURE:
  * Wrap spoken units in <chunk>...</chunk> tags.
  * SINGLE CHUNK RULE: If your response is simple or short (such as a greeting, short introduction, brief acknowledgment, quick answer, or concise summary), DO NOT break it into multiple chunks. Put the entire message inside a SINGLE <chunk>...</chunk>.
  * MULTI-CHUNK RULE: Multiple chunks are reserved strictly for long, substantial explanations, deep breakdowns, or concept drills (each chunk being 1-2 paced sentences).
- DO NOT use JSON. DO NOT invoke or hallucinate a function/tool named "JSON" or "response". Write raw conversational English with <chunk> tags directly in your message body.

EXAMPLE SHORT OUTPUT:
<chunk>Hey ${this.studentName}, welcome back! What topic in Physics would you like to dive into today?</chunk>

EXAMPLE DEEP DRILL OUTPUT:
<chunk>Let's break down gravitational potential energy step by step.</chunk>
<chunk>When you lift an object against gravity, the work you do gets stored as potential energy in the gravitational field.</chunk>
<chunk>If we double the height while keeping the mass constant, what happens to that stored energy?</chunk>`;

      let totalTokens = this.countTokens(systemPrompt);
      const contextualMessages = [];

      for (let i = this.groqChatHistory.length - 1; i >= 0; i--) {
        const msg = this.groqChatHistory[i];
        const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
        const msgTokens = this.countTokens(contentStr);
        if (totalTokens + msgTokens > 5500) break;
        totalTokens += msgTokens;
        contextualMessages.unshift(msg);
      }

      let currentMessages = [
        { role: "system", content: systemPrompt },
        ...contextualMessages
      ];

      const callGroqWithAudit = async (msgs, roundLabel = "Turn 1") => {
        let messageTokenSum = 0;
        const breakdown = msgs.map(m => {
          let contentStr = "";
          if (typeof m.content === 'string') {
            contentStr = m.content;
          } else if (m.tool_calls) {
            contentStr = JSON.stringify(m.tool_calls);
          } else {
            contentStr = JSON.stringify(m.content || '');
          }
          const t = this.countTokens(contentStr);
          messageTokenSum += t;
          return { role: m.role, tokens: t };
        });

        // Account for hidden function schemas injected into the prompt by Groq
        const toolSchemasTokens = this.countTokens(JSON.stringify(GROQ_TOOLS));
        const estimatedTotalPrompt = messageTokenSum + toolSchemasTokens;

        this.lastPromptTokens = estimatedTotalPrompt;
        this.emitLog("TIKTOKEN", `[${roundLabel}] Pre-Flight Audit: ${estimatedTotalPrompt} tokens (Messages: ${messageTokenSum} | Tool Schemas: ${toolSchemasTokens})`, {
          tokens: estimatedTotalPrompt,
          round: roundLabel,
          estimated_prompt_tokens: estimatedTotalPrompt,
          messages_tokens: messageTokenSum,
          tools_schema_tokens: toolSchemasTokens,
          message_breakdown: breakdown
        });

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "openai/gpt-oss-20b",
            messages: msgs,
            tools: GROQ_TOOLS,
            tool_choice: "auto",
            temperature: 0.7,
            max_tokens: 1024
          })
        });

        if (!response.ok) {
          const errText = await response.text();

          if (response.status === 429) {
            await this.cooldownGroqKey(keyId, 60);

            const rateLimitMeta = {
              status: 429,
              round: roundLabel,
              injected_tokens: promptTokenSum,
              retry_after: response.headers.get("retry-after") || "N/A",
              limit_tokens: response.headers.get("x-ratelimit-limit-tokens") || "N/A",
              remaining_tokens: response.headers.get("x-ratelimit-remaining-tokens") || "N/A",
              reset_tokens: response.headers.get("x-ratelimit-reset-tokens") || "N/A"
            };

            try {
              const parsedErr = JSON.parse(errText);
              rateLimitMeta.raw_error = parsedErr;
              const errMsg = parsedErr?.error?.message || "";
              const limitMatch = errMsg.match(/Limit\s*(\d+)/i);
              const reqMatch = errMsg.match(/Requested\s*(\d+)/i);
              const usedMatch = errMsg.match(/Used\s*(\d+)/i);
              if (limitMatch) rateLimitMeta.parsed_limit = parseInt(limitMatch[1], 10);
              if (reqMatch) rateLimitMeta.parsed_requested = parseInt(reqMatch[1], 10);
              if (usedMatch) rateLimitMeta.parsed_used = parseInt(usedMatch[1], 10);
              if (limitMatch && reqMatch) {
                rateLimitMeta.overage = rateLimitMeta.parsed_requested - rateLimitMeta.parsed_limit;
              }
            } catch (e) {
              rateLimitMeta.raw_error_text = errText;
            }

            this.emitLog("RATE_LIMIT", `🚨 429 TPM Limit Exceeded on ${roundLabel}! Requested: ${rateLimitMeta.parsed_requested || promptTokenSum} tokens`, rateLimitMeta);
          }

          // Salvage Attempt: Recover text if Groq threw a tool error but generated valid spoken content
          try {
            const errJson = JSON.parse(errText);
            const fg = errJson?.error?.failed_generation;
            if (fg) {
              let salvagedChunks = [];
              const fgMatches = [...fg.matchAll(/<chunk>([\s\S]*?)<\/chunk>/gi)];
              if (fgMatches.length > 0) {
                salvagedChunks = fgMatches.map(m => m[1].trim()).filter(Boolean);
              } else {
                try {
                  const parsedFg = JSON.parse(fg);
                  if (Array.isArray(parsedFg.arguments?.spoken_chunks)) {
                    salvagedChunks = parsedFg.arguments.spoken_chunks;
                  }
                } catch (e) {}
              }
              if (salvagedChunks.length > 0) {
                this.emitLog("GROQ", `Salvaged ${salvagedChunks.length} chunks from failed generation.`);
                const sanitizedChunks = salvagedChunks.map(c => sanitizeForSpeech(c)).filter(Boolean);
                this.broadcast(JSON.stringify({
                  type: "miron_thought",
                  text: sanitizedChunks.join(' ')
                }));
                this.translationQueue.push(...sanitizedChunks);
                this.processTranslationQueue();
                return { isSalvaged: true };
              }
            }
          } catch (salvageErr) {}

          throw new Error(`Groq API error ${response.status}: ${errText}`);
        }

        const resData = await response.json();
        const usage = resData.usage || {};

        if (usage.prompt_tokens !== undefined) {
          const delta = usage.prompt_tokens - estimatedTotalPrompt;
          const matchPercent = (100 - (Math.abs(delta) / usage.prompt_tokens) * 100).toFixed(1);

          this.emitLog("TIKTOKEN", `[${roundLabel} Verification] Groq Actual: ${usage.prompt_tokens} vs Tiktoken Est: ${estimatedTotalPrompt} (Delta: ${delta >= 0 ? '+' : ''}${delta} tokens | ${matchPercent}% accuracy)`, {
            round: roundLabel,
            tokens: usage.total_tokens || usage.prompt_tokens,
            groq_prompt_tokens: usage.prompt_tokens,
            tiktoken_estimated_prompt: estimatedTotalPrompt,
            delta_tokens: delta,
            accuracy: `${matchPercent}%`,
            groq_completion_tokens: usage.completion_tokens,
            groq_total_tokens: usage.total_tokens
          });
        }

        return resData;
      };

      let data = await callGroqWithAudit(currentMessages, "Turn 1 (Initial Prompt)");
      if (data?.isSalvaged) return;

      let choice = data.choices?.[0];

      // Handle function / tool calling loop (up to 2 rounds)
      let toolRounds = 0;
      while (choice?.message?.tool_calls && choice.message.tool_calls.length > 0 && toolRounds < 2) {
        toolRounds++;
        const toolCalls = choice.message.tool_calls;
        currentMessages.push(choice.message);

        for (const tc of toolCalls) {
          const fnName = tc.function.name;
          let fnArgs = {};
          try { fnArgs = JSON.parse(tc.function.arguments); } catch(e){}
          this.emitLog("TOOL", `Executing tool: ${fnName}`, fnArgs);
          
          const toolResult = await this.executeTool(fnName, fnArgs);
          
          if (toolResult.status === "error") {
            this.emitLog("ERROR", `Tool [${fnName}] failed: ${toolResult.message}`);
          } else {
            this.emitLog("TOOL", `Tool [${fnName}] succeeded (${toolResult.tokens || 0} tokens).`, { 
              tokens: toolResult.tokens,
              original_tokens: toolResult.original_tokens,
              is_sliced: toolResult.is_sliced,
              preview: (toolResult.text || "").substring(0, 200) + "..." 
            });
          }

          currentMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: fnName,
            content: JSON.stringify(toolResult)
          });
        }

        data = await callGroqWithAudit(currentMessages, `Turn ${toolRounds + 1} (Tool Response)`);
        if (data?.isSalvaged) return;
        choice = data.choices?.[0];
      }

      const rawContent = choice?.message?.content || "";
      const usage = data.usage || {};
      const finalTokens = usage.total_tokens || (totalTokens + this.countTokens(rawContent));

      if (rawContent) {
        this.groqChatHistory.push({ role: "assistant", content: rawContent });

        let chunks = [];
        const chunkRegex = /<chunk>([\s\S]*?)<\/chunk>/gi;
        let cMatch;
        while ((cMatch = chunkRegex.exec(rawContent)) !== null) {
            const trimmed = cMatch[1].trim();
            if (trimmed) chunks.push(trimmed);
        }

        // Bulletproof Fallback: If model omitted <chunk> tags, split naturally on paragraph breaks
        if (chunks.length === 0) {
            const cleanRaw = rawContent.replace(/<[^>]+>/g, '').trim();
            chunks = cleanRaw.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
        }

        const sanitizedChunks = chunks.map(c => sanitizeForSpeech(c)).filter(Boolean);
        const promptCount = usage.prompt_tokens || totalTokens;
        const completionCount = usage.completion_tokens || this.countTokens(rawContent);

        this.emitLog("GROQ", `Cognitive response generated: ${finalTokens} tokens total (Prompt: ${promptCount} | Generated Output: ${completionCount}) across ${sanitizedChunks.length} spoken chunks.`, { 
          tokens: finalTokens,
          prompt_tokens: promptCount,
          completion_tokens: completionCount,
          spoken_chunks_count: sanitizedChunks.length
        });

        this.broadcast(JSON.stringify({
          type: "miron_thought",
          text: sanitizedChunks.join(' ')
        }));

        this.translationQueue.push(...sanitizedChunks);
        
        // Trigger the queue loop
        this.processTranslationQueue();
      }
    } catch (e) {
      this.translationQueue = [];
      this.isGeminiTranslating = false;
      this.emitLog("ERROR", `Cognitive turn failed: ${e.message}. Engaging Gemini fallback.`, { error: e.message });
      console.error("[Agent|Groq|CognitiveTurn]", e.message);

      // --- FALLBACK TO GEMINI ---
      // If Groq fails, Gemini abandons translation-only mode and temporarily assumes the Master Brain role.
      if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN && this.isGeminiSetupComplete) {
        this.isGeminiFallbackActive = true;
        const fallbackInstruction = `[SYSTEM ALERT: The primary cognitive brain has disconnected. You must immediately take over full reasoning capabilities to answer the user's latest query.]\n\n` + 
          MIRON_MASTER_BASE.replace(/\$\{studentName\}/g, this.studentName) + `

CRITICAL LINGUISTIC RULES (GEMINI FALLBACK):
- Authentic, normal, and respectful peer tone.
- NEVER mention course codes (use friendly names only) or backend actions like fetching pages or TOC.
- Speak in natural, authentic Amharic (using the Ge'ez/Fidel alphabet) while seamlessly integrating English for technical terminology.
- Answer the user's latest query directly: "${userMsg}"`;
        
        const payload = JSON.stringify({
          clientContent: { turns: [{ role: "user", parts: [{ text: fallbackInstruction }] }], turnComplete: true }
        });
        this.geminiWs.send(payload);
      }
    }
  }

  getInspectHtml(agentId) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Miron Live Mission Control</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0c0d12; color: #d1d5db; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; font-size: 13px; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    header { background: #13151f; border-bottom: 1px solid #232738; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; }
    .title-group { display: flex; align-items: center; gap: 8px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981; }
    .title { font-weight: 700; color: #f9fafb; font-size: 14px; }
    .meter-container { background: #1a1d2d; border-radius: 6px; padding: 6px 10px; font-size: 11px; display: flex; align-items: center; gap: 8px; }
    .bar-bg { width: 90px; height: 6px; background: #282d45; border-radius: 3px; overflow: hidden; }
    .bar-fill { height: 100%; width: 0%; background: #3b82f6; transition: width 0.3s; }
    #log-container { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; -webkit-overflow-scrolling: touch; }
    .log-item { background: #13151f; border: 1px solid #1f2334; border-radius: 8px; padding: 10px 12px; line-height: 1.4; display: flex; flex-direction: column; gap: 4px; }
    .log-meta-bar { display: flex; justify-content: space-between; font-size: 11px; color: #6b7280; }
    .badge { font-weight: 700; font-size: 10px; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
    .badge-GROQ { background: #4c1d95; color: #c4b5fd; border: 1px solid #6d28d9; }
    .badge-TIKTOKEN { background: #064e3b; color: #6ee7b7; border: 1px solid #059669; }
    .badge-TOOL { background: #78350f; color: #fcd34d; border: 1px solid #d97706; }
    .badge-GEMINI { background: #1e3a8a; color: #93c5fd; border: 1px solid #2563eb; }
    .badge-USER { background: #374151; color: #f3f4f6; }
    .badge-ERROR { background: #7f1d1d; color: #fca5a5; }
    .badge-RATE_LIMIT { background: #831843; color: #fbcfe8; border: 1px solid #be185d; }
    .badge-SLICER { background: #14532d; color: #bbf7d0; border: 1px solid #16a34a; }
    .log-msg { color: #e5e7eb; word-break: break-word; font-family: -apple-system, monospace; }
    .json-data { background: #090a0f; border-radius: 4px; padding: 6px 8px; font-size: 11px; color: #9ca3af; overflow-x: auto; white-space: pre-wrap; margin-top: 4px; border-left: 2px solid #374151; }
    footer { background: #13151f; border-top: 1px solid #232738; padding: 8px 16px; display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; }
    button { background: #232738; color: #e5e7eb; border: none; padding: 5px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; }
    button:active { background: #374151; }
  </style>
</head>
<body>
  <header>
    <div class="title-group">
      <div class="dot"></div>
      <div class="title">Miron Live Terminal <span style="font-size: 11px; color: #9ca3af; font-weight: normal; margin-left: 6px;">(${agentId})</span></div>
      <a href="/inspect?view=picker" style="color: #60a5fa; text-decoration: none; font-size: 11px; margin-left: 12px; background: #1a1d2d; padding: 3px 8px; border-radius: 4px; border: 1px solid #282d45;">⇄ Active Sessions</a>
    </div>
    <div class="meter-container">
      <span id="token-label">0 / 6,500</span>
      <div class="bar-bg"><div class="bar-fill" id="token-bar"></div></div>
    </div>
  </header>

  <div id="log-container"></div>

  <footer>
    <span id="status">Connecting to DO SSE...</span>
    <div>
      <button onclick="clearLogs()">Clear</button>
      <button id="scroll-btn" onclick="toggleScroll()">Auto-scroll: ON</button>
    </div>
  </footer>

  <script>
    const container = document.getElementById("log-container");
    const status = document.getElementById("status");
    const tokenLabel = document.getElementById("token-label");
    const tokenBar = document.getElementById("token-bar");
    let autoScroll = true;

    function toggleScroll() {
      autoScroll = !autoScroll;
      document.getElementById("scroll-btn").innerText = "Auto-scroll: " + (autoScroll ? "ON" : "OFF");
    }

    function clearLogs() {
      container.innerHTML = "";
    }

    function addLog(item) {
      const el = document.createElement("div");
      el.className = "log-item";
      
      const category = item.category || "SYSTEM";
      const badgeClass = "badge badge-" + category;
      
      let jsonHtml = "";
      if (item.meta && Object.keys(item.meta).length > 0) {
        jsonHtml = '<div class="json-data">' + JSON.stringify(item.meta, null, 2) + '</div>';
        if (item.meta.tokens !== undefined) {
          updateTokenMeter(item.meta.tokens);
        }
      }

      el.innerHTML = '<div class="log-meta-bar">' +
        '<span class="' + badgeClass + '">' + category + '</span>' +
        '<span>' + item.time + '</span>' +
      '</div>' +
      '<div class="log-msg">' + item.message + '</div>' + jsonHtml;

      container.appendChild(el);
      if (autoScroll) container.scrollTop = container.scrollHeight;
    }

    function updateTokenMeter(tokens) {
      tokenLabel.innerText = tokens + ' / 6,500';
      const pct = Math.min(100, Math.round((tokens / 6500) * 100));
      tokenBar.style.width = pct + '%';
      tokenBar.style.background = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#3b82f6';
    }

    const sse = new EventSource(window.location.pathname + window.location.search + (window.location.search ? '&' : '?') + 'stream=true');
    sse.onopen = () => { status.innerText = "● Live DO Connected"; status.style.color = "#10b981"; };
    sse.onerror = () => { status.innerText = "○ Reconnecting..."; status.style.color = "#ef4444"; };
    sse.onmessage = (e) => {
      try {
        const item = JSON.parse(e.data);
        addLog(item);
      } catch (err) {}
    };
  </script>
</body>
</html>`;
  }

  async dbHeartbeat() {
    if (!this.conversationId || this.ctx.getWebSockets().length === 0) return;
    const supabaseUrl = this.env?.SUPABASE_URL;
    const serviceKey = this.env?.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) return;

    try {
        const getRes = await fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${this.conversationId}&select=metadata`, {
            headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
        });
        const rows = await getRes.json();
        if (!rows || rows.length === 0) return;
        
        const meta = rows[0].metadata || {};
        
        // Only keep the heartbeat alive if Miron is actively designated as the host
        if (meta.is_live && meta.ai_hosting) {
            meta.live_heartbeat = new Date().toISOString();
            await fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${this.conversationId}`, {
                method: 'PATCH',
                headers: { 
                    'apikey': serviceKey, 
                    'Authorization': `Bearer ${serviceKey}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({ metadata: meta })
            });
        }
    } catch (e) {
        console.error("[Agent|DO|Heartbeat] DB Update Failed", e.message);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.conversationId = url.searchParams.get("agent");
    this.studentName = url.searchParams.get("name") || "Scholar";

    // --- INTERNAL GOD-MODE REGISTRY & RELAY HANDLERS ---
    if (url.pathname === '/internal-log' && request.method === 'POST') {
      try {
        const { entry } = await request.json();
        if (entry) {
          const relayedEntry = {
            ...entry,
            message: `[${entry.student || 'Scholar'} | ${entry.room ? entry.room.slice(0, 14) + '...' : '1-on-1'}] ${entry.message}`
          };
          this.logRing.push(relayedEntry);
          if (this.logRing.length > 150) this.logRing.shift();
          this.ctx.waitUntil(this.ctx.storage.put('log_ring', this.logRing));

          const sseMsg = `data: ${JSON.stringify(relayedEntry)}\n\n`;
          for (const client of this.sseClients) {
            try {
              client.writer.write(new TextEncoder().encode(sseMsg));
            } catch (e) {
              this.sseClients.delete(client);
            }
          }
        }
        return new Response("OK", { status: 200 });
      } catch (e) {
        return new Response(e.message, { status: 400 });
      }
    }

    if (url.pathname === '/registry-register' && request.method === 'POST') {
      try {
        const payload = await request.json();
        this.activeRooms.set(payload.id, {
          id: payload.id,
          student: payload.student || 'Scholar',
          type: payload.type || '1-on-1 Voice Tutoring',
          isLive: true,
          label: `${payload.student}'s ${payload.type} (${payload.id.slice(0, 8)}...)`,
          lastSeen: Date.now()
        });
        this.ctx.waitUntil(this.ctx.storage.put('active_rooms', Array.from(this.activeRooms.entries())));
        this.emitLog("SYSTEM", `🟢 Active session registered: ${payload.student} (${payload.id.slice(0, 8)}...)`);
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(e.message, { status: 400 });
      }
    }

    if (url.pathname === '/registry-unregister' && request.method === 'POST') {
      try {
        const payload = await request.json();
        this.activeRooms.delete(payload.id);
        this.ctx.waitUntil(this.ctx.storage.put('active_rooms', Array.from(this.activeRooms.entries())));
        this.emitLog("SYSTEM", `🔴 Session disconnected: ${payload.id.slice(0, 8)}...`);
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(e.message, { status: 400 });
      }
    }

    if (url.pathname === '/active-registry') {
      const activeList = Array.from(this.activeRooms.values());
      return new Response(JSON.stringify(activeList), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    // --- MISSION CONTROL INSPECTOR ENDPOINT ---
    if (url.pathname.endsWith('/inspect')) {
      const isStream = url.searchParams.get("stream") === "true" || request.headers.get("Accept") === "text/event-stream";
      if (isStream) {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const clientObj = { writer };
        this.sseClients.add(clientObj);

        // Immediate opening ping to defeat Cloudflare/browser stream buffering
        writer.write(new TextEncoder().encode(`: connected\n\n`));

        // Immediately backfill ring buffer logs to new viewer
        for (const item of this.logRing) {
          writer.write(new TextEncoder().encode(`data: ${JSON.stringify(item)}\n\n`));
        }

        // 15s Heartbeat to prevent edge proxy timeouts
        const keepAliveTimer = setInterval(() => {
          try {
            writer.write(new TextEncoder().encode(`: ping\n\n`));
          } catch(e) {
            clearInterval(keepAliveTimer);
          }
        }, 15000);

        request.signal.addEventListener("abort", () => {
          clearInterval(keepAliveTimer);
          this.sseClients.delete(clientObj);
          try { writer.close(); } catch(e){}
        });

        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }

      return new Response(this.getInspectHtml(this.conversationId), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
    
    // STRICT SECURITY: Enforce Gateway Authentication & Shared Secret Verification
    const verifiedUid = request.headers.get("X-Verified-User-Id");
    const internalSecret = request.headers.get("X-Internal-Gateway-Secret");
    this.userId = verifiedUid;
    this.isOneOnOne = this.conversationId && this.conversationId.includes('miron-personal');

    if (request.headers.get("Upgrade") === "websocket") {
        if (!verifiedUid || internalSecret !== 'linkup-internal-worker-secret-2026') {
            console.error("[Agent|DO|SECURITY] ⛔ Blocked unauthorized WS access without Gateway verification.");
            return new Response("Unauthorized Gateway Bypass", { status: 401 });
        }
    }

    // Handle the Supabase dynamic chunk append webhook
    if (request.method === "POST" && url.searchParams.get("action") === "append_chunks") {
        try {
            const authHeader = request.headers.get("Authorization");
            const expectedAuth = `Bearer ${this.env?.SUPABASE_SERVICE_ROLE_KEY}`;
            if (authHeader !== expectedAuth) {
                return new Response("Unauthorized webhook trigger", { status: 401 });
            }

            const payload = await request.json();
            const dbChunks = payload.record?.lecture_chunks || [];
            const currentLength = this.readingQueue.length;

            if (dbChunks.length > currentLength) {
                const chunksToAppend = dbChunks.slice(currentLength);
                this.readingQueue.push(...chunksToAppend);
                console.log(`[Agent|DO|WEBHOOK] Webhook matched. Appended ${chunksToAppend.length} chunks. New total: ${this.readingQueue.length}`);
                return new Response(JSON.stringify({ success: true, appended: chunksToAppend.length }), { status: 200 });
            }
            return new Response(JSON.stringify({ success: true, appended: 0, reason: "No new chunks to process" }), { status: 200 });
        } catch (e) {
            console.error("[Agent|DO|WEBHOOK] Exception parsing append webhook:", e.message);
            return new Response(`Error: ${e.message}`, { status: 500 });
        }
    }

    console.log(`[Agent|DO|FETCH] 🚀 Intercepting WebSocket upgrade request...`);
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    // --- GRACE PERIOD RECOVERY ---
    if (this.cleanupTimeout) {
        console.log("[Agent|DO|RECOVERY] Client reconnected within grace period! Cancelling teardown...");
        clearTimeout(this.cleanupTimeout);
        this.cleanupTimeout = null;
    }

    // Initialize Miron's autonomous heartbeat engine
    if (!this.heartbeatTimer) {
        this.heartbeatTimer = setInterval(() => this.dbHeartbeat(), 15000);
    }

    // Initialize the Silent Double-Guardrail Bucket Compiler
    if (!this.qaTimer) {
        this.qaTimer = setInterval(async () => {
            if (this.questionBucket.length === 0) return;
            
            const timeSinceLast = Date.now() - this.lastAnsweredTime;
            // Guardrail: >= 3 questions OR >= 2 minutes
            if (this.questionBucket.length >= 3 || timeSinceLast >= 120000) {
                const questionsToProcess = [...this.questionBucket];
                this.questionBucket = [];
                this.lastAnsweredTime = Date.now();
                
                console.log(`[Agent|DO|REST] Bucket filled (${questionsToProcess.length} items). Compiling Q&A answers statelessly...`);

                try {
                    const res = await fetch(`${this.env.SUPABASE_URL}/functions/v1/miron-lecture-generator`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`
                        },
                        body: JSON.stringify({
                            action: 'compile_answers',
                            conversation_id: this.conversationId,
                            questions: questionsToProcess
                        })
                    });

                    if (res.ok) {
                        const data = await res.json();
                        console.log(`[Agent|DO|REST] Received ${data.answers?.length || 0} answers and ${data.flags?.length || 0} flags.`);
                        
                        // Immediately broadcast moderation flags to the Hostess UI
                        if (data.flags && data.flags.length > 0) {
                            this.broadcast(JSON.stringify({ type: "moderation_warning", flags: data.flags }));
                        }
                        
                        // Park answers silently until Miron finishes his current reading chunk
                        if (data.answers && data.answers.length > 0) {
                            this.pendingAnswersQueue.push(...data.answers);
                        }
                    } else {
                        console.error("[Agent|DO|REST] Edge Function failed:", await res.text());
                    }
                } catch(e) {
                    console.error("[Agent|DO|REST] Request threw exception:", e.message);
                }
            }
        }, 5000);
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    console.log(`[Agent|DO|CONNECT] Client securely joined live stage.`);

    // Auto-register session in Global Registry & broadcast connection
    if (this.conversationId && this.conversationId !== 'debug-global') {
      this.notifyRegistry('register', {
        id: this.conversationId,
        student: this.studentName,
        type: this.isOneOnOne ? '1-on-1 Voice Tutoring' : 'Live Group Stage'
      });
      this.emitLog("USER", `🔗 ${this.studentName || 'Student'} connected to ${this.isOneOnOne ? '1-on-1 Live Voice' : 'Stage'}.`);
    }

    // Trigger Gemini sync asynchronously so we don't block the handshake
    if (!this.geminiWs && !this.isInitializingGemini) {
      console.log(`[Agent|DO] First client connected. Triggering Gemini initialization.`);
      this.initSharedGemini();
    }

    const wsProtocols = request.headers.get("Sec-WebSocket-Protocol");
    const headers = {};
    if (wsProtocols) {
        // Return the first requested subprotocol to satisfy the strict browser handshake validation
        headers['Sec-WebSocket-Protocol'] = wsProtocols.split(',')[0].trim();
    }

    return new Response(null, { status: 101, webSocket: client, headers });
  }

  async webSocketMessage(ws, message) {
    const isString = typeof message === 'string';
    const byteLen = isString ? new Blob([message]).size : message.byteLength;
    
    if (isString) {
        // --- INTERCEPT CONTROL MESSAGES (DO STATE MACHINE) ---
        try {
            const parsed = JSON.parse(message);
            if (parsed.action === "client_ready") {
                console.log(`[Agent|DO|STATE] Intercepted client_ready for ${this.conversationId} (stage: ${parsed.stage})`);
                if (this.isOneOnOne && parsed.stage === "course_select" && !this.hasGreeted) {
                    this.hasGreeted = true;
                    const greeting = pickGreeting(this.studentName, this.userSex);
                    this.speakPreformattedAmharic(greeting);
                }
                return;
            }

            if (parsed.action === "course_selected") {
                console.log(`[Agent|DO|STATE] Intercepted course_selected for ${this.conversationId} (course: ${parsed.course_name})`);
                if (this.isOneOnOne) {
                    const speech = pickCourseResponse(parsed.course_name, this.userSex);
                    this.speakPreformattedAmharic(speech);
                }
                return;
            }

            if (parsed.action === "section_selected") {
                console.log(`[Agent|DO|STATE] Intercepted section_selected for ${this.conversationId} (${parsed.section_title})`);
                if (this.isOneOnOne) {
                    this.isGeneratingSectionSummary = true;
                    const courseName = parsed.course_name || (this.currentCourseCode || "our course");
                    const chapterTitle = parsed.chapter_title || "this chapter";
                    const sectionTitle = parsed.section_title || "this section";

                    const isFemale = (this.userSex || "").toLowerCase() === 'female' || (this.userSex || "").toLowerCase() === 'f';
                    const genderRule = isFemale
                        ? "The student is female. Use feminine Amharic conjugations (e.g. ንኪ, ጀምሪ, ተዘጋጅተሻል, etc.)."
                        : "The student is male. Use masculine Amharic conjugations (e.g. ንካ, ጀምር, ተዘጋጅተሃል, etc.).";

                    const prompt = `[VOICE DIRECTIVE: TOPIC PREVIEW]
You are Miron, speaking directly to ${this.studentName} in authentic Addis Ababa university peer Amharic (using the Ge'ez/Fidel alphabet).
The student just selected: "${sectionTitle}" under "${chapterTitle}" in ${courseName}.
${genderRule}

STRICT OPERATIONAL RULES:
1. Speak in a grounded, authentic, encouraging university peer tone.
2. STRICT BREVITY: Output EXACTLY 2 short sentences (strictly under 30 words total). Do NOT give a long explanation or full lecture.
3. Sentence 1: Acknowledge the topic and briefly hype what key concept or formula we'll master.
4. Sentence 2: Energetically challenge/nudge them to hit the start button below to jump into the book.
5. Speak directly in Amharic with zero English filler or preamble.`;

                    const payload = JSON.stringify({
                        clientContent: {
                            turns: [{ role: "user", parts: [{ text: prompt }] }],
                            turnComplete: true
                        }
                    });

                    if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN && this.isGeminiSetupComplete) {
                        this.geminiWs.send(payload);
                    } else {
                        this.pendingTemplateSpeech = prompt;
                    }
                    this.emitLog("GEMINI", `🎙️ Generating dynamic section preview for: "${sectionTitle}"`);
                }
                return;
            }

            if (parsed.action === "interrupt") {
                console.log(`[Agent|DO|STATE] Intercepted client interrupt for ${this.conversationId}`);
                this.isSpeakingTemplate = false;
                this.isGeneratingSectionSummary = false;
                this.translationQueue = [];
                return;
            }

            if (parsed.action === "hangup") {
                console.log(`[Agent|DO|STATE] Intercepted explicit hangup for ${this.conversationId}. Executing immediate hard cleanup.`);
                await this.executeHardCleanup();
                try { ws.close(1000, "Session ended by user"); } catch (e) {}
                return;
            }

            if (parsed.action === "start_lecture") {
                console.log(`[Agent|DO|STATE] Intercepted start_lecture. Fetching chunks from database for ${this.conversationId}...`);
                
                try {
                    const res = await fetch(`${this.env.SUPABASE_URL}/rest/v1/live_study_sessions?conversation_id=eq.${this.conversationId}&select=lecture_chunks`, {
                        headers: {
                            'apikey': this.env.SUPABASE_SERVICE_ROLE_KEY,
                            'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`
                        }
                    });
                    
                    if (res.ok) {
                        const rows = await res.json();
                        const chunks = rows[0]?.lecture_chunks || [];
                        console.log(`[Agent|DO|STATE] Successfully loaded ${chunks.length} chunks from DB.`);
                        
                        this.readingQueue = chunks;
                        this.currentChunkIndex = 0;
                        this.stageState = "reading";
                        
                        if (this.readingQueue.length > 0) {
                            const rawChunk = this.readingQueue[0];
                            this.broadcast(JSON.stringify({ type: "chunk_transition", index: 0, chunk: rawChunk }));
                            
                            const textToSpeak = typeof rawChunk === 'object' ? (rawChunk.spoken_text || '') : rawChunk;
                            const cleanChunk = sanitizeForSpeech(textToSpeak);
                            const prompt = `Read the following segment exactly in your informal peer tone:\n\n${cleanChunk}`;
                            const payload = JSON.stringify({
                                clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true }
                            });
                            
                            if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN && this.isGeminiSetupComplete) {
                                this.geminiWs.send(payload);
                            } else {
                                this.messageQueue.push(payload);
                            }
                        }
                    } else {
                        console.error("[Agent|DO|STATE] Failed to fetch chunks:", await res.text());
                    }
                } catch(e) {
                    console.error("[Agent|DO|STATE] Exception fetching DB chunks:", e.message);
                }
                return;
            }
            
            if (parsed.action === "submit_question") {
                console.log(`[Agent|DO|STATE] Queuing silent question from ${parsed.sender}`);
                this.questionBucket.push({
                    user_id: parsed.user_id,
                    sender_name: parsed.sender,
                    text: parsed.text
                });
                return;
            }

            // --- 1-ON-1 TEXT INPUT INTERCEPTOR (GROQ BRAIN) ---
            let oneOnOneText = null;
            if (parsed.clientContent?.turns) {
                oneOnOneText = parsed.clientContent.turns[0]?.parts?.[0]?.text;
            } else if (parsed.action === "chat" || parsed.text || parsed.message) {
                oneOnOneText = parsed.text || parsed.message;
            }

            if (this.isOneOnOne && oneOnOneText) {
                this.emitLog("USER", oneOnOneText);
                this.translationQueue = []; // INTERRUPT: Clear pending translation chunks
                this.ctx.waitUntil(this.executeGroqCognitiveTurn(oneOnOneText));
                return; // Do NOT forward user text directly to Gemini Live
            }

            if (parsed.action === "inject_question") {
                console.log(`[Agent|DO|STATE] Intercepted inject_question. Compiling single pinned question immediately...`);
                const singleQuestion = {
                    user_id: parsed.user_id || "pinned_user",
                    sender_name: parsed.sender,
                    text: parsed.text
                };

                this.ctx.waitUntil((async () => {
                    try {
                        const res = await fetch(`${this.env.SUPABASE_URL}/functions/v1/miron-lecture-generator`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`
                            },
                            body: JSON.stringify({
                                action: 'compile_answers',
                                conversation_id: this.conversationId,
                                questions: [singleQuestion]
                              })
                        });

                        if (res.ok) {
                            const data = await res.json();
                            if (data.flags && data.flags.length > 0) {
                                this.broadcast(JSON.stringify({ type: "moderation_warning", flags: data.flags }));
                            }
                            if (data.answers && data.answers.length > 0) {
                                this.pendingAnswersQueue.push(...data.answers);
                                console.log(`[Agent|DO|STATE] Pinned question answer compiled and queued. Total pending answers: ${this.pendingAnswersQueue.length}`);
                            }
                        } else {
                            console.error("[Agent|DO|STATE] Failed to compile injected question:", await res.text());
                        }
                    } catch (e) {
                        console.error("[Agent|DO|STATE] Exception compiling injected question:", e.message);
                    }
                })());
                return;
            }
        } catch(e) { /* Fallthrough for non-JSON or standard WS frames */ }

        const sample = message.substring(0, 150).replace(/\n/g, '');
        console.log(`[Agent|CLIENT->DO|PAYLOAD] ${sample}`);
    } else {
        console.log(`[Agent|CLIENT->DO] Binary payload received. Size: ${byteLen} bytes`);
    }

    if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN && this.isGeminiSetupComplete) {
      try {
        this.geminiWs.send(message);
        if (!isString || !message.includes('"realtimeInput"')) {
             console.log(`[Agent|DO->GEMINI] Forwarded ${byteLen} bytes to Google successfully.`);
        }
      } catch (err) {
        console.error(`[Agent|DO->GEMINI] ❌ Send Error: ${err.message}`, err.stack);
      }
    } else {
      if (isString && message.includes('"realtimeInput"')) {
         console.log(`[Agent|DO|DROP] Dropping realtime audio frame. Gemini not ready.`);
      } else {
         console.log(`[Agent|DO|QUEUE] ⏳ Upstream not ready. Queueing message. Queue size: ${this.messageQueue.length + 1}`);
         this.messageQueue.push(message);
      }
    }
  }

  async executeHardCleanup() {
    console.log("[Agent|DO|CLEANUP] Grace period expired. Executing hard cleanup...");
    this.cleanupTimeout = null;
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    
    if (this.qaTimer) {
      clearInterval(this.qaTimer);
      this.qaTimer = null;
    }

    if (this.speechDebounceTimer) {
      clearTimeout(this.speechDebounceTimer);
      this.speechDebounceTimer = null;
    }
    this.pendingUserSpeech = "";
    this.isGroqSynthesizing = false;
    this.isGeminiFallbackActive = false;
    this.groqChatHistory = [];
    this.readingQueue = [];
    this.currentChunkIndex = 0;
    this.stageState = "idle";
    this.questionBucket = [];
    this.pendingAnswersQueue = [];
    this.translationQueue = [];
    this.messageQueue = [];
    this.currentBookId = null;
    this.currentCourseCode = null;
    this.lastPromptTokens = 0;

    if (this.geminiWs) {
      console.log("[Agent|DO|CLEANUP] Closing upstream Gemini WS.");
      try {
        this.geminiWs.close(1000, "Stage empty");
      } catch (e) {
        console.error("[Agent|DO|CLEANUP] Error closing Gemini WS:", e.message);
      }
      this.geminiWs = null;
      this.isGeminiSetupComplete = false;
    }

    // Instantly kill the session in the database to stop the ghost pulsing
    if (this.conversationId && !this.isOneOnOne) {
      const supabaseUrl = this.env?.SUPABASE_URL;
      const serviceKey = this.env?.SUPABASE_SERVICE_ROLE_KEY;
      
      if (supabaseUrl && serviceKey) {
        console.log(`[Agent|DO|CLEANUP] Nuking live session metadata for ${this.conversationId}`);
        
        try {
          // Fetch current metadata to avoid clobbering other fields
          const getRes = await fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${this.conversationId}&select=metadata`, {
              headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
          });
          
                        const rows = await getRes.json();
            if (rows && rows.length > 0) {
                const meta = rows[0].metadata || {};
                
                // If the stage is still live but Miron has simply been toggled off,
                // do not scrub the database properties. Let the human stay on stage!
                if (meta.is_live && !meta.ai_hosting) {
                    console.log("[Agent|DO|CLEANUP] Miron toggled off. Human is still hosting. Preserving DB metadata.");
                    return;
                }

                // Scrub live properties
                delete meta.is_live;
                delete meta.ai_hosting;
                delete meta.live_host_id;
                delete meta.live_status;
                delete meta.live_heartbeat;
                delete meta.live_started_at;
                delete meta.live_topic;

              // Patch conversation metadata
              await fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${this.conversationId}`, {
                  method: 'PATCH',
                  headers: { 
                      'apikey': serviceKey, 
                      'Authorization': `Bearer ${serviceKey}`,
                      'Content-Type': 'application/json',
                      'Prefer': 'return=minimal'
                  },
                  body: JSON.stringify({ metadata: meta })
              });
              
              // Delete discovery record so it drops from the global feed
              await fetch(`${supabaseUrl}/rest/v1/live_study_sessions?conversation_id=eq.${this.conversationId}`, {
                  method: 'DELETE',
                  headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
              });
              
              console.log("[Agent|DO|CLEANUP] Database successfully scrubbed. The ghost is dead.");
          }
        } catch (e) {
          console.error("[Agent|DO|CLEANUP] DB Teardown Failed", e.message);
        }
      }
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    console.log(`[Agent|DO|DISCONNECT] Client left stage. Code: ${code}, Reason: ${reason}`);
    
    // Auto-cleanup if all connected clients disconnect.
    // Cloudflare includes the closing socket in getWebSockets() during this event, so we must filter it.
    const activeSockets = this.ctx.getWebSockets().filter(s => s !== ws);
    
    if (activeSockets.length === 0) {
      if (this.conversationId && this.conversationId !== 'debug-global') {
        this.notifyRegistry('unregister', { id: this.conversationId });
        this.emitLog("USER", `🔌 ${this.studentName || 'Student'} disconnected.`);
      }
      if (this.speechDebounceTimer) {
        clearTimeout(this.speechDebounceTimer);
        this.speechDebounceTimer = null;
      }
      this.pendingUserSpeech = "";
      this.translationQueue = [];
      this.isGeminiTranslating = false;
                this.isGeminiFallbackActive = false;
          if (this.isOneOnOne) {
            console.log("[Agent|DO|CLEANUP] 1-on-1 session disconnected. Tearing down upstream immediately without grace period.");
            this.executeHardCleanup();
          } else {
            console.log("[Agent|DO|CLEANUP] Stage is completely empty. Holding upstream socket warm for 30s...");
            this.cleanupTimeout = setTimeout(() => {
                this.executeHardCleanup();
            }, 30000);
          }
    }
  }

  async webSocketError(ws, error) {
    console.error(`[Agent|DO|ERROR] Client WebSocket threw an error:`, error);
  }

  async initSharedGemini() {
    this.isInitializingGemini = true;
    console.log(`[Agent|GEMINI|INIT] 🚀 Starting Gemini initialization sequence for DO: ${this.id}`);

    let geminiKey;
    try {
      const supabaseUrl = this.env?.SUPABASE_URL;
      const serviceRoleKey = this.env?.SUPABASE_SERVICE_ROLE_KEY;
      console.log(`[Agent|GEMINI|DB] Fetching key. Env status -> SUPABASE_URL: ${!!supabaseUrl}, SUPABASE_SERVICE_ROLE_KEY: ${!!serviceRoleKey}`);
      
      if (!supabaseUrl || !serviceRoleKey) {
         throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Worker environment variables.");
      }

      // Determine the billable host/user (Group stages MUST bill host; 1-on-1 bills user)
      let billableUserId = null;
      if (this.isOneOnOne) {
          billableUserId = this.userId;
          if (this.userId) {
              try {
                  const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${this.userId}&select=sex,full_name`, {
                      headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` }
                  });
                  if (profRes.ok) {
                      const profData = await profRes.json();
                      if (profData && profData.length > 0) {
                          this.userSex = profData[0].sex;
                          if (!this.studentName || this.studentName === 'Scholar') {
                              this.studentName = (profData[0].full_name || 'Scholar').split(' ')[0];
                          }
                          console.log(`[Agent|GEMINI|PROFILE] Resolved student sex: ${this.userSex}, name: ${this.studentName}`);
                      }
                  }
              } catch (profErr) {
                  console.error("[Agent|GEMINI|PROFILE] Failed to fetch student sex:", profErr.message);
              }
          }
      } else if (this.conversationId) {
          try {
              const res = await fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${this.conversationId}&select=metadata`, {
                  headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` }
              });
              const rows = await res.json();
              if (rows && rows.length > 0) {
                  billableUserId = rows[0].metadata?.live_host_id;
              }
          } catch (e) {
              console.error("[Agent|GEMINI|DB] Failed to resolve stage host:", e.message);
          }
      }

      if (!billableUserId) {
          console.error(`[Agent|GEMINI|DB] ❌ No billable host resolved for session ${this.conversationId}`);
          this.broadcast(JSON.stringify({ event: "billing_error", error: "Unable to verify stage host billing credentials." }));
          throw new Error("No billable user resolved for session.");
      }

      const rpcUrl = `${supabaseUrl}/rest/v1/rpc/lease_gemini_api_key`;
      console.log(`[Agent|GEMINI|DB] Executing POST request to Supabase RPC: ${rpcUrl}`);

      const sessionCost = this.isOneOnOne ? 2 : 20;
      const dbResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`
        },
        body: JSON.stringify({ p_user_id: billableUserId || null, p_cost: sessionCost })
      });

      console.log(`[Agent|GEMINI|DB] Supabase response status: ${dbResponse.status} ${dbResponse.statusText}`);

      if (!dbResponse.ok) {
        const errText = await dbResponse.text();
        console.error(`[Agent|GEMINI|DB] ❌ RPC Error Response Body: ${errText}`);
        if (errText.includes('INSUFFICIENT_CREDITS')) {
            this.broadcast(JSON.stringify({ event: "billing_error", error: "Insufficient LinkUp Credits to start a live AI session." }));
        }
        throw new Error(`Supabase RPC HTTP ${dbResponse.status}: ${errText}`);
      }

      const dbData = await dbResponse.json();
      console.log(`[Agent|GEMINI|DB] RPC JSON Parsed successfully. Array length: ${dbData?.length || 0}`);
      
      if (!dbData || !dbData[0] || !dbData[0].api_key) {
         console.error(`[Agent|GEMINI|DB] ❌ Invalid payload structure:`, JSON.stringify(dbData));
         throw new Error("RPC returned empty or invalid key payload: " + JSON.stringify(dbData));
      }
      
      geminiKey = dbData[0].api_key;
      console.log(`[Agent|GEMINI|DB] ✅ Successfully leased Gemini API Key. Masked: ${geminiKey.substring(0, 4)}...${geminiKey.substring(geminiKey.length - 4)}`);
    } catch (err) {
      console.error(`[Agent|GEMINI|DB] ❌ Failed to lease key:`, err.message, err.stack);
      const friendlyMsg = err.message?.includes('INSUFFICIENT_CREDITS')
        ? "Insufficient LinkUp Credits to start a live AI session."
        : "Miron is currently operating at maximum capacity across campus networks. Please try again in a few moments.";
      this.broadcast(JSON.stringify({ error: friendlyMsg }));
      this.isInitializingGemini = false;
      return;
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiKey}`;
    try {
      console.log(`[Agent|GEMINI|WS] 🌐 Initiating WebSocket connection to Google... Target URL length: ${geminiUrl.length}`);
      console.log(`[Agent|GEMINI|WS] Handshake headers: { Upgrade: "websocket" }`);
      
      const geminiResponse = await fetch(geminiUrl, { headers: { "Upgrade": "websocket" } });
      console.log(`[Agent|GEMINI|WS] Handshake Response Status: ${geminiResponse.status} ${geminiResponse.statusText}`);
      console.log(`[Agent|GEMINI|WS] Handshake Headers:`, JSON.stringify([...geminiResponse.headers]));

      const ws = geminiResponse.webSocket;
      
      if (!ws) {
        let errText = "Unknown handshake rejection.";
        try {
          errText = await geminiResponse.text();
        } catch (e) {
          console.error("[Agent|GEMINI|WS] Could not read error response text.", e.message);
        }
        console.error(`[Agent|GEMINI|WS] ❌ Websocket missing from response! Body: ${errText}`);
        
        // ROLLBACK / REFUND: The connection failed, refund the exact session cost
        if (billableUserId) {
            console.log(`[Agent|GEMINI|WS] Connection failed. Issuing ${sessionCost}-credit refund to ${billableUserId}...`);
            try {
                await fetch(`${supabaseUrl}/rest/v1/linkoin_transactions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` },
                    body: JSON.stringify({
                        user_id: billableUserId,
                        amount: sessionCost,
                        transaction_type: 'refund',
                        description: 'Miron Live Connection Failed',
                        idempotency_key: `refund_live_${crypto.randomUUID()}`
                    })
                });
            } catch (refundErr) {
                console.error("[Agent|GEMINI|WS] ❌ Refund failed to execute:", refundErr.message);
            }
        }

        throw new Error(`Google Handshake HTTP ${geminiResponse.status}: ${errText}`);
      }

      ws.accept();
      this.geminiWs = ws;
      this.isInitializingGemini = false;
      console.log(`[Agent|GEMINI|WS] ✅ WebSocket accepted and mounted!`);

      const setupMessage = {
        setup: {
          model: "models/gemini-3.1-flash-live-preview",
          generationConfig: { responseModalities: ["AUDIO"] },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      };

      if (this.isOneOnOne) {
          // Gemini Live acts strictly as the Voice & Audio Translation Synthesizer (Groq is the Cognitive Brain)
          setupMessage.setup.systemInstruction = {
              parts: [{
                  text: `You are the spoken voice, translation, and audio synthesis engine for Miron, speaking to ${this.studentName}.
CRITICAL OPERATIONAL RULES:
1. Do NOT answer user speech or user inputs on your own. User reasoning is handled by our primary cognitive brain.
2. Your sole task when user microphone audio arrives is real-time transcription via inputAudioTranscription.
3. You ONLY generate audio speech when you receive an explicit text turn instructing you to speak.
4. If an incoming text turn contains preformatted Amharic text under a [VOICE SYNTHESIS DIRECTIVE], read and speak it directly with authentic, warm peer prosody. Never translate it into English or add commentary.
5. If an incoming text turn contains English explanations, translate them into natural, authentic Amharic (using the Ge'ez/Fidel alphabet) with a grounded peer tone, blended smoothly with English technical terms, and speak them directly. Never mention course codes, instructions, prompts, or backend systems.`
              }]
          };
      }
      
      const setupMessageStr = JSON.stringify(setupMessage);
      console.log(`[Agent|GEMINI|WS] Sending natively constructed Setup Payload: ${setupMessageStr}`);
      
      try {
        ws.send(setupMessageStr);
        console.log("[Agent|GEMINI|WS] ✅ Setup payload sent successfully. Awaiting SetupComplete...");
      } catch (e) {
        console.error("[Agent|GEMINI|WS] ❌ Failed to send setup payload:", e.message, e.stack);
      }
      
      ws.addEventListener("message", async (event) => {
        let data = event.data;
        const isBinary = data instanceof ArrayBuffer || data instanceof Blob;

        if (data instanceof ArrayBuffer) {
          data = new TextDecoder().decode(data);
          console.log(`[Agent|GEMINI->DO] Decoded ArrayBuffer to String. Length: ${data.length}`);
        } else if (data instanceof Blob) {
          try {
            console.log(`[Agent|GEMINI->DO] Blob Size: ${data.size} bytes. Converting to text...`);
            data = await data.text();
            console.log(`[Agent|GEMINI->DO] Blob Text length: ${data.length}`);
          } catch (e) {
            console.error("[Agent|GEMINI->DO] ❌ Failed to parse binary Blob payload:", e.message, e.stack);
            return;
          }
        }
        
        if (typeof data === 'string') {
            const preview = data.substring(0, 250).replace(/\n/g, '\\n');
            if (!preview.includes('serverContent')) {
                console.log(`[Agent|GEMINI->DO|PAYLOAD] -> ${preview}`);
            }

            try {
                const parsed = JSON.parse(data);

                // --- 1-ON-1 VOICE INPUT: INTERCEPT STT TRANSCRIPTION FOR GROQ ---
                if (this.isOneOnOne && parsed.serverContent?.inputTranscription?.text) {
                    this.translationQueue = []; // INTERRUPT: Nuke the remaining script if user barges in!
                    this.isSpeakingTemplate = false;
                    this.isGeneratingSectionSummary = false;

                    const speechChunk = parsed.serverContent.inputTranscription.text;
                    this.pendingUserSpeech = (this.pendingUserSpeech || "") + speechChunk;

                    // Pass transcription through to client so student sees their user bubble in real-time
                    this.broadcast(data);

                    if (this.speechDebounceTimer) clearTimeout(this.speechDebounceTimer);
                    this.speechDebounceTimer = setTimeout(() => {
                        const fullSpoken = (this.pendingUserSpeech || "").trim();
                        this.pendingUserSpeech = "";
                        if (fullSpoken.length > 0) {
                            this.emitLog("USER", `[Voice] ${fullSpoken}`);
                            this.ctx.waitUntil(this.executeGroqCognitiveTurn(fullSpoken));
                        }
                    }, 1200);

                    return;
                }

                // If user finished speech turn according to VAD, flush speech immediately
                if (this.isOneOnOne && parsed.serverContent?.turnComplete && !this.isGeminiTranslating && this.pendingUserSpeech?.trim()) {
                    if (this.speechDebounceTimer) clearTimeout(this.speechDebounceTimer);
                    const fullSpoken = this.pendingUserSpeech.trim();
                    this.pendingUserSpeech = "";
                    this.emitLog("USER", `[Voice] ${fullSpoken}`);
                    this.ctx.waitUntil(this.executeGroqCognitiveTurn(fullSpoken));
                }

                // --- 1-ON-1 AUDIO SUPPRESSION: BLOCK ROGUE GEMINI SPEECH ---
                if (this.isOneOnOne && !this.isGeminiTranslating && !this.isGeminiFallbackActive && !this.isSpeakingTemplate && !this.isGeneratingSectionSummary) {
                    if (parsed.serverContent?.modelTurn || parsed.serverContent?.outputTranscription) {
                        // Drop autonomous Gemini model responses; Groq is the primary cognitive brain
                        return;
                    }
                }

                // Turn completed for Groq speech synthesis or Gemini fallback
                if (this.isOneOnOne && parsed.serverContent?.turnComplete) {
                    if (this.isSpeakingTemplate) {
                        this.isSpeakingTemplate = false;
                    } else if (this.isGeneratingSectionSummary) {
                        this.isGeneratingSectionSummary = false;
                    } else if (this.isGeminiFallbackActive) {
                        this.isGeminiFallbackActive = false;
                    } else if (this.isGeminiTranslating) {
                        this.isGeminiTranslating = false;
                        this.processTranslationQueue(); // Load next paragraph if available
                    }
                }
                
                // --- TOOL CALL INTERCEPTOR ---
                if (parsed.toolCall) {
                    console.log(`[Agent|GEMINI|TOOL] Tool call intercepted:`, parsed.toolCall);
                    this.broadcast(JSON.stringify({ type: "tool_call_state", executing: true }));
                    
                    const extractTextFromBlockArray = (blocks) => {
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
                    };

                    const authHeaders = {
                        'apikey': this.env.SUPABASE_SERVICE_ROLE_KEY,
                        'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`
                    };

                    const fetchWithTimeout = async (url, options = {}, timeoutMs = 1500) => {
                        const controller = new AbortController();
                        const id = setTimeout(() => controller.abort(), timeoutMs);
                        try {
                            const response = await fetch(url, { ...options, signal: controller.signal });
                            clearTimeout(id);
                            return response;
                        } catch (err) {
                            clearTimeout(id);
                            if (err.name === 'AbortError') {
                                throw new Error("Textbook database retrieval timed out. Fall back entirely to your pre-trained knowledge to answer the student.");
                            }
                            throw err;
                        }
                    };

                    const functionResponses = [];

                    for (const call of parsed.toolCall.functionCalls) {
                        const { name, args, id } = call;
                        let result = {};

                        try {
                            if (name === "get_book_toc") {
                                const code = args.course_code.toUpperCase().trim();
                                const res = await fetchWithTimeout(`${this.env.SUPABASE_URL}/rest/v1/books?course_code=eq.${code}&is_published=eq.true&select=id,title,toc,page_offset`, { headers: authHeaders });
                                const json = await res.json();
                                if (json && json.length > 0) {
                                    result = { status: "success", book_id: json[0].id, title: json[0].title, page_offset: json[0].page_offset || 0, toc: json[0].toc };
                                } else {
                                    result = { status: "error", message: `Book for course ${code} not found.` };
                                }
                            } 
                            else if (name === "read_book_section") {
                                const code = args.course_code.toUpperCase().trim();
                                const res = await fetchWithTimeout(`${this.env.SUPABASE_URL}/rest/v1/books?course_code=eq.${code}&is_published=eq.true&select=id,toc,page_offset`, { headers: authHeaders });
                                const json = await res.json();
                                
                                if (json && json.length > 0 && json[0].toc) {
                                    const bookId = json[0].id;
                                    const offset = json[0].page_offset || 0;
                                    const matchResult = findBestMatchingTocNode(json[0].toc, args.section_title, 0.80);

                                    if (matchResult) {
                                        const { matchedItem, flatList } = matchResult;
                                        const startPage = matchedItem.page;
                                        const targetDepth = matchedItem.depth;
                                        let endPage = 99999;
                                        for (let i = matchedItem.originalIndex + 1; i < flatList.length; i++) {
                                            const candidate = flatList[i];
                                            if (candidate.depth <= targetDepth && candidate.page && candidate.page > startPage) {
                                                endPage = candidate.page;
                                                break;
                                            }
                                        }

                                        const physicalStart = Math.max(1, startPage + offset);
                                        const physicalEnd = endPage === 99999 ? 99999 : Math.max(1, endPage + offset);

                                        const pageRes = await fetchWithTimeout(`${this.env.SUPABASE_URL}/rest/v1/book_pages?book_id=eq.${bookId}&page_number=gte.${physicalStart}&page_number=lt.${physicalEnd}&select=page_number,content_json&order=page_number.asc`, { headers: authHeaders });
                                        const pages = await pageRes.json();
                                        
                                        const sectionText = pages.map(p => `--- PAGE ${p.page_number} ---\n` + extractTextFromBlockArray(p.content_json || [])).join("\n\n");
                                        result = { 
                                            status: "success", 
                                            matched_section: matchedItem.title,
                                            breadcrumb: matchedItem.breadcrumb,
                                            text: sectionText || "Section is empty." 
                                        };
                                    } else {
                                        result = { status: "error", message: `Section "${args.section_title}" not found in TOC with sufficient confidence (>=80%).` };
                                    }
                                } else {
                                    result = { status: "error", message: "Course book not found." };
                                }
                            }
                            else if (name === "read_book_page") {
                                const code = args.course_code.toUpperCase().trim();
                                const start = args.start_page;
                                const end = args.end_page || (start + 1);

                                const res = await fetchWithTimeout(`${this.env.SUPABASE_URL}/rest/v1/books?course_code=eq.${code}&is_published=eq.true&select=id,page_offset`, { headers: authHeaders });
                                const json = await res.json();

                                if (json && json.length > 0) {
                                    const bookId = json[0].id;
                                    const offset = json[0].page_offset || 0;
                                    const physicalStart = Math.max(1, start + offset);
                                    const physicalEnd = Math.max(1, end + offset);

                                    const pageRes = await fetchWithTimeout(`${this.env.SUPABASE_URL}/rest/v1/book_pages?book_id=eq.${bookId}&page_number=gte.${physicalStart}&page_number=lte.${physicalEnd}&select=page_number,content_json&order=page_number.asc`, { headers: authHeaders });
                                    const pages = await pageRes.json();

                                    const sectionText = pages.map(p => `--- PAGE ${p.page_number} ---\n` + extractTextFromBlockArray(p.content_json || [])).join("\n\n");
                                    result = { status: "success", text: sectionText || "Pages are empty or do not exist." };
                                } else {
                                    result = { status: "error", message: "Course book not found." };
                                }
                            }
                        } catch (err) {
                            result = { status: "error", message: err.message };
                        }

                        functionResponses.push({
                            functionResponse: { name, id, response: result }
                        });
                    }

                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            clientContent: { turns: [{ role: "user", parts: functionResponses }], turnComplete: true }
                        }));
                    }
                    
                    this.broadcast(JSON.stringify({ type: "tool_call_state", executing: false }));
                    return;
                }
            } catch(e) {}
            
            // --- NON-INTERRUPTIVE PIVOT PLAYBACK MANAGER ---
            try {
                const parsed = JSON.parse(data);
                if (parsed.serverContent && parsed.serverContent.turnComplete) {
                    if (this.stageState === "reading") {
                        this.currentChunkIndex++;
                        
                        // Pivot check: Did the REST compiler deliver answers?
                        if (this.pendingAnswersQueue.length > 0) {
                            this.stageState = "answering_qa";
                            const ans = this.pendingAnswersQueue.shift();
                            console.log(`[Agent|DO|STATE] Pivoting to Q&A. Delivering answer to ${ans.sender_name}...`);
                            
                            const rawChunk = `[print]{p}Q&A Time!{p}\n\n${ans.answer_text}[print]`;
                            this.broadcast(JSON.stringify({ type: "chunk_transition", index: -1, chunk: rawChunk }));
                            
                            const cleanChunk = sanitizeForSpeech(ans.answer_text);
                            const prompt = `Read the following answer exactly in your conversational tone:\n\n${cleanChunk}`;
                            ws.send(JSON.stringify({
                                clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true }
                            }));
                        } else if (this.currentChunkIndex < this.readingQueue.length) {
                            console.log(`[Agent|DO|STATE] Advancing lecture cursor to chunk ${this.currentChunkIndex}`);
                            const rawChunk = this.readingQueue[this.currentChunkIndex];
                            this.broadcast(JSON.stringify({ type: "chunk_transition", index: this.currentChunkIndex, chunk: rawChunk }));
                            
                            const textToSpeak = typeof rawChunk === 'object' ? (rawChunk.spoken_text || '') : rawChunk;
                            const cleanChunk = sanitizeForSpeech(textToSpeak);
                            const prompt = `Let's continue. Read this segment exactly:\n\n${cleanChunk}`;
                            ws.send(JSON.stringify({
                                clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true }
                            }));
                        } else {
                            // Lecture completed. Final clean-up of bucket if necessary.
                            console.log(`[Agent|DO|STATE] Lecture completed.`);
                            this.stageState = "idle";
                        }
                    } else if (this.stageState === "answering_qa") {
                        // Are there more answers?
                        if (this.pendingAnswersQueue.length > 0) {
                            const ans = this.pendingAnswersQueue.shift();
                            console.log(`[Agent|DO|STATE] Delivering next answer to ${ans.sender_name}...`);
                            
                            const rawChunk = `[print]{p}Q&A Time!{p}\n\n${ans.answer_text}[print]`;
                            this.broadcast(JSON.stringify({ type: "chunk_transition", index: -1, chunk: rawChunk }));
                            
                            const cleanChunk = sanitizeForSpeech(ans.answer_text);
                            const prompt = `Read the following answer exactly in your conversational tone:\n\n${cleanChunk}`;
                            ws.send(JSON.stringify({
                                clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true }
                            }));
                        } else {
                            // Queue empty, pivot back to lecture!
                            this.stageState = "resuming_lecture";
                            
                            this.broadcast(JSON.stringify({ type: "chunk_transition", index: -1, chunk: "" }));
                            
                            const prompt = `Read this exactly: "Alright guys, let's get back to the text!"`;
                            ws.send(JSON.stringify({
                                clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true }
                            }));
                        }
                    } else if (this.stageState === "resuming_lecture") {
                        this.stageState = "reading";
                        if (this.currentChunkIndex < this.readingQueue.length) {
                            console.log(`[Agent|DO|STATE] Resuming lecture at chunk ${this.currentChunkIndex}`);
                            const rawChunk = this.readingQueue[this.currentChunkIndex];
                            this.broadcast(JSON.stringify({ type: "chunk_transition", index: this.currentChunkIndex, chunk: rawChunk }));
                            
                            const textToSpeak = typeof rawChunk === 'object' ? (rawChunk.spoken_text || '') : rawChunk;
                            const cleanChunk = sanitizeForSpeech(textToSpeak);
                            const prompt = `Let's resume the lecture where we left off. Read this segment exactly:\n\n${cleanChunk}`;
                            ws.send(JSON.stringify({
                                clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true }
                            }));
                        } else {
                            console.log(`[Agent|DO|STATE] Lecture completed.`);
                            this.stageState = "idle";
                        }
                    }
                }
            } catch(e) {}
        }
        
        if (typeof data === 'string' && data.includes('"setupComplete"')) {
          console.log("[Agent|GEMINI|WS] 🟢 SetupComplete received! Gemini is fully ready. Unlocking queues...");
          this.isGeminiSetupComplete = true;

          if (this.pendingTemplateSpeech) {
            const speech = this.pendingTemplateSpeech;
            this.pendingTemplateSpeech = null;
            this.speakPreformattedAmharic(speech);
          }

          console.log(`[Agent|GEMINI|WS] Flushing ${this.messageQueue.length} queued messages...`);
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            try {
              if (typeof msg === 'string' && msg.includes('"setup"')) {
                console.log("[Agent|GEMINI|WS] Discarding redundant client setup payload from queue.");
                continue;
              }
              ws.send(msg);
            } catch(e) {
              console.error("[Agent|GEMINI|WS] ❌ Error flushing queue msg:", e.message, e.stack);
            }
          }
        }

        this.broadcast(data);
      });

      ws.addEventListener("close", (event) => {
        console.log(`[Agent|GEMINI|WS] 🔴 Upstream Gemini WebSocket Closed.`);
        console.log(`[Agent|GEMINI|WS] Close Code: ${event.code}`);
        console.log(`[Agent|GEMINI|WS] Close Reason: ${event.reason || 'No reason provided'}`);
        console.log(`[Agent|GEMINI|WS] Was Clean: ${event.wasClean}`);
        this.geminiWs = null;
        this.isGeminiSetupComplete = false;
        this.broadcast(JSON.stringify({ 
          event: "stage_closed", 
          reason: "Gemini ended session",
          code: event.code,
          details: event.reason
        }));
      });

      ws.addEventListener("error", (err) => {
        console.error("[Agent|GEMINI|WS] ❌ Upstream Gemini WebSocket Error Triggered.");
        console.error(`[Agent|GEMINI|WS] Error Details: ${err.message || err.error || JSON.stringify(err)}`);
        this.broadcast(JSON.stringify({
          event: "gemini_error",
          error: "Voice connection temporarily interrupted. Reconnecting..."
        }));
      });

    } catch (err) {
      console.error("[Agent|GEMINI|INIT] ❌ Failed to initialize Gemini Live connection:", err.message, err.stack);
      this.broadcast(JSON.stringify({ error: `Gemini connection failed: ${err.message}` }));
      this.isInitializingGemini = false;
    }
  }

  broadcast(data) {
    const sockets = this.ctx.getWebSockets();
    let sentCount = 0;
    for (const sock of sockets) {
      try {
        sock.send(data);
        sentCount++;
      } catch (err) {
        console.error(`[Agent|DO|BROADCAST] ❌ Failed to broadcast payload to a connection:`, err.message);
      }
    }
  }
}

// ==============================================================================
// GLOBAL SESSION HUB & ROUTER
// ==============================================================================
async function getActiveSessions(env) {
  const sessions = [];
  const seen = new Set();

  // 1. Fetch live in-memory sessions from God-Mode registry (1-on-1 voice & active stages)
  try {
    const globalId = env.GeminiLiveAgent.idFromName("debug-global");
    const globalStub = env.GeminiLiveAgent.get(globalId);
    const regRes = await globalStub.fetch("https://gemini-live-worker/active-registry");
    if (regRes.ok) {
      const activeList = await regRes.json();
      for (const item of activeList) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          sessions.push(item);
        }
      }
    }
  } catch (e) {
    console.error("[Registry|ActiveFetch|Error]", e.message);
  }

  // 2. Fetch active stages from Supabase that have an active heartbeat within the last 45s
  const supabaseUrl = env?.SUPABASE_URL;
  const serviceKey = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return sessions;

  try {
    const thresholdIso = new Date(Date.now() - 45000).toISOString();
    const res = await fetch(`${supabaseUrl}/rest/v1/conversations?metadata->>is_live=eq.true&metadata->>live_heartbeat=gte.${thresholdIso}&select=id,metadata&limit=10`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
    });
    const liveConvs = res.ok ? await res.json() : [];

    for (const c of liveConvs) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        const meta = c.metadata || {};
        const topic = meta.live_topic || 'Live Group Stage';
        sessions.push({
          id: c.id,
          type: "Group Live Stage",
          isLive: true,
          label: `${topic} (${c.id.slice(0, 8)}...)`
        });
      }
    }
  } catch (e) {
    console.error("[SessionPicker|SupabaseSync|Error]", e.message);
  }

  return sessions;
}

function renderSessionPickerHtml(sessions) {
  const sessionRowsHtml = sessions.length > 0 ? sessions.map(s => `
    <a href="/inspect?agent=${encodeURIComponent(s.id)}" class="session-item">
      <div class="session-info">
        <div class="session-name">
          <span class="badge ${s.isLive ? 'badge-live' : 'badge-conv'}">${s.isLive ? '● LIVE' : s.type}</span>
          ${s.label}
        </div>
        <div class="session-id">${s.id}</div>
      </div>
      <span class="connect-tag">Inspect ➜</span>
    </a>
  `).join("") : '<div class="empty-state">No active stages currently detected in Supabase.<br/>Launch the debug sandbox or connect to a custom ID below.</div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Miron Live — Session Inspector</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0c0d12; color: #d1d5db; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #13151f; border: 1px solid #232738; border-radius: 12px; max-width: 580px; width: 100%; padding: 24px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid #1f2334; }
    .title-row { display: flex; align-items: center; gap: 10px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #10b981; box-shadow: 0 0 10px #10b981; }
    h1 { font-size: 15px; font-weight: 700; color: #f9fafb; }
    .subtitle { font-size: 11px; color: #6b7280; margin-top: 2px; }
    .section-title { font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; color: #9ca3af; margin: 16px 0 8px; }
    .session-list { display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto; }
    .session-item { display: flex; align-items: center; justify-content: space-between; background: #1a1d2d; border: 1px solid #282d45; padding: 10px 14px; border-radius: 8px; text-decoration: none; color: inherit; transition: all 0.15s; }
    .session-item:hover { border-color: #3b82f6; background: #20243a; transform: translateY(-1px); }
    .session-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .session-name { font-weight: 600; color: #f3f4f6; font-size: 13px; display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .session-id { font-size: 10px; color: #6b7280; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badge { font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; flex-shrink: 0; }
    .badge-live { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid #059669; }
    .badge-conv { background: rgba(59, 130, 246, 0.2); color: #93c5fd; border: 1px solid #2563eb; }
    .connect-tag { background: #2563eb; color: #fff; font-size: 11px; font-weight: 600; padding: 5px 10px; border-radius: 6px; flex-shrink: 0; margin-left: 10px; }
    .empty-state { padding: 24px; text-align: center; color: #6b7280; font-size: 12px; border: 1px dashed #232738; border-radius: 8px; line-height: 1.5; }
    .manual-box { margin-top: 18px; padding-top: 16px; border-top: 1px solid #1f2334; display: flex; gap: 8px; }
    .manual-input { flex: 1; background: #0c0d12; border: 1px solid #282d45; color: #f9fafb; padding: 8px 12px; border-radius: 6px; font-size: 12px; font-family: monospace; outline: none; }
    .manual-input:focus { border-color: #3b82f6; }
    .submit-btn { background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .submit-btn:hover { background: #2563eb; }
    .sandbox-btn { background: #1a1d2d; color: #9ca3af; border: 1px solid #282d45; padding: 9px 14px; border-radius: 6px; font-size: 11px; cursor: pointer; text-decoration: none; display: block; text-align: center; margin-top: 10px; transition: 0.15s; }
    .sandbox-btn:hover { background: #282d45; color: #fff; border-color: #3b82f6; }
    .refresh-btn { background: #232738; color: #e5e7eb; border: none; padding: 5px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; }
    .refresh-btn:hover { background: #374151; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title-row">
        <div class="dot"></div>
        <div>
          <h1>Miron Live Mission Control</h1>
          <div class="subtitle">Global Session Router & Diagnostics</div>
        </div>
      </div>
      <button class="refresh-btn" onclick="location.reload()">Refresh</button>
    </div>

    <div class="section-title">Active & Recent Sessions (${sessions.length})</div>
    <div class="session-list">
      ${sessionRowsHtml}
    </div>

    <div class="section-title">Direct Connection</div>
    <form class="manual-box" onsubmit="event.preventDefault(); const v = document.getElementById('manual-id').value.trim(); if(v) location.href = '/inspect?agent=' + encodeURIComponent(v);">
      <input type="text" id="manual-id" class="manual-input" placeholder="Enter conversation UUID or personal agent ID..." />
      <button type="submit" class="submit-btn">Inspect</button>
    </form>
    <a href="/inspect" class="sandbox-btn">⚡ Launch Global Live Terminal (debug-global)</a>
  </div>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    console.log(`[GeminiWorker|Router] 🚀 Incoming request: ${request.method} ${request.url}`);
    const url = new URL(request.url);
    
    if (url.pathname === '/inspect') {
      let agentId = url.searchParams.get("agent");
      const wantsPicker = url.searchParams.get("view") === "picker" || url.searchParams.get("picker") === "true";

      if (!agentId) {
        if (wantsPicker) {
          const sessions = await getActiveSessions(env);
          return new Response(renderSessionPickerHtml(sessions), {
            headers: { "Content-Type": "text/html; charset=utf-8" }
          });
        }
        // Default directly to the God-Mode Live Terminal
        agentId = "debug-global";
      }

      console.log(`[GeminiWorker|Router] Routing to Durable Object for Agent ID: ${agentId}`);
      const id = env.GeminiLiveAgent.idFromName(agentId);
      const stub = env.GeminiLiveAgent.get(id);
      return stub.fetch(request);
    }

    if (url.pathname === '/realtime-ai') {
      let agentId = url.searchParams.get("agent");

      if (!agentId && request.method === "POST") {
        try {
          const clone = request.clone();
          const body = await clone.json();
          agentId = body.record?.conversation_id;
          console.log(`[GeminiWorker|Router] Webhook routing detected for Agent ID: ${agentId}`);
        } catch (e) {
          console.error("[GeminiWorker|Router] Failed to autodetect agent ID from webhook JSON body:", e.message);
        }
      }

      if (!agentId) {
        console.error("[GeminiWorker|Router] ❌ Missing agent ID in URL query and webhook payload");
        return new Response("Missing agent ID", { status: 400 });
      }
      
      console.log(`[GeminiWorker|Router] Resolving Native Durable Object for Stage UUID: ${agentId}`);
      try {
        const id = env.GeminiLiveAgent.idFromName(agentId);
        const stub = env.GeminiLiveAgent.get(id);
        return stub.fetch(request);
      } catch(err) {
        console.error(`[GeminiWorker|Router] ❌ Error routing to Native DO: ${err.message}\nStack: ${err.stack}`);
        return new Response(`Native DO routing error: ${err.message}`, { status: 500 });
      }
    }
    
    return new Response("Gemini Live Edge Worker active. Hit /inspect or /realtime-ai.", { status: 200 });
  }
};