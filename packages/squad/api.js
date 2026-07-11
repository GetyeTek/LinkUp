import { supabase } from '@linkup-platform/sdk-core';

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

export const uploadChatMedia = async (file, filePath, onProgress) => {
    const { data: { session } } = await supabase.auth.getSession();
    const GATEWAY = 'https://linkup-gateway.getyeteklu2.workers.dev';
    const DUMMY_KEY = 'sq_pub_2d66a1b8c9e08d9e0a2f8d73b';

    for (let retry = 0; retry < 3; retry++) {
        try {
            await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.upload.addEventListener('progress', (e) => {
                    if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
                });
                xhr.addEventListener('load', () => {
                    if (xhr.status >= 200 && xhr.status < 300) resolve();
                    else reject(new Error(`HTTP ${xhr.status}`));
                });
                xhr.addEventListener('error', () => reject(new Error("Network Error")));
                xhr.addEventListener('abort', () => reject(new Error("Aborted")));
                xhr.open('POST', `${GATEWAY}/storage/v1/object/chat_media/${filePath}`);
                xhr.setRequestHeader('apikey', DUMMY_KEY);
                if (session) xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
                xhr.setRequestHeader('x-linkup-client', 'linkup-secure-client-2026');
                xhr.setRequestHeader('Content-Type', file.type);
                xhr.send(file);
            });
            const { data } = supabase.storage.from('chat_media').getPublicUrl(filePath);
            return data.publicUrl;
        } catch (err) {
            if (retry === 2) throw err;
            await new Promise(r => setTimeout(r, 1500));
        }
    }
};

export const generateMironLecture = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${SQUAD_GATEWAY}/functions/v1/miron-lecture-generator`, {
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