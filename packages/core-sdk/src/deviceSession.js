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

export const detectDeviceName = () => {
    const ua = navigator.userAgent || '';
    const isMobile = detectDeviceCategory() === 'mobile';
    
    let os = 'Unknown Device';
    if (/iPhone/i.test(ua)) os = 'iPhone';
    else if (/iPad/i.test(ua)) os = 'iPad';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/Windows NT 10.0/i.test(ua)) os = 'Windows 11/10';
    else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';

    let browser = 'Browser';
    if (/Edg/i.test(ua)) browser = 'Edge';
    else if (/Chrome/i.test(ua)) browser = 'Chrome';
    else if (/Safari/i.test(ua)) browser = 'Safari';
    else if (/Firefox/i.test(ua)) browser = 'Firefox';

    return `${os} (${browser})`;
};

export const syncDeviceSession = async (forceTransfer = false) => {
    const deviceId = getDeviceId();
    const deviceType = detectDeviceCategory();
    const deviceName = detectDeviceName();

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