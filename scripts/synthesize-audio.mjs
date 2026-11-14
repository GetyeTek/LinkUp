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
const FORCE_REGENERATE = process.env.FORCE_REGENERATE === 'true';
const TARGET_LESSON_ID = (process.env.TARGET_LESSON_ID || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function cleanScriptForTTS(rawScript) {
    const cueRegex = /\[\[(?:cue|call):[a-zA-Z0-9_\-]+(?::[\s\S]*?)?\]\]/g;
    return rawScript.replace(cueRegex, '').replace(/\s+/g, ' ').trim();
}

function auditRawScriptSyntax(rawScript) {
    const issues = [];
    const openCueRe = /\[\[(?:cue|call):/g;
    let openMatch;
    while ((openMatch = openCueRe.exec(rawScript)) !== null) {
        const rest = rawScript.slice(openMatch.index + openMatch[0].length);
        const closeIdx = rest.indexOf(']]');
        const nextOpenIdx = rest.search(/\[\[(?:cue|call):/);
        if (closeIdx === -1 || (nextOpenIdx !== -1 && nextOpenIdx < closeIdx)) {
            issues.push({
                severity: 'flagged',
                code: 'UNCLOSED_CUE_TAG',
                message: `Malformed or unclosed cue tag near index ${openMatch.index}: "${rawScript.slice(openMatch.index, openMatch.index + 60)}..."`
            });
        }
    }

    const cueRegex = /\[\[(?:cue|call):([a-zA-Z0-9_\-]+)(?::([\s\S]*?))?\]\]/g;
    let match;
    while ((match = cueRegex.exec(rawScript)) !== null) {
        const cueType = match[1].trim();
        const rawTarget = (match[2] || '').trim();

        if (['show_diagram', 'show_image', 'zoom', 'focus', 'spotlight', 'highlight', 'show_page', 'page_block'].includes(cueType) && !rawTarget) {
            issues.push({
                severity: 'flagged',
                code: 'EMPTY_CUE_TARGET',
                message: `Cue [[cue:${cueType}]] has an empty target.`
            });
        }

        if (cueType === 'card' || cueType === 'intro' || cueType === 'summary') {
            let jsonStr = rawTarget;
            const prefixMatch = rawTarget.match(/^(intro|summary):([\s\S]*)$/i);
            if (prefixMatch) jsonStr = prefixMatch[2].trim();
            try {
                const parsed = JSON.parse(jsonStr);
                if (!parsed || typeof parsed !== 'object') throw new Error('Not an object');
            } catch (e) {
                issues.push({
                    severity: 'flagged',
                    code: 'INVALID_CARD_JSON',
                    message: `Invalid JSON inside [[cue:${cueType}]] payload: ${e.message}`
                });
            }
        }

        if (cueType === 'quiz' || cueType === 'interactive_quiz') {
            let jsonStr = rawTarget;
            const prefixMatch = rawTarget.match(/^(mc|tf):([\s\S]*)$/i);
            if (prefixMatch) jsonStr = prefixMatch[2].trim();
            try {
                const parsed = JSON.parse(jsonStr);
                if (!parsed || typeof parsed !== 'object') throw new Error('Not an object');
            } catch (e) {
                issues.push({
                    severity: 'flagged',
                    code: 'INVALID_QUIZ_JSON',
                    message: `Invalid JSON inside [[cue:${cueType}]] payload: ${e.message}`
                });
            }
        }
    }

    return issues;
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
                        voiceName: "Aoede"
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
    const part = json.candidates?.[0]?.content?.parts?.[0];

    if (!part?.inlineData?.data) {
        throw new Error(`Gemini TTS returned no audio data: ${JSON.stringify(json)}`);
    }

    return {
        base64Audio: part.inlineData.data,
        mimeType: part.inlineData.mimeType || 'audio/pcm'
    };
}

function getAudioDurationSeconds(filePath) {
    try {
        const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, { encoding: 'utf-8' });
        const val = parseFloat(out.trim());
        if (!isNaN(val) && val > 0) return Number(val.toFixed(2));
    } catch (e) {}
    return 0;
}

async function processSynthesis(lesson) {
    console.log(`\n======================================================`);
    console.log(`🎙️ [TTS Synthesis] [${lesson.course_code}] ${lesson.chapter_title} -> ${lesson.section_title} (ID: ${lesson.id})`);
    console.log(`======================================================`);

    const tempDir = path.join(process.cwd(), 'temp_audio');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const rawAudioFile = path.join(tempDir, `${lesson.id}_raw.pcm`);
    const finalMp3File = path.join(tempDir, `${lesson.id}_final.mp3`);

    const sanitizedFolder = (lesson.course_code || 'misc')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_\-]/g, '');
    const storagePath = `${sanitizedFolder}/${lesson.id}.mp3`;

    try {
        const cleanText = cleanScriptForTTS(lesson.script_raw);
        console.log(`📝 Narration clean text: ${cleanText.length} characters`);

        await supabase
            .from('book_audio_lessons')
            .update({ status: 'processing', updated_at: new Date().toISOString() })
            .eq('id', lesson.id);

        const scriptIssues = auditRawScriptSyntax(lesson.script_raw);
        const synthesisNotes = [...scriptIssues];

        let ttsResult = null;
        let lastTtsErr = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            const keyObj = await getLeasedGeminiKey();
            console.log(`🔑 Leased API Key ID: #${keyObj.id} (Attempt ${attempt}/3)`);
            try {
                console.log(`🔊 Calling Gemini 3.8 Flash TTS ("Aoede")...`);
                ttsResult = await generateSpeechTTS(cleanText, keyObj);
                break;
            } catch (err) {
                lastTtsErr = err;
                const isRateLimit = err.message.includes('(429)');
                synthesisNotes.push({
                    severity: 'warning',
                    code: isRateLimit ? 'TTS_KEY_RATE_LIMITED' : 'TTS_ATTEMPT_RETRY',
                    message: `Attempt ${attempt} with Key #${keyObj.id} failed: ${err.message}`
                });
                if (attempt < 3) {
                    console.warn(`⚠️ TTS attempt ${attempt} failed (${err.message}). Rotating key...`);
                    await sleep(1000);
                }
            }
        }
        if (!ttsResult) throw lastTtsErr;

        const { base64Audio, mimeType } = ttsResult;
        fs.writeFileSync(rawAudioFile, Buffer.from(base64Audio, 'base64'));

        console.log(`🎛️ Transcoding via FFmpeg to 32kbps mono MP3...`);
        if (mimeType.includes('pcm')) {
            execSync(`ffmpeg -y -f s16le -ar 24000 -ac 1 -i "${rawAudioFile}" -c:a libmp3lame -b:a 32k -ar 24000 "${finalMp3File}"`, { stdio: 'pipe' });
        } else {
            execSync(`ffmpeg -y -i "${rawAudioFile}" -c:a libmp3lame -b:a 32k -ar 24000 "${finalMp3File}"`, { stdio: 'pipe' });
        }

        const mp3Buffer = fs.readFileSync(finalMp3File);
        const trueDuration = getAudioDurationSeconds(finalMp3File);
        const charsPerSec = trueDuration > 0 ? Number((cleanText.length / trueDuration).toFixed(2)) : 0;
        console.log(`✅ MP3 Created: ${(mp3Buffer.length / 1024).toFixed(1)} KB | Verified Duration: ${trueDuration}s | Rate: ${charsPerSec} chars/s`);

        if (trueDuration < 3 || mp3Buffer.length < 5000) {
            synthesisNotes.push({
                severity: 'flagged',
                code: 'EMPTY_OR_CORRUPT_AUDIO',
                message: `Audio unusually short/small: ${trueDuration}s, ${mp3Buffer.length} bytes.`
            });
        } else if (cleanText.length > 100 && (charsPerSec > 32 || charsPerSec < 4)) {
            synthesisNotes.push({
                severity: 'flagged',
                code: 'SPEECH_RATE_ANOMALY',
                message: `Unusual TTS speech rate (${charsPerSec} chars/s for ${cleanText.length} chars over ${trueDuration}s) — check for truncation or looping.`
            });
        }

        const hasFlagged = synthesisNotes.some(n => n.severity === 'flagged');
        const hasWarning = synthesisNotes.some(n => n.severity === 'warning');
        const synthesisSanity = {
            overall_status: hasFlagged ? 'flagged' : (hasWarning ? 'warning' : 'clean'),
            checked_at: new Date().toISOString(),
            synthesis: {
                char_count: cleanText.length,
                actual_duration_sec: trueDuration,
                chars_per_sec: charsPerSec,
                mp3_bytes: mp3Buffer.length,
                duration_anomaly: synthesisNotes.some(n => n.code === 'SPEECH_RATE_ANOMALY' || n.code === 'EMPTY_OR_CORRUPT_AUDIO'),
                notes: synthesisNotes
            }
        };

        console.log(`☁️ Uploading to storage bucket: book-audio-lectures/${storagePath}`);
        const { error: uploadError } = await supabase.storage
            .from('book-audio-lectures')
            .upload(storagePath, mp3Buffer, { contentType: 'audio/mpeg', upsert: true });

        if (uploadError) throw new Error(`Supabase storage upload failed: ${uploadError.message}`);

        const { data } = supabase.storage.from('book-audio-lectures').getPublicUrl(storagePath);
        const publicUrl = data?.publicUrl;
        const versionedUrl = publicUrl ? `${publicUrl}?v=${Date.now()}` : publicUrl;

        const updatePayload = {
            audio_url: versionedUrl,
            duration_seconds: trueDuration,
            status: 'audio_ready',
            error_message: null,
            sanity_check: synthesisSanity,
            updated_at: new Date().toISOString()
        };

        let { error: dbError } = await supabase
            .from('book_audio_lessons')
            .update(updatePayload)
            .eq('id', lesson.id);

        if (dbError && dbError.message && dbError.message.includes('sanity_check')) {
            console.warn('⚠️ Column "sanity_check" not found in DB yet; saving without sanity_check.');
            delete updatePayload.sanity_check;
            const retryRes = await supabase
                .from('book_audio_lessons')
                .update(updatePayload)
                .eq('id', lesson.id);
            dbError = retryRes.error;
        }

        if (dbError) throw new Error(`DB update failed: ${dbError.message}`);

        console.log(`🎉 Audio Synthesis complete for #${lesson.id}! Status is now AUDIO_READY.`);

        // 🔗 AUTO-CHAIN: Seamlessly trigger Acoustic Alignment in the same runner step
        console.log(`\n⚡ [Auto-Pipeline] Executing Acoustic Alignment for #${lesson.id}...`);
        try {
            execSync(`node scripts/align-audio.mjs`, {
                stdio: 'inherit',
                env: {
                    ...process.env,
                    TARGET_LESSON_ID: lesson.id
                }
            });
            console.log(`✅ [Auto-Pipeline] Acoustic Alignment completed successfully for #${lesson.id}!`);
        } catch (alignErr) {
            console.error(`⚠️ [Auto-Pipeline] Alignment failed for #${lesson.id}:`, alignErr.message);
            throw alignErr;
        }
    } catch (err) {
        console.error(`❌ Synthesis failed for #${lesson.id}:`, err.message);
        const failPayload = {
            status: 'failed',
            error_message: `[TTS Failure] ${err.message}`,
            sanity_check: {
                overall_status: 'flagged',
                checked_at: new Date().toISOString(),
                synthesis: {
                    error: err.message,
                    notes: [{ severity: 'flagged', code: 'TTS_FAILED', message: err.message }]
                }
            },
            updated_at: new Date().toISOString()
        };
        const { error: failErr } = await supabase
            .from('book_audio_lessons')
            .update(failPayload)
            .eq('id', lesson.id);
        if (failErr && failErr.message && failErr.message.includes('sanity_check')) {
            delete failPayload.sanity_check;
            await supabase.from('book_audio_lessons').update(failPayload).eq('id', lesson.id);
        }
        throw err;
    } finally {
        if (fs.existsSync(rawAudioFile)) fs.unlinkSync(rawAudioFile);
        if (fs.existsSync(finalMp3File)) fs.unlinkSync(finalMp3File);
    }
}

async function main() {
    console.log(`🚀 Starting Miron Speech Synthesis Engine`);
    if (TARGET_LESSON_ID) console.log(`🎯 Targeted Lesson ID: ${TARGET_LESSON_ID}`);
    console.log(`⚙️ Config: Batch Size: ${BATCH_SIZE} | Force Regenerate: ${FORCE_REGENERATE}`);

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
        const statusList = FORCE_REGENERATE
            ? ['pending', 'audio_ready', 'failed', 'ready']
            : ['pending', 'failed'];

        const { data, error } = await supabase
            .from('book_audio_lessons')
            .select('*')
            .in('status', statusList)
            .order('created_at', { ascending: true })
            .limit(BATCH_SIZE);

        if (error) {
            console.error('❌ Failed to fetch queue from database:', error.message);
            process.exit(1);
        }
        lessons = data || [];
    }

    if (lessons.length === 0) {
        console.log('✨ No lessons requiring audio synthesis found. Everything up to date.');
        return;
    }

    console.log(`📋 Found ${lessons.length} lesson(s) to synthesize.`);

    let hasErrors = false;
    for (const lesson of lessons) {
        try {
            await processSynthesis(lesson);
            await sleep(1500);
        } catch (e) {
            hasErrors = true;
        }
    }

    if (hasErrors) {
        console.error('\n💥 One or more lessons failed audio synthesis. Failing runner.');
        process.exit(1);
    }

    console.log(`\n🏁 Synthesis batch completed successfully.`);
}

main().catch(err => {
    console.error('Fatal runner crash:', err);
    process.exit(1);
});