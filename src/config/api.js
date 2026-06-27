import { supabase } from './supabaseClient.js';

// --- SECURE PROXY ROUTING ---
// NOTE: Replace this placeholder with the actual URL Cloudflare gives you after deployment
const GATEWAY_BASE = 'https://[YOUR_CLOUDFLARE_URL_HERE]';

export const API_ENDPOINT = `${GATEWAY_BASE}/functions/v1/book-reader`;
export const MIRON_ENDPOINT = `${GATEWAY_BASE}/functions/v1/miron-athena`;

// The fake key that tricks sniffers. The Worker replaces this securely.
const DUMMY_KEY = 'lk_live_9a38f2e7b1c4d9e0a2f8d73b';

/**
 * Standardized fetch wrapper for the Supabase Edge Function
 * @param {Object} payload - The JSON payload containing the action and parameters.
 * @param {AbortSignal} [signal] - Optional abort signal for canceling requests.
 * @returns {Promise<any>} - The parsed JSON response.
 */
export const invokeBookReader = async (payload, signal = null) => {
    const { data: { session } } = await supabase.auth.getSession();
    
    const options = {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'apikey': DUMMY_KEY, // Pass dummy key to satisfy Edge Function routing
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload)
    };
    
    if (signal) {
        options.signal = signal;
    }

    const response = await fetch(API_ENDPOINT, options);
    
    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
};

export const invokeMiron = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    
    const response = await fetch(MIRON_ENDPOINT, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'apikey': DUMMY_KEY, // Pass dummy key
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        throw new Error(`Miron Error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
};