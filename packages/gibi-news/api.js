import { supabase } from '@linkup-platform/sdk-core';

// Specific endpoint for the News Team
const NEWS_GATEWAY = 'https://linkup-gateway.getyeteklu2.workers.dev'; 
const API_KEY = 'sb_publishable_B9mxFwLJl8WWw_Y9C28LtA_AfKYATEc';

export const invokeNewsSync = async (payload = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${NEWS_GATEWAY}/functions/v1/feed`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'apikey': API_KEY,
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload)
    });
    return response.json();
};

export const fetchLiveNewsFeed = async (page = 0, limit = 15, channel = null) => {
    const { data: { session } } = await supabase.auth.getSession();
    
    const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(channel ? { channel: channel.replace(/^@/, '').trim().toLowerCase() } : {})
    });

    const response = await fetch(`${NEWS_GATEWAY}/functions/v1/news-feed?${params.toString()}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'apikey': API_KEY,
            ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch news feed (HTTP ${response.status})`);
    }

    return response.json();
};