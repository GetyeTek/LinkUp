import { supabase } from '@linkup-platform/sdk-core';

// Specific endpoint for the News Team
const NEWS_GATEWAY = 'https://linkup-gateway.getyeteklu2.workers.dev'; 
const DUMMY_KEY = 'gn_pub_8f72c3b4a5e68d9e0a2f8d73b';

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

export const fetchLiveNewsFeed = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${NEWS_GATEWAY}/functions/v1/news-feed`, {
        method: 'GET',
        headers: { 
            'Content-Type': 'application/json',
            'apikey': DUMMY_KEY,
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        }
    });
    return response.json();
};