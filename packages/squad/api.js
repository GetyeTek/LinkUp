import { supabase } from '@linkup/core-sdk';

// High-concurrency Social Gateway
const SQUAD_GATEWAY = 'https://linkup-gateway.getyeteklu2.workers.dev';
const DUMMY_KEY = 'sq_pub_2d66a1b8c9e08d9e0a2f8d73b';

export const invokeLiveToken = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${SQUAD_GATEWAY}/functions/v1/live-token`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'apikey': DUMMY_KEY,
            'x-linkup-client': 'linkup-secure-client-2026',
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload)
    });
    return response.json();
};

export const invokeSocial = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${SQUAD_GATEWAY}/functions/v1/social-core`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'apikey': DUMMY_KEY,
            'x-linkup-client': 'linkup-secure-client-2026',
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload)
    });
    return response.json();
};