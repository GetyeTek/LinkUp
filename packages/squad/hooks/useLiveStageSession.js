import { useState, useEffect } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import { invokeLiveToken, invokeSocial } from '../api.js';

export const useLiveStageSession = ({ chat, localChatInfo, setLocalChatInfo, currentUser, isMeHost, isLiveDead, setAlertNotice }) => {
    const [showLiveSetup, setShowLiveSetup] = useState(false);
    const [liveSetupData, setLiveSetupData] = useState({ topic: '', description: '', course: '' });
    const [liveState, setLiveState] = useState('none');
    const [liveCredentials, setLiveCredentials] = useState(null);
    const [isStartingLive, setIsStartingLive] = useState(false);
    const [showRecoveryModal, setShowRecoveryModal] = useState(false);

    // Eject attendants instantly if the session is explicitly killed
    useEffect(() => {
        if (!(localChatInfo.metadata?.is_live && !isLiveDead) && liveState !== 'none') {
            setLiveState('none');
            setLiveCredentials(null);
            setShowRecoveryModal(false);
        }
    }, [localChatInfo.metadata?.is_live, isLiveDead, liveState]);

    useEffect(() => {
        if (localChatInfo.metadata?.is_live && isMeHost && liveState === 'none') {
            if (isStartingLive) return; 
            if (isLiveDead) {
                supabase.rpc('kill_live_session', { conv_id: chat.conversation_id });
            } else {
                setShowRecoveryModal(true);
            }
        }
    }, [localChatInfo.metadata?.is_live, isMeHost, liveState, isLiveDead, chat.conversation_id, isStartingLive]);

    // Heartbeat Engine (Host Only)
    useEffect(() => {
        if (liveState !== 'full' || !isMeHost) return;
        const beat = () => {
            supabase.rpc('heartbeat_live_session', { conv_id: chat.conversation_id, req_host_id: currentUser.id });
        };
        beat(); // Initial pulse
        const int = setInterval(beat, 15000); // Pulse every 15s
        return () => clearInterval(int);
    }, [liveState, isMeHost, chat.conversation_id, currentUser.id]);

    // Auto-Join Interceptor for Live Links
    useEffect(() => {
        if (chat.auto_join_live) {
            chat.auto_join_live = false; 
            if (liveState === 'none') {
                const isLive = localChatInfo.metadata?.is_live || chat.metadata?.is_live;
                if (isLive) {
                    const currentHostId = localChatInfo.metadata?.live_host_id || chat.metadata?.live_host_id;
                    if (currentHostId === currentUser.id) {
                        startLiveSession();
                    } else {
                        joinLiveSession();
                    }
                }
            } else if (liveState === 'minimized') {
                setLiveState('full');
            }
        }
    }, [chat.auto_join_live, liveState, localChatInfo.metadata, chat.metadata]);

    const startLiveSession = async (setupData = null) => {
        setIsStartingLive(true);
        try {
            const resToken = await invokeLiveToken({ conversation_id: chat.conversation_id });
            if (resToken.error) throw new Error(resToken.error);
            setLiveCredentials({ token: resToken.token, url: resToken.ws_url });
            
            if (setupData) {
                const resMeta = await invokeSocial({ action: 'start_live_session', conversation_id: chat.conversation_id, setupData });
                if (resMeta.error) throw new Error(resMeta.error);
                setLocalChatInfo(prev => ({ ...prev, metadata: resMeta.metadata }));
            }
            
            setLiveState('full');
            setShowRecoveryModal(false);
        } catch (err) {
            setAlertNotice({ title: "Stage Error", msg: err.message, success: false });
        }
        setIsStartingLive(false);
    };

    const joinLiveSession = async () => {
        setIsStartingLive(true);
        try {
            const res = await invokeLiveToken({ conversation_id: chat.conversation_id });
            if (res.error) throw new Error(res.error);
            setLiveCredentials({ token: res.token, url: res.ws_url });
            setLiveState('full');
        } catch (err) {
            setAlertNotice({ title: "Connection Error", msg: err.message, success: false });
        }
        setIsStartingLive(false);
    };

    const endLiveSession = async (forceKill = false) => {
        if (isMeHost || forceKill) {
            setLocalChatInfo(prev => {
                const nextMeta = { ...prev.metadata };
                delete nextMeta.is_live;
                delete nextMeta.live_host_id;
                delete nextMeta.live_status;
                delete nextMeta.live_heartbeat;
                return { ...prev, metadata: nextMeta };
            });
        }

        setLiveState('none');
        setLiveCredentials(null);
        setShowRecoveryModal(false);
        
        if (isMeHost || forceKill) {
            await supabase.from('live_study_sessions').delete().eq('conversation_id', chat.conversation_id);
            await supabase.rpc('kill_live_session', { conv_id: chat.conversation_id });
        }
    };

    return {
        liveState, setLiveState,
        liveCredentials,
        showLiveSetup, setShowLiveSetup,
        liveSetupData, setLiveSetupData,
        isStartingLive,
        showRecoveryModal,
        startLiveSession, joinLiveSession, endLiveSession
    };
};