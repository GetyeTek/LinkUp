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
    return response.json();
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