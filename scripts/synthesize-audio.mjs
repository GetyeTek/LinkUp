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

        const keyObj = await getLeasedGeminiKey();
        console.log(`🔑 Leased API Key ID: #${keyObj.id}`);

        console.log(`🔊 Calling Gemini 3.8 Flash TTS ("Puck")...`);
        const { base64Audio, mimeType } = await generateSpeechTTS(cleanText, keyObj);

        fs.writeFileSync(rawAudioFile, Buffer.from(base64Audio, 'base64'));

        console.log(`🎛️ Transcoding via FFmpeg to 32kbps mono MP3...`);
        if (mimeType.includes('pcm')) {
            execSync(`ffmpeg -y -f s16le -ar 24000 -ac 1 -i "${rawAudioFile}" -c:a libmp3lame -b:a 32k -ar 24000 "${finalMp3File}"`, { stdio: 'pipe' });
        } else {
            execSync(`ffmpeg -y -i "${rawAudioFile}" -c:a libmp3lame -b:a 32k -ar 24000 "${finalMp3File}"`, { stdio: 'pipe' });
        }

        const mp3Buffer = fs.readFileSync(finalMp3File);
        const trueDuration = getAudioDurationSeconds(finalMp3File);
        console.log(`✅ MP3 Created: ${(mp3Buffer.length / 1024).toFixed(1)} KB | Verified Duration: ${trueDuration}s`);

        console.log(`☁️ Uploading to storage bucket: book-audio-lectures/${storagePath}`);
        const { error: uploadError } = await supabase.storage
            .from('book-audio-lectures')
            .upload(storagePath, mp3Buffer, { contentType: 'audio/mpeg', upsert: true });

        if (uploadError) throw new Error(`Supabase storage upload failed: ${uploadError.message}`);

        const { data } = supabase.storage.from('book-audio-lectures').getPublicUrl(storagePath);
        const publicUrl = data?.publicUrl;

        const { error: dbError } = await supabase
            .from('book_audio_lessons')
            .update({
                audio_url: publicUrl,
                duration_seconds: trueDuration,
                status: 'audio_ready',
                error_message: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', lesson.id);

        if (dbError) throw new Error(`DB update failed: ${dbError.message}`);

        console.log(`🎉 Audio Synthesis complete for #${lesson.id}! Status is now AUDIO_READY.`);
    } catch (err) {
        console.error(`❌ Synthesis failed for #${lesson.id}:`, err.message);
        await supabase
            .from('book_audio_lessons')
            .update({
                status: 'failed',
                error_message: `[TTS Failure] ${err.message}`,
                updated_at: new Date().toISOString()
            })
            .eq('id', lesson.id);
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