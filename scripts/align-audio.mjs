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
        const wordIndexBefore = wordsBefore.length - 1;
        const wordIndexAfter = wordsBefore.length;
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
                wordIndexBefore,
                wordIndexAfter
            });
        } else {
            visualCues.push({
                orderIndex: visualCues.length,
                type: cueType,
                target: rawTarget,
                wordIndexBefore,
                wordIndexAfter
            });
        }

        lastIdx = match.index + match[0].length;
    }

    cleanText += rawScript.slice(lastIdx);
    cleanText = cleanText.replace(/\s+/g, ' ').trim();
    const scriptWords = cleanText.split(/\s+/).filter(Boolean);

    return { cleanText, scriptWords, visualCues, sectionCues };
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

const VISUAL_LEAD_OFFSET = 0.22; // 220ms anticipatory visual priming
const MAX_FEASIBLE_CHARS_PER_SEC = 30.0; // Speech rate ceiling above which gap insertion is rejected
const MIN_SEC_PER_WORD = 0.11;

const AMHARIC_HOMOPHONE_MAP = {
    'ሐ': 'ሀ', 'ሑ': 'ሁ', 'ሒ': 'ሂ', 'ሓ': 'ሀ', 'ሔ': 'ሄ', 'ሕ': 'ህ', 'ሖ': 'ሆ',
    'ኀ': 'ሀ', 'ኁ': 'ሁ', 'ኂ': 'ሂ', 'ኃ': 'ሀ', 'ኄ': 'ሄ', 'ኅ': 'ህ', 'ኆ': 'ሆ',
    'ሃ': 'ሀ', 'ኃ': 'ሀ',
    'ሠ': 'ሰ', 'ሡ': 'ሱ', 'ሢ': 'ሲ', 'ሣ': 'ሳ', 'ሤ': 'ሴ', 'ሥ': 'ስ', 'ሦ': 'ሶ',
    'ዐ': 'አ', 'ዑ': 'ኡ', 'ዒ': 'ኢ', 'ዓ': 'አ', 'ዔ': 'ኤ', 'ዕ': 'እ', 'ዖ': 'ኦ',
    'ኣ': 'አ',
    'ፀ': 'ጸ', 'ፁ': 'ጹ', 'ፂ': 'ጺ', 'ፃ': 'ጻ', 'ፄ': 'ጼ', 'ፅ': 'ጽ', 'ፆ': 'ጾ'
};

function cleanPunct(str) {
    if (!str) return '';
    return str.replace(/[\p{P}\p{S}\s]+/gu, '').trim();
}

function normalizeToken(str) {
    const cleaned = cleanPunct(str).toLowerCase();
    if (!cleaned) return '';
    let out = '';
    for (const ch of cleaned) {
        out += AMHARIC_HOMOPHONE_MAP[ch] || ch;
    }
    return out;
}

function levenshteinDistance(s1, s2) {
    const m = s1.length;
    const n = s2.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Uint16Array(n + 1);
    let curr = new Uint16Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

function computeWordSimilarity(norm1, norm2) {
    if (!norm1 && !norm2) return 1.0;
    if (!norm1 || !norm2) return 0.0;
    if (norm1 === norm2) return 1.0;
    const maxLen = Math.max(norm1.length, norm2.length);
    if (maxLen === 0) return 1.0;
    const dist = levenshteinDistance(norm1, norm2);
    return (maxLen - dist) / maxLen;
}

// Memory-efficient Needleman-Wunsch DP with explicit Uint8Array backpointers (0=diag, 1=up, 2=left)
function needlemanWunschAlign(seqA, seqB) {
    const M = seqA.length;
    const N = seqB.length;
    const GAP_PENALTY = -1.0;

    const normA = seqA.map(normalizeToken);
    const normB = seqB.map(normalizeToken);

    const stride = N + 1;
    const bp = new Uint8Array((M + 1) * stride);
    let prevRow = new Float64Array(stride);
    let currRow = new Float64Array(stride);

    for (let j = 0; j <= N; j++) {
        prevRow[j] = j * GAP_PENALTY;
        bp[j] = 2;
    }
    bp[0] = 0;

    for (let i = 1; i <= M; i++) {
        currRow[0] = i * GAP_PENALTY;
        const rowOffset = i * stride;
        bp[rowOffset] = 1;
        const aNorm = normA[i - 1];

        for (let j = 1; j <= N; j++) {
            const bNorm = normB[j - 1];
            const sim = computeWordSimilarity(aNorm, bNorm);
            let matchScore;
            if (sim >= 0.99) matchScore = 3.5;
            else if (sim >= 0.78) matchScore = 2.4;
            else if (sim >= 0.58) matchScore = 1.0;
            else matchScore = -2.0;

            const diag = prevRow[j - 1] + matchScore;
            const up = prevRow[j] + GAP_PENALTY;
            const left = currRow[j - 1] + GAP_PENALTY;

            if (diag >= up && diag >= left) {
                currRow[j] = diag;
                bp[rowOffset + j] = 0;
            } else if (up >= left) {
                currRow[j] = up;
                bp[rowOffset + j] = 1;
            } else {
                currRow[j] = left;
                bp[rowOffset + j] = 2;
            }
        }
        [prevRow, currRow] = [currRow, prevRow];
    }

    const pairs = [];
    let i = M;
    let j = N;
    while (i > 0 || j > 0) {
        const dir = bp[i * stride + j];
        if (i > 0 && j > 0 && dir === 0) {
            const sim = computeWordSimilarity(normA[i - 1], normB[j - 1]);
            pairs.push({ aIdx: i - 1, bIdx: j - 1, type: sim >= 0.58 ? 'match' : 'mismatch' });
            i--;
            j--;
        } else if (i > 0 && (j === 0 || dir === 1)) {
            pairs.push({ aIdx: i - 1, bIdx: null, type: 'a_only' });
            i--;
        } else {
            pairs.push({ aIdx: null, bIdx: j - 1, type: 'b_only' });
            j--;
        }
    }
    pairs.reverse();
    return pairs;
}

function containsNormalizedPhrase(normalizedScriptWords, chunkWords) {
    const chunkNorm = chunkWords.map(normalizeToken).filter(Boolean);
    if (chunkNorm.length === 0) return false;
    const probe = chunkNorm.slice(0, Math.min(3, chunkNorm.length));
    for (let i = 0; i <= normalizedScriptWords.length - probe.length; i++) {
        let ok = true;
        for (let k = 0; k < probe.length; k++) {
            if (computeWordSimilarity(normalizedScriptWords[i + k], probe[k]) < 0.78) {
                ok = false;
                break;
            }
        }
        if (ok) return true;
    }
    return false;
}

function reconcileDualPassTranscripts(pass1Words, pass2Tokens, scriptWords, hardwareDuration) {
    const pass2WordStrings = pass2Tokens.map(t => t.word || '');
    const alignedPairs = needlemanWunschAlign(pass1Words, pass2WordStrings);
    const normalizedScriptWords = scriptWords.map(normalizeToken);

    const finalWords = [];
    const blockedChunks = [];
    const issues = [];
    let restoredCount = 0;

    let k = 0;
    while (k < alignedPairs.length) {
        const item = alignedPairs[k];

        if (item.type === 'match' || item.type === 'mismatch') {
            const tok = pass2Tokens[item.bIdx];
            finalWords.push({
                word: pass1Words[item.aIdx] || tok.word,
                start: Number(tok.start.toFixed(2)),
                end: Number(tok.end.toFixed(2))
            });
            k++;
        } else if (item.type === 'b_only') {
            const tok = pass2Tokens[item.bIdx];
            finalWords.push({
                word: tok.word,
                start: Number(tok.start.toFixed(2)),
                end: Number(tok.end.toFixed(2))
            });
            k++;
        } else if (item.type === 'a_only') {
            const missingChunk = [];
            while (k < alignedPairs.length && alignedPairs[k].type === 'a_only') {
                missingChunk.push(pass1Words[alignedPairs[k].aIdx]);
                k++;
            }

            const lastGood = finalWords.length > 0 ? finalWords[finalWords.length - 1] : null;
            const prevEnd = lastGood ? lastGood.end : 0.0;
            const prevAnchorLabel = lastGood ? `${lastGood.word} (${prevEnd.toFixed(2)}s)` : '[Audio Start] (0.00s)';

            let nextToken = null;
            for (let f = k; f < alignedPairs.length; f++) {
                if (alignedPairs[f].bIdx !== null) {
                    nextToken = pass2Tokens[alignedPairs[f].bIdx];
                    break;
                }
            }

            const totalChars = missingChunk.reduce((acc, w) => acc + Math.max(2, cleanPunct(w).length), 0);
            const minFeasibleSec = Math.max(missingChunk.length * MIN_SEC_PER_WORD, totalChars / MAX_FEASIBLE_CHARS_PER_SEC);
            const inScript = containsNormalizedPhrase(normalizedScriptWords, missingChunk);

            if (!nextToken) {
                // Trailing end of track (after last Pass 2 timestamp)
                const tailEnd = hardwareDuration > prevEnd ? hardwareDuration : prevEnd;
                const availTail = Math.max(0, tailEnd - prevEnd);
                if (availTail < minFeasibleSec && (missingChunk.length >= 3 || totalChars > 15)) {
                    const reason = inScript ? 'INFEASIBLE_TAIL_GAP_BLOCKED' : 'PASS1_TAIL_HALLUCINATION_BLOCKED';
                    blockedChunks.push({
                        reason,
                        words: missingChunk.join(' '),
                        word_count: missingChunk.length,
                        char_count: totalChars,
                        gap_sec: Number(availTail.toFixed(3)),
                        min_feasible_sec: Number(minFeasibleSec.toFixed(3)),
                        prev_anchor: prevAnchorLabel,
                        next_anchor: `[Audio End] (${tailEnd.toFixed(2)}s)`,
                        in_script_raw: inScript
                    });
                    issues.push({
                        severity: 'flagged',
                        code: reason,
                        message: `Blocked tail insertion of ${missingChunk.length} words (${totalChars} chars) into ${availTail.toFixed(2)}s tail gap.`
                    });
                    continue;
                }

                const span = Math.min(availTail, Math.max(missingChunk.length * 0.45, totalChars / 12.0));
                if (span <= 0.02) continue;

                let cursor = prevEnd;
                for (const w of missingChunk) {
                    const weight = Math.max(2, cleanPunct(w).length) / totalChars;
                    const dur = span * weight;
                    const wStart = Number(cursor.toFixed(2));
                    const wEnd = Number(Math.min(tailEnd, cursor + dur).toFixed(2));
                    finalWords.push({ word: w, start: wStart, end: Math.max(wStart, wEnd) });
                    cursor += dur;
                    restoredCount++;
                }
                continue;
            }

            const nextStart = nextToken.start;
            const nextAnchorLabel = `${nextToken.word} (${nextStart.toFixed(2)}s)`;
            const realGap = nextStart - prevEnd;

            if (realGap < minFeasibleSec) {
                // Tiny 1-2 word Pass 2 boundary bleed can be clamped inside realGap if >= 0.02s
                if (missingChunk.length <= 2 && totalChars <= 15 && realGap >= 0.02) {
                    issues.push({
                        severity: 'warning',
                        code: 'TIGHT_GAP_CLAMPED',
                        message: `Clamped ${missingChunk.length} word(s) ("${missingChunk.join(' ')}") into tight ${realGap.toFixed(2)}s gap between ${prevAnchorLabel} and ${nextAnchorLabel}.`
                    });
                } else {
                    const reason = inScript ? 'INFEASIBLE_GAP_BLOCKED' : 'PASS1_HALLUCINATION_BLOCKED';
                    blockedChunks.push({
                        reason,
                        words: missingChunk.join(' '),
                        word_count: missingChunk.length,
                        char_count: totalChars,
                        gap_sec: Number(realGap.toFixed(3)),
                        min_feasible_sec: Number(minFeasibleSec.toFixed(3)),
                        prev_anchor: prevAnchorLabel,
                        next_anchor: nextAnchorLabel,
                        in_script_raw: inScript
                    });
                    issues.push({
                        severity: 'flagged',
                        code: reason,
                        message: `Refused to force-insert ${missingChunk.length} words (${totalChars} chars, needs >=${minFeasibleSec.toFixed(2)}s) into ${realGap.toFixed(2)}s gap between ${prevAnchorLabel} and ${nextAnchorLabel}.`
                    });
                    continue;
                }
            } else if (realGap > Math.max(4.0, totalChars * 0.45)) {
                issues.push({
                    severity: 'warning',
                    code: 'SPARSE_GAP_WARNING',
                    message: `Long ${realGap.toFixed(2)}s gap for only ${missingChunk.length} words ("${missingChunk.join(' ')}") between ${prevAnchorLabel} and ${nextAnchorLabel}.`
                });
            }

            // Character-length weighted interpolation strictly clamped inside [prevEnd, nextStart]
            let cursor = prevEnd;
            for (const w of missingChunk) {
                const weight = Math.max(2, cleanPunct(w).length) / totalChars;
                const dur = realGap * weight;
                const wStart = Number(Math.min(nextStart, cursor).toFixed(2));
                const wEnd = Number(Math.min(nextStart, cursor + dur).toFixed(2));
                finalWords.push({
                    word: w,
                    start: wStart,
                    end: Math.max(wStart, wEnd)
                });
                cursor += dur;
                restoredCount++;
            }
        }
    }

    return { finalWords, restoredCount, blockedChunks, issues };
}

async function callGeminiTranscribe(mp3Base64, apiKeyObj, withTimestamps) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent?key=${apiKeyObj.api_key}`;
    const audioTranscriptionConfig = withTimestamps
        ? { mode: "VERBATIM", wordTimestamp: true }
        : { mode: "VERBATIM" };

    const payload = {
        contents: [{
            parts: [{
                inlineData: {
                    mimeType: "audio/mp3",
                    data: mp3Base64
                }
            }]
        }],
        generationConfig: { audioTranscriptionConfig }
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
        const httpErr = new Error(`Gemini Transcribe (${withTimestamps ? 'Pass2-TS' : 'Pass1-Text'}) HTTP ${res.status}: ${errText}`);
        httpErr.rawOutput = errText;
        httpErr.status = res.status;
        throw httpErr;
    }

    const json = await res.json();
    const parts = json.candidates?.[0]?.content?.parts || [];

    if (!withTimestamps) {
        let fullText = '';
        for (const p of parts) {
            if (p.text) fullText += p.text + ' ';
            if (p.audioTranscription?.text) fullText += p.audioTranscription.text + ' ';
        }
        fullText = fullText.trim();
        if (!fullText) {
            const emptyErr = new Error(`Gemini Transcribe Pass 1 returned empty text.`);
            emptyErr.rawOutput = JSON.stringify(json);
            throw emptyErr;
        }
        return { fullText, rawJson: json };
    }

    const rawWords = [];
    for (const p of parts) {
        if (Array.isArray(p.audioTranscription?.words)) {
            rawWords.push(...p.audioTranscription.words);
        }
    }

    const words = rawWords.map(w => ({
        word: w.word || '',
        start: Number(parseFloat(w.startOffset || '0').toFixed(2)),
        end: Number(parseFloat(w.endOffset || '0').toFixed(2))
    }));

    if (words.length === 0) {
        const noWordsErr = new Error(`Gemini Transcribe Pass 2 returned empty words array.`);
        noWordsErr.rawOutput = JSON.stringify(json);
        throw noWordsErr;
    }

    return { words, rawJson: json };
}

async function runWithKeyRetry(label, taskFn, issuesLog, maxAttempts = 3) {
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const keyObj = await getLeasedGeminiKey();
        console.log(`🔑 [${label}] Leased API Key ID: #${keyObj.id} (Attempt ${attempt}/${maxAttempts})`);
        try {
            return await taskFn(keyObj);
        } catch (err) {
            lastErr = err;
            issuesLog.push({
                severity: 'warning',
                code: err.status === 429 ? 'TRANSCRIBE_KEY_RATE_LIMITED' : 'TRANSCRIBE_RETRY',
                message: `[${label}] Attempt ${attempt} with Key #${keyObj.id} failed: ${err.message}`
            });
            if (attempt < maxAttempts) {
                console.warn(`⚠️ [${label}] Attempt ${attempt} failed, rotating key...`);
                await sleep(1000);
            }
        }
    }
    throw lastErr;
}

async function transcribeDualPassSurgical(mp3Base64, scriptWords, hardwareDuration) {
    const issues = [];

    // Pass 1: Full Verbatim Text (captures English & loanwords pruned by timestamp decoder)
    let pass1Words = [];
    let pass1FallbackUsed = false;
    try {
        console.log(`🔍 [Pass 1/3] Calling Gemini 3.5 Transcribe (Full Text Verbatim)...`);
        const pass1Res = await runWithKeyRetry('Pass1-FullText', (k) => callGeminiTranscribe(mp3Base64, k, false), issues);
        pass1Words = pass1Res.fullText.split(/\s+/).filter(Boolean);
        console.log(`📝 [Pass 1/3] Extracted ${pass1Words.length} full-text tokens.`);
    } catch (p1Err) {
        pass1FallbackUsed = true;
        pass1Words = [...scriptWords];
        issues.push({
            severity: 'warning',
            code: 'PASS1_FALLBACK_TO_SCRIPT',
            message: `Pass 1 transcription failed (${p1Err.message}); fell back to script_raw tokens for surgical stitching.`
        });
        console.warn(`⚠️ [Pass 1/3] Failed; falling back to script_raw (${pass1Words.length} words).`);
    }

    // Pass 2: Millisecond Word Timestamps
    console.log(`⏱️ [Pass 2/3] Calling Gemini 3.5 Transcribe (Word Timestamps)...`);
    const pass2Res = await runWithKeyRetry('Pass2-Timestamps', (k) => callGeminiTranscribe(mp3Base64, k, true), issues);
    const pass2Tokens = pass2Res.words;
    console.log(`⏱️ [Pass 2/3] Extracted ${pass2Tokens.length} timestamped anchor tokens.`);

    // Pass 3: Surgical Stitching with Speech-Rate Feasibility Gate
    console.log(`🩺 [Pass 3/3] Reconciling Pass 1 & Pass 2 with feasibility gate...`);
    const reconciled = reconcileDualPassTranscripts(pass1Words, pass2Tokens, scriptWords, hardwareDuration);
    const combinedIssues = [...issues, ...reconciled.issues];

    const lastWord = reconciled.finalWords[reconciled.finalWords.length - 1];
    const lastWordEnd = lastWord ? lastWord.end : 0;
    const finalDuration = Number((hardwareDuration > 0 ? Math.max(hardwareDuration, lastWordEnd) : lastWordEnd).toFixed(2));

    if (hardwareDuration > 0 && (hardwareDuration - lastWordEnd) > 5.0) {
        combinedIssues.push({
            severity: 'flagged',
            code: 'TRAILING_UNTRANSCRIBED_AUDIO',
            message: `Last transcribed word ends at ${lastWordEnd.toFixed(2)}s, leaving ${(hardwareDuration - lastWordEnd).toFixed(2)}s untranscribed before track end (${hardwareDuration}s).`
        });
    }

    return {
        duration: finalDuration,
        words: reconciled.finalWords,
        stats: {
            pass1_word_count: pass1Words.length,
            pass2_word_count: pass2Tokens.length,
            reconciled_word_count: reconciled.finalWords.length,
            restored_count: reconciled.restoredCount,
            pass1_fallback_used: pass1FallbackUsed,
            blocked_infeasible_chunks: reconciled.blockedChunks,
            issues: combinedIssues
        }
    };
}

function buildScriptAlignmentMap(scriptWords, reconciledWords) {
    const wordStrings = reconciledWords.map(w => w.word || '');
    const pairs = needlemanWunschAlign(scriptWords, wordStrings);
    const scriptToReconciled = new Array(scriptWords.length).fill(null);
    let matchedCount = 0;

    for (const p of pairs) {
        if (p.aIdx !== null && p.bIdx !== null && p.type === 'match') {
            scriptToReconciled[p.aIdx] = p.bIdx;
            matchedCount++;
        }
    }

    const matchRate = scriptWords.length > 0 ? Number((matchedCount / scriptWords.length).toFixed(3)) : 1.0;
    return { scriptToReconciled, matchRate };
}

function resolveScriptPositionTime(wordIndexBefore, wordIndexAfter, scriptWords, reconciledWords, scriptToReconciled, fallbackDuration, leadOffset) {
    if (!Array.isArray(reconciledWords) || reconciledWords.length === 0) {
        return { time: 0, distance: 0, ambiguous: true };
    }

    // Cue before any spoken word
    if (wordIndexBefore < 0 && wordIndexAfter <= 0) {
        return { time: 0, distance: 0, ambiguous: false };
    }

    // Cue at the very end of the script
    if (wordIndexAfter >= scriptWords.length) {
        for (let s = Math.min(wordIndexBefore, scriptWords.length - 1); s >= 0; s--) {
            if (scriptToReconciled[s] !== null) {
                const base = reconciledWords[scriptToReconciled[s]].end;
                return { time: Math.min(fallbackDuration, base), distance: wordIndexBefore - s, ambiguous: (wordIndexBefore - s) > 8 };
            }
        }
        return { time: fallbackDuration, distance: scriptWords.length, ambiguous: true };
    }

    // Prefer the acoustic onset of the next spoken word (wordIndexAfter)
    const targetIdx = Math.max(0, Math.min(scriptWords.length - 1, wordIndexAfter));
    if (scriptToReconciled[targetIdx] !== null) {
        const base = reconciledWords[scriptToReconciled[targetIdx]].start;
        return { time: Math.max(0, base - leadOffset), distance: 0, ambiguous: false };
    }

    // Interpolate proportionally between nearest matched left and right script words
    let leftS = -1;
    for (let s = targetIdx - 1; s >= 0; s--) {
        if (scriptToReconciled[s] !== null) {
            leftS = s;
            break;
        }
    }
    let rightS = -1;
    for (let s = targetIdx + 1; s < scriptWords.length; s++) {
        if (scriptToReconciled[s] !== null) {
            rightS = s;
            break;
        }
    }

    if (leftS !== -1 && rightS !== -1) {
        const leftTime = reconciledWords[scriptToReconciled[leftS]].end;
        const rightTime = reconciledWords[scriptToReconciled[rightS]].start;
        const gap = Math.max(0, rightTime - leftTime);

        let charsBefore = 0;
        let totalSpanChars = 0;
        for (let s = leftS + 1; s < rightS; s++) {
            const wLen = Math.max(2, cleanPunct(scriptWords[s]).length);
            if (s < targetIdx) charsBefore += wLen;
            totalSpanChars += wLen;
        }
        const ratio = totalSpanChars > 0 ? (charsBefore / totalSpanChars) : 0.5;
        const interp = leftTime + (gap * ratio);
        const minDist = Math.min(targetIdx - leftS, rightS - targetIdx);
        return { time: Math.max(0, interp - leadOffset), distance: minDist, ambiguous: minDist > 8 };
    }

    if (leftS !== -1) {
        const base = reconciledWords[scriptToReconciled[leftS]].end;
        return { time: Math.min(fallbackDuration, Math.max(0, base - leadOffset)), distance: targetIdx - leftS, ambiguous: (targetIdx - leftS) > 8 };
    }

    if (rightS !== -1) {
        const base = reconciledWords[scriptToReconciled[rightS]].start;
        return { time: Math.max(0, base - leadOffset), distance: rightS - targetIdx, ambiguous: (rightS - targetIdx) > 8 };
    }

    return { time: fallbackDuration, distance: scriptWords.length, ambiguous: true };
}

function alignVisualCuesWithDP(visualCues, scriptWords, reconciledWords, scriptToReconciled, fallbackDuration) {
    const monotonicClamps = [];
    const lowConfidenceCues = [];
    const timeline = [];

    for (let i = 0; i < visualCues.length; i++) {
        const cue = visualCues[i];
        const resolved = resolveScriptPositionTime(
            cue.wordIndexBefore,
            cue.wordIndexAfter,
            scriptWords,
            reconciledWords,
            scriptToReconciled,
            fallbackDuration,
            VISUAL_LEAD_OFFSET
        );

        let cueTime = Number(Math.min(fallbackDuration, Math.max(0, resolved.time)).toFixed(2));

        if (resolved.ambiguous) {
            lowConfidenceCues.push({
                cue_index: i,
                type: cue.type,
                target: cue.target.slice(0, 60),
                nearest_anchor_word_distance: resolved.distance,
                resolved_time: cueTime
            });
        }

        // Strict monotonic order preservation — never allow cues to leapfrog out of script order
        if (timeline.length > 0 && cueTime < timeline[timeline.length - 1].time) {
            const prevTime = timeline[timeline.length - 1].time;
            monotonicClamps.push({
                cue_index: i,
                type: cue.type,
                target: cue.target.slice(0, 60),
                raw_time: cueTime,
                clamped_to: prevTime
            });
            cueTime = prevTime;
        }

        timeline.push({
            time: cueTime,
            type: cue.type,
            target: cue.target
        });
    }

    return { timeline, monotonicClamps, lowConfidenceCues };
}

function auditCueOrchestration(timeline) {
    const issues = [];
    let hasDiagram = false;
    let lastQuizTime = null;

    for (let i = 0; i < timeline.length; i++) {
        const c = timeline[i];

        if (c.type === 'show_diagram') hasDiagram = true;
        if ((c.type === 'zoom' || c.type === 'focus' || c.type === 'spotlight') && !hasDiagram) {
            issues.push({
                severity: 'flagged',
                code: 'ORPHAN_ZOOM_BEFORE_DIAGRAM',
                message: `Camera cue ${c.type}:${c.target} at ${c.time}s fired before any show_diagram cue.`
            });
        }

        if (c.type === 'quiz' || c.type === 'interactive_quiz') {
            lastQuizTime = c.time;
            let jsonStr = c.target;
            const m = c.target.match(/^(mc|tf):([\s\S]*)$/i);
            if (m) jsonStr = m[2].trim();
            try {
                JSON.parse(jsonStr);
            } catch (e) {
                issues.push({
                    severity: 'flagged',
                    code: 'INVALID_QUIZ_JSON',
                    message: `Quiz cue at ${c.time}s contains invalid JSON: ${e.message}`
                });
            }
        }

        if (c.type === 'card' || c.type === 'summary' || c.type === 'intro') {
            const isSummary = c.type === 'summary' || /^summary:/i.test(c.target);
            if (isSummary && lastQuizTime !== null && c.time >= lastQuizTime) {
                issues.push({
                    severity: 'flagged',
                    code: 'SUMMARY_AFTER_OR_AT_QUIZ',
                    message: `Summary card at ${c.time}s landed at/after quiz at ${lastQuizTime}s.`
                });
            }
        }

        if (i > 0) {
            const prev = timeline[i - 1];
            if (prev.type === 'show_image' && c.type === 'clear_image' && Math.abs(c.time - prev.time) < 0.05) {
                issues.push({
                    severity: 'warning',
                    code: 'IMAGE_CLEAR_COLLISION',
                    message: `show_image and clear_image collided at ${c.time}s.`
                });
            }
        }
    }

    return issues;
}

function buildSectionsManifestWithDP(sectionCues, scriptWords, reconciledWords, scriptToReconciled, totalDuration, defaultLesson) {
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

    const timedSections = [];
    for (const c of sectionCues) {
        const res = resolveScriptPositionTime(
            c.wordIndexBefore,
            c.wordIndexAfter,
            scriptWords,
            reconciledWords,
            scriptToReconciled,
            totalDuration,
            0
        );
        let startTime = Number(Math.min(totalDuration, Math.max(0, res.time)).toFixed(2));
        if (timedSections.length > 0 && startTime < timedSections[timedSections.length - 1].startTime) {
            startTime = timedSections[timedSections.length - 1].startTime;
        }
        timedSections.push({
            tag: c.tag,
            title: c.title,
            startTime
        });
    }

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
        const { scriptWords, visualCues, sectionCues } = parseScriptCues(lesson.script_raw);
        console.log(`🎯 Cues detected: ${visualCues.length} visual/camera/bullet events | ${sectionCues.length} section markers | Script words: ${scriptWords.length}`);

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

        const result = await transcribeDualPassSurgical(mp3Base64, scriptWords, trueDuration);
        const words = result.words;
        const finalDuration = result.duration;
        console.log(`⏱️ Final Acoustic Duration: ${finalDuration}s | Reconciled Words: ${words.length} (Restored: ${result.stats.restored_count}, Blocked Gaps: ${result.stats.blocked_infeasible_chunks.length})`);

        const { scriptToReconciled, matchRate } = buildScriptAlignmentMap(scriptWords, words);
        console.log(`🧬 Script ↔ Reconciled Transcript DP Match Rate: ${(matchRate * 100).toFixed(1)}%`);

        const { timeline: visualTimeline, monotonicClamps, lowConfidenceCues } = alignVisualCuesWithDP(
            visualCues,
            scriptWords,
            words,
            scriptToReconciled,
            finalDuration
        );
        const sectionsManifest = buildSectionsManifestWithDP(
            sectionCues,
            scriptWords,
            words,
            scriptToReconciled,
            finalDuration,
            lesson
        );
        console.log(`🎯 Aligned Events: ${visualTimeline.length} | Sections in Manifest: ${sectionsManifest.length}`);

        const orchestrationIssues = auditCueOrchestration(visualTimeline);
        const allAlignmentIssues = [...result.stats.issues, ...orchestrationIssues];

        if (matchRate < 0.65) {
            allAlignmentIssues.push({
                severity: 'flagged',
                code: 'LOW_SCRIPT_ALIGNMENT_CONFIDENCE',
                message: `Script-to-transcript DP match rate is only ${(matchRate * 100).toFixed(1)}% (< 65%).`
            });
        }
        if (lowConfidenceCues.length > 0) {
            allAlignmentIssues.push({
                severity: 'warning',
                code: 'AMBIGUOUS_CUE_ANCHORS',
                message: `${lowConfidenceCues.length} cue(s) fell back to distant interpolated anchors (> 8 words away).`
            });
        }
        if (monotonicClamps.length > 0) {
            allAlignmentIssues.push({
                severity: 'warning',
                code: 'MONOTONIC_CLAMPS_APPLIED',
                message: `${monotonicClamps.length} cue(s) were clamped forward to preserve script sequence.`
            });
        }

        const existingSanity = (lesson.sanity_check && typeof lesson.sanity_check === 'object') ? lesson.sanity_check : {};
        const synthNotes = Array.isArray(existingSanity.synthesis?.notes) ? existingSanity.synthesis.notes : [];
        const combinedNotes = [...synthNotes, ...allAlignmentIssues];
        const overallStatus = combinedNotes.some(n => n.severity === 'flagged')
            ? 'flagged'
            : (combinedNotes.some(n => n.severity === 'warning') ? 'warning' : 'clean');

        const mergedSanity = {
            ...existingSanity,
            overall_status: overallStatus,
            checked_at: new Date().toISOString(),
            alignment: {
                pass1_word_count: result.stats.pass1_word_count,
                pass2_word_count: result.stats.pass2_word_count,
                reconciled_word_count: result.stats.reconciled_word_count,
                restored_count: result.stats.restored_count,
                pass1_fallback_used: result.stats.pass1_fallback_used,
                script_dp_match_rate: matchRate,
                blocked_infeasible_chunks: result.stats.blocked_infeasible_chunks,
                monotonic_clamps: monotonicClamps,
                low_confidence_cues: lowConfidenceCues,
                issues: allAlignmentIssues
            }
        };

        console.log(`🛡️ Sanity Audit Status: ${overallStatus.toUpperCase()} (${allAlignmentIssues.length} alignment issue(s))`);

        const commitPayload = {
            duration_seconds: finalDuration,
            cue_timeline: visualTimeline,
            sections_manifest: sectionsManifest,
            word_timestamps: words,
            sanity_check: mergedSanity,
            status: 'ready',
            error_message: null,
            updated_at: new Date().toISOString()
        };

        let { error: dbError } = await supabase
            .from('book_audio_lessons')
            .update(commitPayload)
            .eq('id', lesson.id);

        if (dbError && dbError.message && dbError.message.includes('sanity_check')) {
            console.warn('⚠️ Column "sanity_check" not found in DB yet; committing alignment without sanity_check.');
            delete commitPayload.sanity_check;
            const retryRes = await supabase
                .from('book_audio_lessons')
                .update(commitPayload)
                .eq('id', lesson.id);
            dbError = retryRes.error;
        }

        if (dbError) throw new Error(`DB commit failed: ${dbError.message}`);

        console.log(`🎉 Lesson #${lesson.id} successfully aligned and marked READY!`);
    } catch (err) {
        console.error(`❌ Alignment failed for #${lesson.id}:`, err.message);
        const existingSanity = (lesson.sanity_check && typeof lesson.sanity_check === 'object') ? lesson.sanity_check : {};
        const updatePayload = {
            status: 'failed',
            error_message: `[Alignment Failure] ${err.message}`,
            sanity_check: {
                ...existingSanity,
                overall_status: 'flagged',
                checked_at: new Date().toISOString(),
                alignment: {
                    error: err.message,
                    issues: [{ severity: 'flagged', code: 'ALIGNMENT_FAILED', message: err.message }]
                }
            },
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
            delete updatePayload.sanity_check;
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