import { supabase } from '../../src/config/supabaseClient.js';

// Specific endpoint for the News Team
const NEWS_GATEWAY = 'https://linkup-gateway.getyeteklu2.workers.dev'; 
const DUMMY_KEY = 'lk_live_9a38f2e7b1c4d9e0a2f8d73b';

export const invokeNews = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${NEWS_GATEWAY}/functions/v1/news-engine`, {
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