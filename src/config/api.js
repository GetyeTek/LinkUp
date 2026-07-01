import { supabase } from '@linkup-platform/sdk-core';

// --- SECURE PROXY ROUTING ---
// Maintained strictly for Global Platform Services
const GATEWAY_BASE = 'https://linkup-gateway.getyeteklu2.workers.dev';

export const MIRON_ENDPOINT = `${GATEWAY_BASE}/functions/v1/miron-athena`;

// The fake key that tricks sniffers. The Worker replaces this securely.
const DUMMY_KEY = 'plt_pub_1a99f3c4d5e68d9e0a2f8d73b';

export const invokeMiron = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    
    const response = await fetch(MIRON_ENDPOINT, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'apikey': DUMMY_KEY, // Pass dummy key
            'x-linkup-client': 'linkup-secure-client-2026',
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        throw new Error(`Miron Error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
};