import { supabase } from '@linkup-platform/sdk-core';

// --- SECURE PROXY ROUTING ---
// Maintained strictly for Global Platform Services
const GATEWAY_BASE = 'https://linkup-gateway.getyeteklu2.workers.dev';

export const MIRON_ENDPOINT = `${GATEWAY_BASE}/functions/v1/miron-athena`;

// The fake key that tricks sniffers. The Worker replaces this securely.
const API_KEY = 'sb_publishable_B9mxFwLJl8WWw_Y9C28LtA_AfKYATEc';

export const invokeMiron = async (payload) => {
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
        throw new Error(`Miron Error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
};