import { useState, useEffect } from 'react';
import { supabase } from '@linkup-platform/sdk-core';

export const usePhoneCheck = (phone, initialPhone) => {
    const [status, setStatus] = useState('idle');

    useEffect(() => {
        if (!phone) {
            setStatus('idle');
            return;
        }

        const cleanPhone = phone.replace(/\s+/g, '');
        let normalizedPhone = cleanPhone;
        if (normalizedPhone) {
            if (!normalizedPhone.startsWith('+')) {
                if (normalizedPhone.startsWith('0')) {
                    normalizedPhone = '+251' + normalizedPhone.substring(1);
                } else {
                    normalizedPhone = '+' + normalizedPhone;
                }
            }
        }
        
        // Check against initial to prevent flashing available/taken if it hasn't changed
        let normalizedInitial = initialPhone ? initialPhone.replace(/\s+/g, '') : '';
        if (normalizedInitial) {
            if (!normalizedInitial.startsWith('+')) {
                if (normalizedInitial.startsWith('0')) normalizedInitial = '+251' + normalizedInitial.substring(1);
                else normalizedInitial = '+' + normalizedInitial;
            }
        }

        if (normalizedInitial && normalizedPhone === normalizedInitial) {
            setStatus('available');
            return;
        }

        if (!/^(09|07)\d{8}$|^\+251[79]\d{8}$/.test(cleanPhone)) {
            setStatus('invalid');
            return;
        }

        const checkAvailability = async () => {
            setStatus('checking');
            const { data, error } = await supabase.rpc('check_phone_registered', { req_phone: normalizedPhone });
            if (error) setStatus('error');
            else setStatus(data ? 'taken' : 'available');
        };

        const timer = setTimeout(checkAvailability, 500);
        return () => clearTimeout(timer);
    }, [phone, initialPhone]);

    return status;
};