import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

if (typeof globalThis.WebSocket === 'undefined') {
    try {
        const { default: WebSocket } = await import('ws');
        globalThis.WebSocket = WebSocket;
    } catch (e) {}
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '5', 10);
const TARGET_LESSON_ID = (process.env.TARGET_LESSON_ID || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function parseScriptCues(rawScript) {
    const cueRegex = /\[\[(?:cue|call):([a-zA-Z0-9_\-]+)(?::([\s\S]*?))?\]\]/g;
    const visualCues = [];
    const sectionCues = [];
    let cleanText = '';
    let lastIdx = 0;
    let match;

    while ((match = cueRegex.exec(rawScript)) !== null) {
        const textBefore = rawScript.slice(lastIdx, match.index);
        cleanText += textBefore;

        const wordsBefore = cleanText.trim().split(/\s+/).filter(Boolean);
        const anchorWordIndex = Math.max(0, wordsBefore.length - 1);
        const anchorWord = wordsBefore[anchorWordIndex] || '';
        const cueType = match[1].trim();
        const rawTarget = (match[2] || '').trim();

        if (cueType === 'meta') {
            lastIdx = match.index + match[0].length;
            continue;
        }

        if (cueType === 'section' || cueType === 'section_start') {
            const parts = rawTarget.split(':');
            const sectionTag = parts[0]?.trim() || '';
            const sectionTitle = (parts.slice(1).join(':') || sectionTag).trim();

            sectionCues.push({
                type: 'section',
                tag: sectionTag,
                title: sectionTitle,
                wordIndex: anchorWordIndex,
                anchorWord: anchorWord.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
            });
        } else {
            // Handles visual cues: show_diagram, show_image, zoom, bullet, note_card, and page_block (e.g. page_block:12:3:1)
            visualCues.push({
                type: cueType,
                target: rawTarget,
                wordIndex: anchorWordIndex,
                anchorWord: anchorWord.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
            });
        }

        lastIdx = match.index + match[0].length;
    }

    cleanText += rawScript.slice(lastIdx);
    cleanText = cleanText.replace(/\s+/g, ' ').trim();

    return { cleanText, visualCues, sectionCues };
}

async function getLeasedGeminiKey() {
    const { data, error } = await supabase.rpc('lease_gemini_api_key');
    if (error || !data || data.length === 0) {
        throw new Error(`Failed to lease Gemini API key: ${error?.message || 'No available keys'}`);
    }
    return data[0];
}

async function cooldownKey(keyId, seconds = 300) {
    try {
        await supabase.rpc('cooldown_gemini_api_key', { p_id: keyId, p_seconds: seconds });
    } catch (e) {
        console.warn(`Could not set cooldown for key ID ${keyId}:`, e.message);
    }
}

function getAudioDurationSeconds(filePath) {
    try {
        const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, { encoding: 'utf-8' });
        const val = parseFloat(out.trim());
        if (!isNaN(val) && val > 0) return Number(val.toFixed(2));
    } catch (e) {}
    return 0;
}

async function transcribeAudioWithWordTimestamps(mp3Base64, apiKeyObj, fallbackDuration) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent?key=${apiKeyObj.api_key}`;

    const payload = {
        contents: [{
            parts: [{
                inlineData: {
                    mimeType: "audio/mp3",
                    data: mp3Base64
                }
            }]
        }],
        generationConfig: {
            audioTranscriptionConfig: {
                mode: "VERBATIM",
                wordTimestamp: true
            }
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429) {
            await cooldownKey(apiKeyObj.id, 300);
        }
        const httpErr = new Error(`Gemini Transcribe HTTP ${res.status}: ${errText}`);
        httpErr.rawOutput = errText;
        throw httpErr;
    }

    const json = await res.json();
    const candidate = json.candidates?.[0];
    const part = candidate?.content?.parts?.[0];
    const transcription = part?.audioTranscription;

    if (!transcription || !Array.isArray(transcription.words)) {
        const emptyErr = new Error(`Gemini Transcribe returned no audioTranscription words. Candidate: ${JSON.stringify(part || json)}`);
        emptyErr.rawOutput = JSON.stringify(json);
        throw emptyErr;
    }

    const words = transcription.words.map(w => ({
        word: w.word || '',
        start: Number(parseFloat(w.startOffset || '0').toFixed(2)),
        end: Number(parseFloat(w.endOffset || '0').toFixed(2))
    }));

    if (words.length === 0) {
        const noWordsErr = new Error(`Gemini Transcribe returned empty words array.`);
        noWordsErr.rawOutput = JSON.stringify(json);
        throw noWordsErr;
    }

    const lastWord = words[words.length - 1];
    const finalDuration = lastWord ? lastWord.end : fallbackDuration;

    return {
        duration: Number(finalDuration.toFixed(2)),
        words: words,
        rawOutput: transcription.text || ''
    };
}

const VISUAL_LEAD_OFFSET = 0.22; // 220ms anticipatory visual priming

function resolveWordTime(cue, wordsList, fallbackDuration, isVisual = false) {
    if (!Array.isArray(wordsList) || wordsList.length === 0) return 0;

    const cleanAnchor = (cue.anchorWord || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

    const getTimestamp = (w) => {
        if (!w) return fallbackDuration;
        // Anchor to the acoustic onset (start) rather than trailing edge (end)
        const base = typeof w.start === 'number' && !isNaN(w.start) ? w.start : (w.end || 0);
        return isVisual ? Math.max(0, base - VISUAL_LEAD_OFFSET) : base;
    };

    // 1. Sliding Window with Distance-Minimized Optimal Match (Prevents stop-word bunching)
    if (cleanAnchor && cue.wordIndex !== undefined) {
        const startWin = Math.max(0, cue.wordIndex - 35);
        const endWin = Math.min(wordsList.length - 1, cue.wordIndex + 35);
        let bestMatch = null;
        let minDistance = Infinity;

        for (let i = startWin; i <= endWin; i++) {
            const wClean = (wordsList[i].word || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
            if (wClean === cleanAnchor) {
                const distance = Math.abs(i - cue.wordIndex);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = wordsList[i];
                }
            }
        }

        if (bestMatch) {
            return getTimestamp(bestMatch);
        }
    }

    // 2. Direct Index Fallback
    if (wordsList[cue.wordIndex]) {
        return getTimestamp(wordsList[cue.wordIndex]);
    }

    // 3. Global Proximity Search (Find closest matching word globally if window missed)
    if (cleanAnchor) {
        let globalBest = null;
        let globalMinDist = Infinity;
        const targetIdx = cue.wordIndex || 0;

        for (let i = 0; i < wordsList.length; i++) {
            const wClean = (wordsList[i].word || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
            if (wClean === cleanAnchor) {
                const dist = Math.abs(i - targetIdx);
                if (dist < globalMinDist) {
                    globalMinDist = dist;
                    globalBest = wordsList[i];
                }
            }
        }
        if (globalBest) return getTimestamp(globalBest);
    }

    return fallbackDuration;
}

function alignVisualCuesWithTimestamps(visualCues, wordsList, fallbackDuration) {
    if (!Array.isArray(wordsList) || wordsList.length === 0) {
        return visualCues.map((c, i) => ({
            time: Number((i * 3.0).toFixed(2)),
            type: c.type,
            target: c.target
        })).sort((a, b) => a.time - b.time);
    }

    const timedCues = visualCues.map(cue => {
        const matchedTime = resolveWordTime(cue, wordsList, fallbackDuration, true);
        return {
            time: Number(Number(matchedTime).toFixed(2)),
            type: cue.type,
            target: cue.target
        };
    });

    // Strictly guarantee ascending chronological order so sequential break evaluation never drops cues
    return timedCues.sort((a, b) => a.time - b.time);
}

function buildSectionsManifest(sectionCues, wordsList, totalDuration, defaultLesson) {
    if (!Array.isArray(sectionCues) || sectionCues.length === 0) {
        const fallbackTag = (defaultLesson.section_title || '').match(/^([0-9]+(?:\.[0-9]+)*)/)?.[1] || '1.1';
        return [{
            section_tag: fallbackTag,
            title: defaultLesson.section_title || 'Core Lecture',
            start_time: 0,
            end_time: Number(Number(totalDuration).toFixed(2)),
            duration: Number(Number(totalDuration).toFixed(2))
        }];
    }

    const timedSections = sectionCues.map(c => ({
        tag: c.tag,
        title: c.title,
        startTime: Number(Number(resolveWordTime(c, wordsList, totalDuration, false)).toFixed(2))
    }));

    timedSections.sort((a, b) => a.startTime - b.startTime);

    return timedSections.map((sec, idx) => {
        const nextSec = timedSections[idx + 1];
        const endTime = nextSec ? nextSec.startTime : Number(Number(totalDuration).toFixed(2));
        const span = Math.max(0, endTime - sec.startTime);
        return {
            section_tag: sec.tag,
            title: sec.title,
            start_time: sec.startTime,
            end_time: endTime,
            duration: Number(span.toFixed(2))
        };
    });
}

async function processAlignment(lesson) {
    console.log(`\n======================================================`);
    console.log(`⏱️ [Acoustic Alignment] [${lesson.course_code}] ${lesson.chapter_title} -> ${lesson.section_title} (ID: ${lesson.id})`);
    console.log(`======================================================`);

    const tempDir = path.join(process.cwd(), 'temp_audio');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const finalMp3File = path.join(tempDir, `${lesson.id}_final.mp3`);

    const sanitizedFolder = (lesson.course_code || 'misc')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_\-]/g, '');
    const storagePath = `${sanitizedFolder}/${lesson.id}.mp3`;

    try {
        const { visualCues, sectionCues } = parseScriptCues(lesson.script_raw);
        console.log(`🎯 Cues detected: ${visualCues.length} visual/camera/bullet events | ${sectionCues.length} section markers`);

        console.log(`📥 Downloading audio asset from storage: ${storagePath}`);
        const { data: dlBlob, error: dlErr } = await supabase.storage
            .from('book-audio-lectures')
            .download(storagePath);

        if (dlErr || !dlBlob) {
            throw new Error(`Audio asset not found in bucket. Run synthesis workflow first: ${dlErr?.message}`);
        }

        const arrayBuffer = await dlBlob.arrayBuffer();
        fs.writeFileSync(finalMp3File, Buffer.from(arrayBuffer));

        const trueDuration = getAudioDurationSeconds(finalMp3File);
        console.log(`⏱️ Verified hardware duration: ${trueDuration}s`);

        const mp3Bytes = fs.readFileSync(finalMp3File);
        const mp3Base64 = mp3Bytes.toString('base64');

        const transcribeKey = await getLeasedGeminiKey();
        console.log(`🔑 Leased API Key ID: #${transcribeKey.id}`);

        console.log(`🔍 Calling Gemini 3.5 Transcribe with native audioTranscriptionConfig...`);
        const result = await transcribeAudioWithWordTimestamps(mp3Base64, transcribeKey, trueDuration);

        const words = result.words || [];
        const finalDuration = Number(result.duration || trueDuration);
        console.log(`⏱️ Final Acoustic Duration: ${finalDuration}s | Total Words: ${words.length}`);

        const visualTimeline = alignVisualCuesWithTimestamps(visualCues, words, finalDuration);
        const sectionsManifest = buildSectionsManifest(sectionCues, words, finalDuration, lesson);
        console.log(`🎯 Aligned Events: ${visualTimeline.length} | Sections in Manifest: ${sectionsManifest.length}`);

        const { error: dbError } = await supabase
            .from('book_audio_lessons')
            .update({
                duration_seconds: finalDuration,
                cue_timeline: visualTimeline,
                sections_manifest: sectionsManifest,
                word_timestamps: words,
                status: 'ready',
                error_message: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', lesson.id);

        if (dbError) throw new Error(`DB commit failed: ${dbError.message}`);

        console.log(`🎉 Lesson #${lesson.id} successfully aligned and marked READY!`);
    } catch (err) {
        console.error(`❌ Alignment failed for #${lesson.id}:`, err.message);
        const updatePayload = {
            status: 'failed',
            error_message: `[Alignment Failure] ${err.message}`,
            updated_at: new Date().toISOString()
        };
        if (err.rawOutput) {
            updatePayload.raw_transcribe_output = typeof err.rawOutput === 'string' ? err.rawOutput : JSON.stringify(err.rawOutput);
        }

        const { error: updateErr } = await supabase
            .from('book_audio_lessons')
            .update(updatePayload)
            .eq('id', lesson.id);

        if (updateErr) {
            delete updatePayload.raw_transcribe_output;
            await supabase
                .from('book_audio_lessons')
                .update(updatePayload)
                .eq('id', lesson.id);
        }
        throw err;
    } finally {
        if (fs.existsSync(finalMp3File)) fs.unlinkSync(finalMp3File);
    }
}

async function main() {
    console.log(`🚀 Starting Miron Acoustic Alignment Engine`);
    if (TARGET_LESSON_ID) console.log(`🎯 Targeted Lesson ID: ${TARGET_LESSON_ID}`);
    console.log(`⚙️ Config: Batch Size: ${BATCH_SIZE}`);

    let lessons = [];

    if (TARGET_LESSON_ID) {
        const { data, error } = await supabase
            .from('book_audio_lessons')
            .select('*')
            .eq('id', TARGET_LESSON_ID);

        if (error) {
            console.error(`❌ Failed to fetch targeted lesson:`, error.message);
            process.exit(1);
        }
        lessons = data || [];
    } else {
        const { data, error } = await supabase
            .from('book_audio_lessons')
            .select('*')
            .in('status', ['audio_ready', 'ready', 'failed'])
            .order('created_at', { ascending: true })
            .limit(BATCH_SIZE);

        if (error) {
            console.error('❌ Failed to fetch queue from database:', error.message);
            process.exit(1);
        }
        lessons = data || [];
    }

    if (lessons.length === 0) {
        console.log('✨ No lessons requiring alignment found. Everything up to date.');
        return;
    }

    console.log(`📋 Found ${lessons.length} lesson(s) to align.`);

    let hasErrors = false;
    for (const lesson of lessons) {
        try {
            await processAlignment(lesson);
            await sleep(1500);
        } catch (e) {
            hasErrors = true;
        }
    }

    if (hasErrors) {
        console.error('\n💥 One or more lessons failed alignment. Failing runner.');
        process.exit(1);
    }

    console.log(`\n🏁 Alignment batch completed successfully.`);
}

main().catch(err => {
    console.error('Fatal runner crash:', err);
    process.exit(1);
});