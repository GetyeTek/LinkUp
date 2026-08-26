import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding, x-linkup-client",
};

const GEMINI_MODEL = "gemini-2.0-flash";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("Missing Authorization header");
    const token = authHeader.replace('Bearer ', '');

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 1. Authenticate User
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) throw new Error("Invalid authorization token.");
    const userId = user.id;

    // 2. Fetch User Telemetry & Academic Status in Parallel
    const [profileRes, pacingRes, weaknessesRes, positionsRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name, username, freshman_stream, department, level, current_streak, created_at').eq('id', userId).single(),
      supabase.rpc('get_student_academic_pacing', { p_user_id: userId }),
      supabase.rpc('get_user_weaknesses', { p_user_id: userId }),
      supabase.rpc('get_user_course_positions', { p_user_id: userId })
    ]);

    const profile = profileRes.data || {};
    const pacingData = pacingRes.data || { courses: [] };
    const weaknesses = weaknessesRes.data || [];
    const positions = positionsRes.data || [];

    const studentName = profile.full_name?.split(' ')[0] || "Scholar";
    const studentStream = profile.freshman_stream || "Natural Science";
    
    // Check if Newcomer (No attempts or < 3 days old with minimal readings)
    const isNewcomer = weaknesses.length === 0 && positions.length === 0;

    // 3. Round-Robin Gemini API Key Lease
    const { data: keyData, error: keyErr } = await supabase.rpc('lease_gemini_api_key');
    if (keyErr || !keyData || keyData.length === 0) {
      throw new Error("No active Gemini API key available.");
    }
    const geminiKey = keyData[0].api_key;

    // 4. Construct AI System Prompt & User Context
    const systemPrompt = `You are Miron, an expert peer tutor and a brilliant, supportive classmate to ${studentName}.
You are creating a personalized, hyper-focused "Plan My Day" study itinerary for your friend.

PERSONALITY & TONE:
- Write in your signature informal, supportive Ethio-English peer tone (ride-or-die study buddy style).
- Blend Amharic words (in Ge'ez/Fidel alphabet) naturally with English academic words, university slang, and conversational phrases.
- Address ${studentName} warmly and enthusiastically.

PLANNING RULES:
1. NEWCOMER HANDLING:
   - If the student is a newcomer (is_newcomer is true), warmly welcome them to LinkUp!
   - Because weakness data is not yet available, recommend foundational core courses based on their stream (${studentStream}):
     * Natural Science Core: Mathematics (MATH 1012), General Physics (PHYS 1011), Logic (LOCT 1011), General Chemistry (CHEM 1012).
     * Social Science Core: Mathematics (MATH 1011), Economics (ECON 1011), Geography (GEES 1011), Anthropology (ANTH 1012).
   - If the semester progress_ratio is low (< 0.15 / summer), default to Chapter 1. If mid-semester, suggest the expected campus chapter with an encouraging high-yield catch-up note.
2. VETERAN HANDLING:
   - If weakness data exists, prioritize their top 1-2 weakest topics (< 60% accuracy) for an active recall drill.
   - If a course is marked "behind", schedule a high-yield reading session to bridge the syllabus gap.
3. SCHEDULE STRUCTURE:
   - Break the plan into 2 to 3 chronological or milestone phases (e.g., Phase 1 • Deep Focus, Phase 2 • Active Recall, Phase 3 • Evening Overview).
   - Provide realistic durations (20-40 mins each, totaling 60-90 minutes).
   - Explicitly detail what exact chapter, section, and concepts they will master.

You MUST respond strictly with a valid JSON object matching this schema (no markdown wrappers):
{
  "greeting_title": "String (e.g. Good morning, ${studentName}! ☀️)",
  "miron_briefing": "String (Conversational Ethio-English peer explanation of today's game plan)",
  "estimated_total_minutes": Number (e.g. 75),
  "vibe_tag": "String (e.g. ⚡ High-Yield Catch-Up Sprint | 🎯 Exam Readiness | 🚀 Freshman Jumpstart)",
  "schedule_blocks": [
    {
      "order": 1,
      "time_label": "Phase 1 • Deep Focus",
      "duration_minutes": 35,
      "course_code": "PHYS 1011",
      "course_title": "General Physics",
      "task_type": "read",
      "chapter_title": "Chapter 3: Work and Energy",
      "lesson_title": "Section 3.2: Kinetic Energy & Work-Energy Theorem",
      "focus_summary": "Read the work-energy theorem derivation and worked examples on page 64.",
      "action": {
        "type": "open_book",
        "book_id": "UUID from context",
        "page_number": 64,
        "course_code": "PHYS 1011"
      }
    }
  ],
  "motivational_closer": "String (Encouraging sign-off)"
}`;

    const studentContextPayload = {
      is_newcomer: isNewcomer,
      student_name: studentName,
      stream: studentStream,
      department: profile.department,
      current_streak: profile.current_streak || 0,
      academic_pacing: pacingData,
      weaknesses: weaknesses.slice(0, 3),
      reading_positions: positions.slice(0, 4)
    };

    // 5. Call Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`;
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: `Student Context:\n${JSON.stringify(studentContextPayload, null, 2)}\n\nGenerate my personalized daily study plan.` }] }
        ],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.7
        }
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API Error: ${geminiRes.status} ${errText}`);
    }

    const geminiData = await geminiRes.json();
    const rawOutput = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawOutput) throw new Error("Empty response from AI engine.");

    const planJson = JSON.parse(rawOutput);

    return new Response(JSON.stringify({ success: true, plan: planJson }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("[PlanMyDay Error]:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});