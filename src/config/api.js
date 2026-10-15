import { supabase } from '@linkup-platform/sdk-core';

// --- SECURE PROXY ROUTING ---
// Maintained strictly for Global Platform Services
const GATEWAY_BASE = 'https://linkup-gateway.getyeteklu2.workers.dev';

export const MIRON_ENDPOINT = `${GATEWAY_BASE}/functions/v1/miron-athena`;

const API_KEY = 'sb_publishable_B9mxFwLJl8WWw_Y9C28LtA_AfKYATEc';

export const invokeMironStream = async (payload, { onStatus, onChunk, onDone, onError } = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    
    const response = await fetch(MIRON_ENDPOINT, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'apikey': API_KEY,
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        const errText = await response.text();
        const lower = (errText || '').toLowerCase();
        if (lower.includes('api_key') || lower.includes('gemini') || lower.includes('quota') || lower.includes('capacity') || response.status === 429) {
            throw new Error("Miron is currently operating at maximum capacity across campus networks. Please try again in a few moments.");
        }
        if (response.status === 402 || lower.includes('insufficient_credits')) {
            throw new Error("Insufficient LinkUp Credits. Please complete missions or upgrade to LinkUp Gold.");
        }
        throw new Error("Miron is momentarily busy. Please try asking again in a few moments.");
    }

    if (!response.body) {
        throw new Error("Response body is not readable for streaming.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr) continue;
            try {
                const event = JSON.parse(jsonStr);
                if (event.type === 'status' && onStatus) {
                    onStatus(event.message);
                } else if (event.type === 'chunk' && onChunk) {
                    onChunk(event.delta);
                } else if (event.type === 'done' && onDone) {
                    onDone(event);
                } else if (event.type === 'error' && onError) {
                    onError(event.message);
                }
            } catch (e) {
                console.warn('Failed to parse SSE line:', jsonStr, e);
            }
        }
    }
};

export const invokeMiron = async (payload) => {
    let fullText = '';
    let finalPayload = {};
    return new Promise((resolve, reject) => {
        invokeMironStream(payload, {
            onChunk: (delta) => { fullText += delta; },
            onDone: (data) => {
                finalPayload = data;
                resolve({
                    response: fullText,
                    snapshots: finalPayload.snapshots,
                    quizzes: finalPayload.quizzes,
                    flashcards: finalPayload.flashcards,
                    ui_command: finalPayload.ui_command,
                    thoughts: finalPayload.thoughts || []
                });
            },
            onError: reject
        }).catch(reject);
    });
};