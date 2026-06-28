import { supabase } from '../../src/config/supabaseClient.js';

// High-concurrency Social Gateway
const SQUAD_GATEWAY = 'https://linkup-gateway.getyeteklu2.workers.dev';
const DUMMY_KEY = 'lk_live_9a38f2e7b1c4d9e0a2f8d73b';

export const invokeSocial = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${SQUAD_GATEWAY}/functions/v1/social-core`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'apikey': DUMMY_KEY,
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload)
    });
    return response.json();
};