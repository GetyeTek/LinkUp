import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Provide WebSocket transport for Node environments without native support
if (typeof globalThis.WebSocket === 'undefined') {
    try {
        const { default: WebSocket } = await import('ws');
        globalThis.WebSocket = WebSocket;
    } catch (e) {}
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '5', 10);
const FORCE_RETRY = process.env.FORCE_RETRY === 'true';
const FORCE_REGENERATE = process.env.FORCE_REGENERATE === 'true';
const FORCE_RETRANSCRIBE = process.env.FORCE_RETRANSCRIBE === 'true';
const TARGET_LESSON_ID = (process.env.TARGET_LESSON_ID || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- 1. SCRIPT NORMALIZER & CUE MAPPING ---
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

        if (cueType === 'section' || cueType === 'section_start') {
            const parts = rawTarget.split(':');
            const sectionTag = parts[0]?.trim() || '';
            const sectionTitle = (parts.slice(1).join(':') || sectionTag).trim();

            sectionCues.push({
                type: 'section',
                tag: sectionTag,
                title: sectionTitle,
                wordIndex: anchorWordIndex,
                anchorWord: anchorWord.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
            });
        } else {
            visualCues.push({
                type: cueType,
                target: rawTarget,
                wordIndex: anchorWordIndex,
                anchorWord: anchorWord.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
            });
        }

        lastIdx = match.index + match[0].length;
    }

    cleanText += rawScript.slice(lastIdx);
    cleanText = cleanText.replace(/\s+/g, ' ').trim();

    return { cleanText, visualCues, sectionCues };
}

// --- 2. LEASE API KEY WITH ROTATION ---
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

// --- 3. CALL GEMINI 3.8 FLASH TTS ---
async function generateSpeechTTS(text, apiKeyObj) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent?key=${apiKeyObj.api_key}`;

    const payload = {
        contents: [{
            parts: [{ text: text }]
        }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: "Puck"
                    }
                }
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
        throw new Error(`Gemini TTS API error (${res.status}): ${errText}`);
    }

    const json = await res.json();
    const candidate = json.candidates?.[0];
    const part = candidate?.content?.parts?.[0];

    if (!part?.inlineData?.data) {
        throw new Error(`Gemini TTS returned no audio data: ${JSON.stringify(json)}`);
    }

    return {
        base64Audio: part.inlineData.data,
        mimeType: part.inlineData.mimeType || 'audio/pcm'
    };
}

// --- 4. ACCURATE AUDIO DURATION HELPER ---
function getAudioDurationSeconds(filePath) {
    try {
        const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, { encoding: 'utf-8' });
        const val = parseFloat(out.trim());
        if (!isNaN(val) && val > 0) return Number(val.toFixed(2));
    } catch (e) {}
    return 0;
}

// --- 5. CALL GEMINI 3.5 TRANSCRIBE (NATIVE AUDIO TRANSCRIPTION) ---
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

// --- 6. ALIGN CUES & ASSEMBLE SECTION MANIFEST ---
function resolveWordTime(cue, wordsList, fallbackDuration) {
    if (!Array.isArray(wordsList) || wordsList.length === 0) return 0;

    const cleanAnchor = (cue.anchorWord || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '');

    // 1. Search locally within a window (+/- 25 words) of expected index
    if (cleanAnchor && cue.wordIndex !== undefined) {
        const startWin = Math.max(0, cue.wordIndex - 25);
        const endWin = Math.min(wordsList.length - 1, cue.wordIndex + 25);
        for (let i = startWin; i <= endWin; i++) {
            const wClean = (wordsList[i].word || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
            if (wClean === cleanAnchor) {
                return wordsList[i].end || wordsList[i].start || 0;
            }
        }
    }

    // 2. Direct index fallback if within bounds
    if (wordsList[cue.wordIndex]) {
        return wordsList[cue.wordIndex].end || wordsList[cue.wordIndex].start || 0;
    }

    // 3. Global search for anchor word
    if (cleanAnchor) {
        const found = wordsList.find(w => (w.word || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '') === cleanAnchor);
        if (found) return found.end || found.start || 0;
    }

    return fallbackDuration;
}

function alignVisualCuesWithTimestamps(visualCues, wordsList, fallbackDuration) {
    if (!Array.isArray(wordsList) || wordsList.length === 0) {
        return visualCues.map((c, i) => ({
            time: Number((i * 3.0).toFixed(2)),
            type: c.type,
            target: c.target
        }));
    }

    return visualCues.map(cue => {
        const matchedTime = resolveWordTime(cue, wordsList, fallbackDuration);
        return {
            time: Number(Number(matchedTime).toFixed(2)),
            type: cue.type,
            target: cue.target
        };
    });
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
        startTime: Number(Number(resolveWordTime(c, wordsList, totalDuration)).toFixed(2))
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

// --- 7. PROCESS SINGLE LESSON (WITH SMART RESUME) ---
async function processLesson(lesson) {
    console.log(`\n======================================================`);
    console.log(`🎙️ Processing: [${lesson.course_code}] ${lesson.chapter_title} -> ${lesson.section_title} (ID: ${lesson.id})`);
    console.log(`======================================================`);

    const tempDir = path.join(process.cwd(), 'temp_audio');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const rawAudioFile = path.join(tempDir, `${lesson.id}_raw.pcm`);
    const finalMp3File = path.join(tempDir, `${lesson.id}_final.mp3`);

    // Sanitize course folder name: replace all spaces with underscores
    const sanitizedFolder = (lesson.course_code || 'misc')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_\-]/g, '');
    const storagePath = `${sanitizedFolder}/${lesson.id}.mp3`;

    const legacySpaceFolder = (lesson.course_code || 'misc').toLowerCase().trim();
    let downloadPath = storagePath;
    let publicUrl = lesson.audio_url || null;

    try {
        const { cleanText, visualCues, sectionCues } = parseScriptCues(lesson.script_raw);
        console.log(`📝 Clean text: ${cleanText.length} chars | Visual cues: ${visualCues.length} | Section markers: ${sectionCues.length}`);

        // SMART RESUME & RETRANSCRIBE CHECK
        if (FORCE_RETRANSCRIBE) {
            console.log(`⚡ FORCE_RETRANSCRIBE active: Reusing existing audio asset and skipping TTS.`);
        } else if (FORCE_REGENERATE) {
            console.log(`🔄 Force regeneration active: Bypassing storage cache and synthesizing fresh TTS audio.`);
            publicUrl = null;
        } else if (lesson.status === 'pending') {
            console.log(`🆕 Lesson status is 'pending': Generating fresh TTS audio to match updated script.`);
            publicUrl = null;
        }

        if (!publicUrl) {
            let { data: fileMatches } = await supabase.storage
                .from('book-audio-lectures')
                .list(sanitizedFolder, { search: `${lesson.id}.mp3` });

            if (Array.isArray(fileMatches) && fileMatches.some(f => f.name === `${lesson.id}.mp3`)) {
                downloadPath = storagePath;
                const { data } = supabase.storage.from('book-audio-lectures').getPublicUrl(storagePath);
                publicUrl = data?.publicUrl || null;
            } else {
                // Check legacy space folder for backward-compatibility
                const { data: legacyMatches } = await supabase.storage
                    .from('book-audio-lectures')
                    .list(legacySpaceFolder, { search: `${lesson.id}.mp3` });

                if (Array.isArray(legacyMatches) && legacyMatches.some(f => f.name === `${lesson.id}.mp3`)) {
                    downloadPath = `${legacySpaceFolder}/${lesson.id}.mp3`;
                    const { data } = supabase.storage.from('book-audio-lectures').getPublicUrl(downloadPath);
                    publicUrl = data?.publicUrl || null;
                }
            }
        }

        if (publicUrl) {
            console.log(`⚡ Existing audio asset found! (${publicUrl})`);
            console.log(`⚡ Skipping Gemini 3.8 Flash TTS. Downloading cached MP3 from: ${downloadPath}`);
            const { data: dlBlob, error: dlErr } = await supabase.storage
                .from('book-audio-lectures')
                .download(downloadPath);

            if (dlErr || !dlBlob) throw new Error(`Failed to download audio from bucket: ${dlErr?.message}`);
            const arrayBuffer = await dlBlob.arrayBuffer();
            fs.writeFileSync(finalMp3File, Buffer.from(arrayBuffer));
        } else {
            // Synthesize fresh audio
            await supabase
                .from('book_audio_lessons')
                .update({ status: 'processing', updated_at: new Date().toISOString() })
                .eq('id', lesson.id);

            const keyObj = await getLeasedGeminiKey();
            console.log(`🔑 Leased API Key ID for TTS: #${keyObj.id}`);

            console.log(`🔊 Calling Gemini 3.8 Flash TTS...`);
            const { base64Audio, mimeType } = await generateSpeechTTS(cleanText, keyObj);

            const audioBuffer = Buffer.from(base64Audio, 'base64');
            fs.writeFileSync(rawAudioFile, audioBuffer);

            console.log(`🎛️ Transcoding via FFmpeg to 32kbps Mono MP3...`);
            if (mimeType.includes('pcm')) {
                execSync(`ffmpeg -y -f s16le -ar 24000 -ac 1 -i "${rawAudioFile}" -c:a libmp3lame -b:a 32k -ar 24000 "${finalMp3File}"`, { stdio: 'pipe' });
            } else {
                execSync(`ffmpeg -y -i "${rawAudioFile}" -c:a libmp3lame -b:a 32k -ar 24000 "${finalMp3File}"`, { stdio: 'pipe' });
            }

            const mp3Buffer = fs.readFileSync(finalMp3File);
            console.log(`✅ Compressed MP3 created: ${(mp3Buffer.length / 1024).toFixed(1)} KB`);

            console.log(`☁️ Uploading to storage bucket: book-audio-lectures/${storagePath}`);
            const { error: uploadError } = await supabase.storage
                .from('book-audio-lectures')
                .upload(storagePath, mp3Buffer, { contentType: 'audio/mpeg', upsert: true });

            if (uploadError) throw new Error(`Supabase storage upload failed: ${uploadError.message}`);

            const { data } = supabase.storage.from('book-audio-lectures').getPublicUrl(storagePath);
            publicUrl = data?.publicUrl;

            // CHECKPOINT: Save audio_url immediately
            await supabase
                .from('book_audio_lessons')
                .update({ audio_url: publicUrl, status: 'audio_ready', updated_at: new Date().toISOString() })
                .eq('id', lesson.id);
            console.log(`💾 Checkpointed audio_url into DB (status: audio_ready)`);
        }

        // Measure true hardware duration via ffprobe
        const trueDuration = getAudioDurationSeconds(finalMp3File);
        console.log(`⏱️ Verified hardware duration: ${trueDuration}s`);

        // Prepare MP3 base64 for transcription
        const mp3Bytes = fs.readFileSync(finalMp3File);
        const mp3Base64 = mp3Bytes.toString('base64');

        // Transcribe & Align
        const transcribeKey = await getLeasedGeminiKey();
        console.log(`🔑 Leased API Key ID for Transcribe: #${transcribeKey.id}`);

        console.log(`🔍 Transcribing audio for word timestamps...`);
        const transcriptionResult = await transcribeAudioWithWordTimestamps(mp3Base64, transcribeKey, trueDuration);

        const words = transcriptionResult.words || [];
        const finalDuration = Number(transcriptionResult.duration || trueDuration);
        console.log(`⏱️ Final Duration: ${finalDuration}s | Total Words: ${words.length}`);

        const visualTimeline = alignVisualCuesWithTimestamps(visualCues, words, finalDuration);
        const sectionsManifest = buildSectionsManifest(sectionCues, words, finalDuration, lesson);
        console.log(`🎯 Aligned Visual Events: ${visualTimeline.length} | Sections in Manifest: ${sectionsManifest.length}`);

        // Final Commit
        const { error: dbError } = await supabase
            .from('book_audio_lessons')
            .update({
                audio_url: publicUrl,
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

        console.log(`🎉 Lesson #${lesson.id} successfully completed and marked READY!`);
    } catch (err) {
        console.error(`❌ Lesson #${lesson.id} failed:`, err.message);
        const updatePayload = {
            status: 'failed',
            audio_url: publicUrl || lesson.audio_url || null,
            word_timestamps: null,
            cue_timeline: null,
            error_message: err.message,
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
            // Fallback in case raw_transcribe_output column was not yet added via SQL
            delete updatePayload.raw_transcribe_output;
            await supabase
                .from('book_audio_lessons')
                .update(updatePayload)
                .eq('id', lesson.id);
        }
    } finally {
        if (fs.existsSync(rawAudioFile)) fs.unlinkSync(rawAudioFile);
        if (fs.existsSync(finalMp3File)) fs.unlinkSync(finalMp3File);
    }
}

// --- 8. MAIN RUNNER ---
async function main() {
    console.log(`🚀 Starting Miron Audio Processing Engine`);
    if (TARGET_LESSON_ID) console.log(`🎯 Targeted Lesson ID: ${TARGET_LESSON_ID}`);
    console.log(`⚙️ Config: Batch Size: ${BATCH_SIZE} | Retry Failed: ${FORCE_RETRY} | Force Regenerate: ${FORCE_REGENERATE} | Force Retranscribe: ${FORCE_RETRANSCRIBE}`);

    let lessons = [];

    if (TARGET_LESSON_ID) {
        const { data, error } = await supabase
            .from('book_audio_lessons')
            .select('*')
            .eq('id', TARGET_LESSON_ID);

        if (error) {
            console.error(`❌ Failed to fetch targeted lesson #${TARGET_LESSON_ID}:`, error.message);
            process.exit(1);
        }
        lessons = data || [];
        if (lessons.length === 0) {
            console.log(`⚠️ No lesson found matching ID: ${TARGET_LESSON_ID}`);
            return;
        }
    } else {
        const statusList = FORCE_RETRANSCRIBE
            ? ['pending', 'audio_ready', 'ready', 'failed']
            : FORCE_RETRY
                ? ['pending', 'audio_ready', 'failed']
                : ['pending', 'audio_ready'];

        const { data, error } = await supabase
            .from('book_audio_lessons')
            .select('*')
            .in('status', statusList)
            .order('created_at', { ascending: true })
            .limit(BATCH_SIZE);

        if (error) {
            console.error('❌ Failed to fetch lessons from database:', error.message);
            process.exit(1);
        }
        lessons = data || [];
    }

    if (!lessons || lessons.length === 0) {
        console.log('✨ No matching lessons found in queue. Everything is up to date.');
        return;
    }

    console.log(`📋 Found ${lessons.length} lesson(s) to process.`);

    for (const lesson of lessons) {
        await processLesson(lesson);
        await sleep(1500);
    }

    console.log(`🏁 Batch run complete.`);
}

main().catch(err => {
    console.error('Fatal pipeline crash:', err);
    process.exit(1);
});