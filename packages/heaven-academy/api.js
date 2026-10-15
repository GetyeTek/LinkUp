import { supabase } from '@linkup-platform/sdk-core';

// Dedicated endpoint for Education/RAG Services
const ACADEMY_GATEWAY = 'https://linkup-gateway.getyeteklu2.workers.dev';
const API_KEY = 'sb_publishable_B9mxFwLJl8WWw_Y9C28LtA_AfKYATEc';

export const invokeBookReader = async (payload, signal = null) => {
    const { data: { session } } = await supabase.auth.getSession();
    const options = {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'apikey': API_KEY,
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload),
        signal
    };
    const response = await fetch(`${ACADEMY_GATEWAY}/functions/v1/book-reader`, options);
    return response.json();
};

export const invokeMiron = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${ACADEMY_GATEWAY}/functions/v1/miron-athena`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'apikey': API_KEY,
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        throw new Error("Miron is currently operating at maximum capacity across campus networks. Please try again in a few moments.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
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
                if (event.type === 'chunk') fullText += event.delta;
                if (event.type === 'done') {
                    return {
                        response: fullText,
                        snapshots: event.snapshots,
                        quizzes: event.quizzes,
                        flashcards: event.flashcards
                    };
                }
                if (event.type === 'error') throw new Error(event.message);
            } catch (e) {}
        }
    }
    return { response: fullText };
};

export const invokePlanMyDay = async (payload = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${ACADEMY_GATEWAY}/functions/v1/plan-my-day`, {
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
        throw new Error(`Plan My Day Error: ${response.status} ${errText}`);
    }
    return response.json();
};