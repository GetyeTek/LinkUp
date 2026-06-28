import { supabase } from '@linkup/core-sdk';

// --- SECURE PROXY ROUTING ---
// Maintained strictly for Global Platform Services
const GATEWAY_BASE = 'https://linkup-gateway.getyeteklu2.workers.dev';

export const MIRON_ENDPOINT = `${GATEWAY_BASE}/functions/v1/miron-athena`;

// The fake key that tricks sniffers. The Worker replaces this securely.
const DUMMY_KEY = 'lk_live_9a38f2e7b1c4d9e0a2f8d73b';

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