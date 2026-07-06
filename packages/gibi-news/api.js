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
            'x-linkup-client': 'linkup-secure-client-2026',
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload)
    });
    return response.json();
};

export const fetchLiveNewsFeed = async (page = 0, limit = 15) => {
    // Utilize native Supabase pagination via our secure gateway
    const start = page * limit;
    const end = start + limit - 1;
    
    const { data, error } = await supabase
        .from('news_feed')
        .select('*')
        .order('telegram_timestamp', { ascending: false })
        .range(start, end);
        
    if (error) throw error;
    return { news: data || [] };
};