import { supabase } from './supabaseClient.js';

export const getDeviceId = () => {
    let id = localStorage.getItem('linkup_device_id');
    if (!id) {
        id = `dev_${crypto.randomUUID()}`;
        localStorage.setItem('linkup_device_id', id);
    }
    return id;
};

export const detectDeviceCategory = () => {
    if (navigator.userAgentData?.mobile !== undefined) {
        return navigator.userAgentData.mobile ? 'mobile' : 'desktop';
    }
    const ua = navigator.userAgent || '';
    return /Android|iPhone|iPad|iPod|Mobile|webOS/i.test(ua) ? 'mobile' : 'desktop';
};

const getBrowserName = () => {
    const ua = navigator.userAgent || '';
    if (/Edg/i.test(ua)) return 'Edge';
    if (/Chrome/i.test(ua)) return 'Chrome';
    if (/Safari/i.test(ua)) return 'Safari';
    if (/Firefox/i.test(ua)) return 'Firefox';
    return 'Browser';
};

export const detectDeviceName = async () => {
    const ua = navigator.userAgent || '';
    const browser = getBrowserName();

    // 1. High-Entropy Client Hints (Extracts exact Android hardware models on Chrome/Chromium)
    if (navigator.userAgentData?.getHighEntropyValues) {
        try {
            const hints = await navigator.userAgentData.getHighEntropyValues(['model']);
            if (hints.model) {
                let model = hints.model.trim();
                // Avoid generic frozen placeholders (Chrome sends "K" or generic "Mobile")
                if (model && model !== 'K' && model !== 'Mobile') {
                    if (model.startsWith('SM-')) model = `Samsung ${model}`;
                    return `${model} (${browser})`;
                }
            }
        } catch (e) {
            // Graceful fallback to regex heuristics
        }
    }

    // 2. Legacy / In-App WebView Android User-Agent regex
    const androidMatch = ua.match(/Android\s+[\d.]+;\s*([^;]+?)(?:\s+Build|[;\)])/i);
    if (androidMatch && androidMatch[1]) {
        let candidate = androidMatch[1].trim();
        if (candidate && candidate !== 'K' && candidate !== 'Mobile' && !candidate.startsWith('wv')) {
            if (candidate.startsWith('SM-')) candidate = `Samsung ${candidate}`;
            return `${candidate} (${browser})`;
        }
    }

    // 3. Fallback OS / Device Classification
    let os = 'Unknown Device';
    if (/iPhone/i.test(ua)) os = 'iPhone';
    else if (/iPad/i.test(ua)) os = 'iPad';
    else if (/Android/i.test(ua)) os = 'Android Phone';
    else if (/Windows NT 10.0/i.test(ua)) os = 'Windows 11/10';
    else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';

    return `${os} (${browser})`;
};

export const syncDeviceSession = async (forceTransfer = false) => {
    const deviceId = getDeviceId();
    const deviceType = detectDeviceCategory();
    const deviceName = await detectDeviceName();

    const { data, error } = await supabase.rpc('sync_device_session', {
        p_device_id: deviceId,
        p_device_type: deviceType,
        p_device_name: deviceName,
        p_force_transfer: forceTransfer
    });

    if (error) throw error;
    return data;
};

export const heartbeatDeviceLease = async () => {
    const deviceId = getDeviceId();
    const { data, error } = await supabase.rpc('heartbeat_device_lease', {
        p_device_id: deviceId
    });
    if (error) throw error;
    return data;
};

export const claimDeviceLease = async () => {
    const deviceId = getDeviceId();
    const { data, error } = await supabase.rpc('claim_device_lease', {
        p_device_id: deviceId
    });
    if (error) throw error;
    return data;
};

export const getMyActiveDevices = async () => {
    const { data, error } = await supabase.rpc('get_my_active_devices');
    if (error) throw error;
    return data || [];
};