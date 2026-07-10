import { useState, useEffect } from 'react';
import { supabase } from '@linkup-platform/sdk-core';

export const usePhoneCheck = (phone, initialPhone) => {
    const [result, setResult] = useState({ status: 'idle', meta: null });

    useEffect(() => {
        if (!phone) {
            setResult({ status: 'idle', meta: null });
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
        
        let normalizedInitial = initialPhone ? initialPhone.replace(/\s+/g, '') : '';
        if (normalizedInitial) {
            if (!normalizedInitial.startsWith('+')) {
                if (normalizedInitial.startsWith('0')) normalizedInitial = '+251' + normalizedInitial.substring(1);
                else normalizedInitial = '+' + normalizedInitial;
            }
        }

        if (normalizedInitial && normalizedPhone === normalizedInitial) {
            setResult({ status: 'available', meta: null });
            return;
        }

        if (!/^(09|07)\d{8}$|^\+251[79]\d{8}$/.test(cleanPhone)) {
            setResult({ status: 'invalid', meta: null });
            return;
        }

        const checkAvailability = async () => {
            setResult({ status: 'checking', meta: null });
            const { data, error } = await supabase.rpc('check_phone_link_status', { req_phone: normalizedPhone });
            if (error) {
                setResult({ status: 'error', meta: null });
            } else {
                if (data && data.exists) {
                    setResult({ status: 'taken', meta: data });
                } else {
                    setResult({ status: 'available', meta: null });
                }
            }
        };

        const timer = setTimeout(checkAvailability, 500);
        return () => clearTimeout(timer);
    }, [phone, initialPhone]);

    return result;
};