import { useState, useEffect } from 'react';
import { supabase } from '@linkup-platform/sdk-core';

export const useUsernameCheck = (username, initialUsername) => {
    const [status, setStatus] = useState('idle');

    useEffect(() => {
        if (!username) {
            setStatus('idle');
            return;
        }

        const cleanUsername = username.toLowerCase().trim();
        
        if (initialUsername && cleanUsername === initialUsername.toLowerCase()) {
            setStatus('available');
            return;
        }

        if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
            setStatus('invalid');
            return;
        }

        const checkAvailability = async () => {
            setStatus('checking');
            const { data, error } = await supabase.rpc('check_username_available', { req_username: cleanUsername });
            if (error) setStatus('error');
            else setStatus(data ? 'available' : 'taken');
        };

        const timer = setTimeout(checkAvailability, 500);
        return () => clearTimeout(timer);
    }, [username, initialUsername]);

    return status;
};