import { supabase } from '@linkup/core-sdk';

// Dedicated endpoint for Education/RAG Services
// When you create your new worker, just change this URL here.
const ACADEMY_GATEWAY = 'https://linkup-gateway.getyeteklu2.workers.dev';
const DUMMY_KEY = 'lk_live_9a38f2e7b1c4d9e0a2f8d73b';

export const invokeBookReader = async (payload, signal = null) => {
    const { data: { session } } = await supabase.auth.getSession();
    const options = {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'apikey': DUMMY_KEY,
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload),
        signal
    };
    const response = await fetch(`${ACADEMY_GATEWAY}/functions/v1/book-reader`, options);
    return response.json();
};