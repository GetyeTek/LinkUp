import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import { createPortal } from 'react-dom';
import LiveStageSetupModal from './components/LiveStageSetupModal.jsx';
import ChatSearchOverlay from './components/ChatSearchOverlay.jsx';
import FullscreenMediaGallery from './components/FullscreenMediaGallery.jsx';
import { LiveKitRoom, useParticipants, useLocalParticipant, RoomAudioRenderer } from 'https://esm.sh/@livekit/components-react@2.6.2?external=react,react-dom';
import { invokeLiveToken, invokeSocial } from './api.js';
import './GroupChat.css';
import FloatingLiveOrb from './components/FloatingLiveOrb.jsx';
import ConnectionRing from './components/ConnectionRing.jsx';
import GroupInfoPanel from './components/GroupInfoPanel.jsx';
import LiveStageContent from './components/LiveStageContent.jsx';





const GroupChat = ({ chat, currentUser, isHidden, targetMessageId, onClose, onMinimize, onJoin, isJoining, onForward, onOriginClick, onOpenUser, onlineUsers, presenceSynced }) => {
    const { user: userProfile } = usePlatform();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [members, setMembers] = useState({});
    const [myRole, setMyRole] = useState('member');
    const [activeMenu, setActiveMenu] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [editingMessage, setEditingMessage] = useState(null);
    const [replyingTo, setReplyingTo] = useState(null);
    const [pendingAttachments, setPendingAttachments] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [fullscreenGallery, setFullscreenGallery] = useState(null);
    const fileInputRef = useRef(null);

    const [alertNotice, setAlertNotice] = useState(null); // Parent Error Trapper
    const [typingUsers, setTypingUsers] = useState([]);
    // Group Hub State
    const [localChatInfo, setLocalChatInfo] = useState({ title: chat.title, avatar_url: chat.avatar_url, metadata: chat.metadata });
    const [isInfoOpen, setIsInfoOpen] = useState(false);
    
    // Live Setup State
    const [showLiveSetup, setShowLiveSetup] = useState(false);
    const [liveSetupData, setLiveSetupData] = useState({ topic: '', description: '', course: '' });
    const [liveState, setLiveState] = useState('none');
    const [liveCredentials, setLiveCredentials] = useState(null);
    const [isStartingLive, setIsStartingLive] = useState(false);
    const [showRecoveryModal, setShowRecoveryModal] = useState(false);
    
    // Auto-hide success toasts on parent
    // Auto-hide success toasts on parent
    useEffect(() => {
        if (alertNotice?.success) {
            const timer = setTimeout(() => setAlertNotice(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [alertNotice]);
    
    // Moderation State
    const [myMutedUntil, setMyMutedUntil] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null); // ID of message to delete
    const [kickedNotice, setKickedNotice] = useState(false);
    const [avatarError, setAvatarError] = useState(false);
    const [showAdminSettings, setShowAdminSettings] = useState(false);

    // Reset header avatar error state if URL changes
    useEffect(() => setAvatarError(false), [localChatInfo.avatar_url]);

    const toggleAdminSetting = async (key, currentVal) => {
        let defaultVal = false;
        if (key === 'members_can_post' || key === 'members_can_add') defaultVal = true;
        const actualVal = currentVal ?? defaultVal;
        const newValue = !actualVal;
        
        // Optimistic UI Update
        setLocalChatInfo(prev => ({ ...prev, metadata: { ...prev.metadata, [key]: newValue } }));
        
        try {
            const res = await invokeSocial({ action: 'toggle_admin_setting', conversation_id: chat.conversation_id, key, value: newValue });
            if (res.error) throw new Error(res.error);
        } catch(e) {
            // Revert on error
            setLocalChatInfo(prev => ({ ...prev, metadata: { ...prev.metadata, [key]: actualVal } }));
            setAlertNotice("Action denied. You do not have permission to alter group settings.");
        }
    };

    const membersCanPost = localChatInfo.metadata?.members_can_post !== false;
    const canPost = myRole === 'owner' || myRole === 'admin' || membersCanPost;

    // Search State
    const [isSearchActive, setIsSearchActive] = useState(false);

    const flowRef = useRef(null);
    const channelRef = useRef(null);
    const isAutoScrollEnabled = useRef(true);
    const typingTimeoutRef = useRef(null);
    const localTypingRef = useRef(false);

    // Session Recovery & Heartbeat Diagnostics
    const heartBeatTime = localChatInfo.metadata?.live_heartbeat 
        ? new Date(localChatInfo.metadata.live_heartbeat).getTime() 
        : Date.now(); // Default to now to prevent instant death for fresh sessions
        
    const timeSinceBeat = Date.now() - heartBeatTime;
    
    // Allow a 5-minute window, but enforce instant dismount if the human host is globally offline
    const isHostOnline = localChatInfo.metadata?.ai_hosting || 
                         (currentUser.id === localChatInfo.metadata?.live_host_id) || 
                         (onlineUsers && onlineUsers.has(localChatInfo.metadata?.live_host_id));
                         
    const isLiveDead = timeSinceBeat > 5 * 60 * 1000 || (presenceSynced && !localChatInfo.metadata?.ai_hosting && !isHostOnline);

    const isLiveActive = localChatInfo.metadata?.is_live && !isLiveDead;
    const isMeHost = localChatInfo.metadata?.live_host_id === currentUser.id;

    // Eject attendants instantly if the session is explicitly killed
    useEffect(() => {
        if (!isLiveActive && liveState !== 'none') {
            setLiveState('none');
            setLiveCredentials(null);
            setShowRecoveryModal(false);
        }
    }, [isLiveActive, liveState]);

    // Show banner as long as the session is technically active in DB. 
    // (If the host is dropping packets, attendants can wait inside the room).
    const showLiveBanner = isLiveActive;

    useEffect(() => {
        if (localChatInfo.metadata?.is_live && isMeHost && liveState === 'none') {
            if (isStartingLive) return; // Short-circuit: Prevent recovery popups while we are actively launching a session
            if (isLiveDead) {
                // Auto-cleanup dead sessions
                supabase.rpc('kill_live_session', { conv_id: chat.conversation_id });
            } else {
                setShowRecoveryModal(true);
            }
        }
    }, [localChatInfo.metadata?.is_live, isMeHost, liveState, isLiveDead, chat.conversation_id, isStartingLive]);

    const startLiveSession = async (setupData = null) => {
        setIsStartingLive(true);
        try {
            const resToken = await invokeLiveToken({ conversation_id: chat.conversation_id });
            if (resToken.error) throw new Error(resToken.error);
            setLiveCredentials({ token: resToken.token, url: resToken.ws_url });
            
            const resMeta = await invokeSocial({ action: 'start_live_session', conversation_id: chat.conversation_id, setupData });
            if (resMeta.error) throw new Error(resMeta.error);
            
            setLocalChatInfo(prev => ({ ...prev, metadata: resMeta.metadata }));
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
        // ROBUST OPTIMISTIC UPDATE:
        // Clear metadata immediately so the Recovery Modal Effect doesn't see a "crashed" state
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
            // Background cleanup in DB
            await supabase.from('live_study_sessions').delete().eq('conversation_id', chat.conversation_id);
            await supabase.rpc('kill_live_session', { conv_id: chat.conversation_id });
        }
    };

    // Auto-Join Interceptor for Live Links
    useEffect(() => {
        if (chat.auto_join_live) {
            chat.auto_join_live = false; // Consume flag to prevent loops
            if (liveState === 'none') {
                const isLive = localChatInfo.metadata?.is_live || chat.metadata?.is_live;
                if (isLive) {
                    const currentHostId = localChatInfo.metadata?.live_host_id || chat.metadata?.live_host_id;
                    if (currentHostId === currentUser.id) {
                        // If they are the host, this acts as a resume
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

    const markAsRead = async () => {
        if (!chat.conversation_id) return;
        // Anti-Clock-Skew: Offset by 5 seconds into the future to ensure server trusts we read it
        const skewAdjustedTime = new Date(Date.now() + 5000).toISOString();
        
        await supabase.from('conversation_members')
            .update({ last_read_at: skewAdjustedTime })
            .eq('conversation_id', chat.conversation_id)
            .eq('user_id', currentUser.id);
    };

    const fetchMessages = async () => {
        if (!chat.conversation_id) return;
        const { data } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', chat.conversation_id)
            .order('created_at', { ascending: true });
        if (data) setMessages(data.map(m => ({ ...m, status: 'sent' })));
    };

    useEffect(() => {
        const fetchState = async () => {
            // OPTIMIZATION: Fire the heavy queries in parallel instead of sequentially
            const [msgResponse, memResponse, convResponse] = await Promise.all([
                supabase.from('messages')
                    .select('*')
                    .eq('conversation_id', chat.conversation_id)
                    .order('created_at', { ascending: true }),
                supabase.from('conversation_members')
                    .select('user_id, role, muted_until')
                    .eq('conversation_id', chat.conversation_id),
                supabase.from('conversations')
                    .select('title, avatar_url, metadata')
                    .eq('id', chat.conversation_id)
                    .maybeSingle()
            ]);

            if (convResponse.data) {
                setLocalChatInfo(prev => ({
                    ...prev,
                    title: convResponse.data.title,
                    avatar_url: convResponse.data.avatar_url,
                    metadata: convResponse.data.metadata
                }));
            }

            let memMap = {};
            const memberIds = memResponse.data ? memResponse.data.map(m => m.user_id) : [];
            const senderIds = msgResponse.data ? msgResponse.data.map(m => m.sender_id).filter(Boolean) : [];
            
            // Combine members and historical message senders to ensure we have profile data for everyone
            const allUserIds = Array.from(new Set([...memberIds, ...senderIds]));

            if (allUserIds.length > 0) {
                // Securely fetch public profiles bypassing RLS
                const { data: profiles } = await supabase.rpc('get_public_profiles', { user_ids: allUserIds });

                allUserIds.forEach(uid => {
                    const prof = profiles?.find(p => p.id === uid);
                    const memData = memResponse.data?.find(m => m.user_id === uid);
                    
                    memMap[uid] = { 
                        role: memData ? memData.role : null, 
                        is_current_member: !!memData,
                        name: prof?.full_name || 'Unknown User', 
                        avatar: prof?.avatar_url || '' 
                    };
                    
                    if (uid === currentUser.id && memData) {
                        setMyRole(memData.role);
                        setMyMutedUntil(memData.muted_until);
                    }
                });
                setMembers(memMap);
            }

            // Immediately set the messages that we fetched concurrently
            if (msgResponse.data) {
                setMessages(msgResponse.data.map(m => ({ ...m, status: 'sent' })));
            }
            
            setIsLoading(false);
            markAsRead(); // Clear badges on load
        };

        fetchState();

        const channel = supabase.channel(`group_${chat.conversation_id}`, {
            config: { presence: { key: currentUser.id } }
        });

        channelRef.current = channel;

        channel
            .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chat.conversation_id}` }, (payload) => {
                if (payload.eventType === 'INSERT') {
                    setMessages(prev => {
                        if (prev.find(m => m.id === payload.new.id)) return prev;
                        return [...prev, { ...payload.new, status: 'sent' }];
                    });
                    // Suppress badge increments if we are actively viewing the chat
                    markAsRead(); // Unconditionally mark as read to clear badges
                } else if (payload.eventType === 'UPDATE') {
                    setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...payload.new, status: 'sent' } : m));
                } else if (payload.eventType === 'DELETE') {
                    setMessages(prev => prev.filter(m => m.id !== payload.old.id));
                }
            })
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                const activeTypers = [];
                
                Object.keys(state).forEach(uid => {
                    if (uid !== currentUser.id) {
                        let latest = null;
                        state[uid].forEach(p => {
                            if (!latest || (p.updatedAt || 0) > (latest.updatedAt || 0)) latest = p;
                        });
                        
                        if (latest && latest.isTyping) {
                            activeTypers.push(uid);
                        }
                    }
                });
                
                setTypingUsers(activeTypers);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({ isTyping: false, updatedAt: Date.now() });
                }
            });

        const memberChannel = supabase.channel(`members_${chat.conversation_id}`)
            .on('postgres_changes', { 
                event: '*', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${chat.conversation_id}`
            }, (payload) => {
                if (payload.eventType === 'INSERT') {
                    // Optimistic UI insert to trigger the live counter instantly
                    setMembers(prev => ({...prev, [payload.new.user_id]: { role: payload.new.role, name: 'Loading...', avatar: '' }}));
                    
                    // Fetch real profile silently via secure RPC
                    supabase.rpc('get_user_profile_public', { target_user_id: payload.new.user_id })
                        .then(({data}) => {
                            if (data) {
                                setMembers(prev => ({...prev, [payload.new.user_id]: { role: payload.new.role, is_current_member: true, name: data.full_name, avatar: data.avatar_url }}));
                            }
                        });
                } else if (payload.eventType === 'UPDATE') {
                    if (payload.new.user_id === currentUser.id) {
                        setMyMutedUntil(payload.new.muted_until);
                        setMyRole(payload.new.role);
                    } else {
                        setMembers(prev => ({...prev, [payload.new.user_id]: { ...prev[payload.new.user_id], role: payload.new.role }}));
                    }
                } else if (payload.eventType === 'DELETE') {
                    if (payload.old.user_id === currentUser.id) {
                        setKickedNotice(true);
                    } else {
                        setMembers(prev => {
                            const next = {...prev};
                            delete next[payload.old.user_id];
                            return next;
                        });
                    }
                }
            })
            .subscribe();

        // Listen for Global Meta Changes (like Admin toggling write-access)
        const convChannel = supabase.channel(`conv_${chat.conversation_id}`)
            .on('postgres_changes', { 
                event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${chat.conversation_id}`
            }, (payload) => {
                setLocalChatInfo(prev => ({
                    ...prev,
                    title: payload.new.title,
                    avatar_url: payload.new.avatar_url,
                    metadata: payload.new.metadata
                }));
            })
            .subscribe();

        // Explicitly untrack to instantly kill ghosts instead of waiting for Supabase heartbeat timeout
        const handleBeforeUnload = () => {
            channel.untrack();
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            channel.untrack(); // Force drop presence
            supabase.removeChannel(channel);
            supabase.removeChannel(memberChannel);
            supabase.removeChannel(convChannel);
        };
    }, [chat.conversation_id]);

    // Handle deep linking scroll injection
    useEffect(() => {
        if (targetMessageId && messages.length > 0) {
            setTimeout(() => {
                scrollToMessage(targetMessageId);
            }, 300); // Allow DOM paint to finish
        }
    }, [targetMessageId, messages.length]);

    useEffect(() => {
        // Smart Scroll: Only yank down if the user is already near the bottom (or on initial load)
        if (flowRef.current && !isSearchActive) {
            if (isAutoScrollEnabled.current) {
                flowRef.current.scrollTop = flowRef.current.scrollHeight;
            }
        }
    }, [messages, isSearchActive]);
    


    const handleInputChange = (val) => {
        setInput(val);
        if (channelRef.current && !chat.is_preview) {
            const isTypingNow = val.length > 0;
            
            if (isTypingNow && !localTypingRef.current) {
                channelRef.current.track({ isTyping: true, updatedAt: Date.now() }).catch(e => console.error("[GroupChat] Track error:", e));
                localTypingRef.current = true;
            } else if (!isTypingNow && localTypingRef.current) {
                channelRef.current.track({ isTyping: false, updatedAt: Date.now() }).catch(e => console.error("[GroupChat] Track error:", e));
                localTypingRef.current = false;
            }
            
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            if (isTypingNow) {
                typingTimeoutRef.current = setTimeout(() => {
                    if (channelRef.current) channelRef.current.track({ isTyping: false, updatedAt: Date.now() });
                    localTypingRef.current = false;
                }, 2500);
            }
        }
    };

    const handleFileSelect = (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        
        let validFiles = files;
        if (pendingAttachments.length + files.length > 10) {
            setAlertNotice({ title: "Limit Reached", msg: "You can only attach up to 10 files at once." });
            const remainingSlots = 10 - pendingAttachments.length;
            validFiles = files.slice(0, remainingSlots);
        }
        
        const oversized = validFiles.find(f => f.size > 10 * 1024 * 1024);
        if (oversized) {
            setAlertNotice({ title: "File too large", msg: "One or more files exceed the 10MB limit." });
            e.target.value = null;
            return;
        }
        
        const processed = validFiles.map(file => ({
            file,
            previewUrl: file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : null
        }));
        
        setPendingAttachments(prev => [...prev, ...processed]);
        e.target.value = null;
    };

    const getFileIconProps = (filename) => {
        if (!filename) return { icon: 'fa-file', color: 'var(--accent-teal)' };
        const ext = filename.split('.').pop().toLowerCase();
        switch(ext) {
            case 'pdf': return { icon: 'fa-file-pdf', color: '#ff4757' };
            case 'doc': case 'docx': return { icon: 'fa-file-word', color: '#3498db' };
            case 'xls': case 'xlsx': case 'csv': return { icon: 'fa-file-excel', color: '#2ecc71' };
            case 'ppt': case 'pptx': return { icon: 'fa-file-powerpoint', color: '#e67e22' };
            case 'txt': return { icon: 'fa-file-lines', color: '#95a5a6' };
            case 'epub': return { icon: 'fa-book', color: '#9b59b6' };
            case 'zip': case 'rar': case '7z': return { icon: 'fa-file-zipper', color: '#f1c40f' };
            default: return { icon: 'fa-file', color: 'var(--accent-teal)' };
        }
    };

    const handleSend = async () => {
        if ((!input.trim() && pendingAttachments.length === 0) || isUploading) return;
        
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        if (channelRef.current && localTypingRef.current) {
            channelRef.current.track({ isTyping: false, updatedAt: Date.now() });
            localTypingRef.current = false;
        }

        const msgText = input;
        const currentAttachments = [...pendingAttachments];
        
        setInput('');
        setPendingAttachments([]);

        if (editingMessage) {
            setMessages(prev => prev.map(m => m.id === editingMessage.id ? { ...m, text: msgText, is_edited: true } : m));
            await supabase.from('messages').update({ text: msgText, is_edited: true }).eq('id', editingMessage.id);
            setEditingMessage(null);
            return;
        }

        const currentReplyId = replyingTo?.id;
        setReplyingTo(null);

        const tempId = `temp-${Date.now()}`;
        setMessages(prev => [...prev, {
            id: tempId, conversation_id: chat.conversation_id,
            sender_id: currentUser.id, text: msgText,
            reply_to_id: currentReplyId,
            attachments: currentAttachments.map(a => ({ name: a.file.name, type: a.file.type, url: a.previewUrl || '' })),
            created_at: new Date().toISOString(), status: 'pending'
        }]);

        let finalAttachments = [];

        if (currentAttachments.length > 0) {
            setIsUploading(true);
            setUploadProgress(0);
            const totalFiles = currentAttachments.length;
            let completedFiles = 0;

            const { data: { session } } = await supabase.auth.getSession();
            const GATEWAY = 'https://linkup-gateway.getyeteklu2.workers.dev';
            const DUMMY_KEY = 'sq_pub_2d66a1b8c9e08d9e0a2f8d73b';

            for (const att of currentAttachments) {
                try {
                    const file = att.file;
                    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    const filePath = `groups/${chat.conversation_id}/${currentUser.id}/${Date.now()}_${safeName}`;
                    let publicUrl = '';

                    for (let retry = 0; retry < 3; retry++) {
                        try {
                            await new Promise((resolve, reject) => {
                                const xhr = new XMLHttpRequest();
                                xhr.upload.addEventListener('progress', (e) => {
                                    if (e.lengthComputable) {
                                        const fileProg = e.loaded / e.total;
                                        const globalProg = Math.round(((completedFiles + fileProg) / totalFiles) * 100);
                                        setUploadProgress(globalProg);
                                    }
                                });
                                xhr.addEventListener('load', () => {
                                    if (xhr.status >= 200 && xhr.status < 300) resolve();
                                    else reject(new Error(`HTTP ${xhr.status}`));
                                });
                                xhr.addEventListener('error', () => reject(new Error("Network Error")));
                                xhr.addEventListener('abort', () => reject(new Error("Aborted")));
                                xhr.open('POST', `${GATEWAY}/storage/v1/object/chat_media/${filePath}`);
                                xhr.setRequestHeader('apikey', DUMMY_KEY);
                                xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
                                xhr.setRequestHeader('x-linkup-client', 'linkup-secure-client-2026');
                                xhr.setRequestHeader('Content-Type', file.type);
                                xhr.send(file);
                            });
                            const { data } = supabase.storage.from('chat_media').getPublicUrl(filePath);
                            publicUrl = data.publicUrl;
                            break;
                        } catch (err) {
                            if (retry === 2) throw err;
                            await new Promise(r => setTimeout(r, 1500));
                        }
                    }
                    
                    finalAttachments.push({ name: file.name, url: publicUrl, path: filePath, type: file.type, size: file.size, previewUrl: att.previewUrl });
                    completedFiles++;
                    setUploadProgress(Math.round((completedFiles / totalFiles) * 100));

                } catch (err) {
                    setAlertNotice({ title: "Partial Upload Failure", msg: `Failed to upload ${att.file.name}. Sending successfully uploaded files.` });
                }
            }
            
            setIsUploading(false);
            if (finalAttachments.length === 0) {
                setMessages(prev => prev.filter(m => m.id !== tempId));
                return;
            }
        }

        const { data, error } = await supabase.from('messages').insert({
            conversation_id: chat.conversation_id,
            sender_id: currentUser.id,
            text: msgText,
            reply_to_id: currentReplyId,
            attachments: finalAttachments
        }).select().maybeSingle();
        
        if (error) {
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed' } : m));
            setAlertNotice({ title: "Action Blocked", msg: error.message || "Message failed to send. You may lack permission.", success: false });
        } else if (data) {
            if (finalAttachments.length > 0) {
                data.attachments = data.attachments.map(dbAtt => {
                    const localMatch = finalAttachments.find(fa => fa.name === dbAtt.name);
                    if (localMatch && localMatch.previewUrl) {
                        return { ...dbAtt, url: localMatch.previewUrl };
                    }
                    return dbAtt;
                });
            }
            setMessages(prev => prev.map(m => m.id === tempId ? { ...data, status: 'sent' } : m));
        }
    };

    const deleteMessage = (msgId) => {
        setDeleteConfirm(msgId);
        setActiveMenu(null);
    };

    const confirmAndDelete = async () => {
        if (!deleteConfirm) return;
        const msgId = deleteConfirm;
        setDeleteConfirm(null);
        
        console.group(`[Squad:Chat] Executing DELETE for node: ${msgId}`);
        const msgToDelete = messages.find(m => m.id === msgId);
        
        // 1. Optimistic UI removal
        setMessages(prev => prev.filter(m => m.id !== msgId));
        
        try {
            // 2. Storage Cleanup
            if (msgToDelete?.attachments && msgToDelete.attachments.length > 0) {
                const paths = msgToDelete.attachments.map(att => att.path).filter(Boolean);
                if (paths.length > 0) {
                    await supabase.storage.from('chat_media').remove(paths);
                }
            }
            // 3. Database Deletion
            const { error } = await supabase.from('messages').delete().eq('id', msgId);
            if (error) {
                setAlertNotice("Deletion failed. You do not have permission to delete this message.");
                fetchMessages(); // Resync state
            }
        } catch (err) {
            console.error("[Squad:Chat] Deletion failed:", err);
            fetchMessages(); // Resync state
        }
        console.groupEnd();
    };

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
        setActiveMenu(null);
    };

    const handleDownload = (url, filename) => {
        setActiveMenu(null);
        const downloadUrl = `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(filename)}`;
        
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.target = '_self'; 
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleDownloadAll = (attachments) => {
        setActiveMenu(null);
        attachments.forEach((att, index) => {
            setTimeout(() => {
                handleDownload(att.url, att.name);
            }, index * 400); // Stagger to avoid browser popup blocks
        });
    };

    const startEditing = (msg) => {
        setEditingMessage(msg);
        setInput(msg.text);
        setActiveMenu(null);
    };

    const startReply = (msg) => {
        setReplyingTo(msg);
        setActiveMenu(null);
    };

    const handlePinMessage = async (msg) => {
        setActiveMenu(null);
        const pinText = msg.text || (msg.attachments?.length > 0 ? '📎 Attachment' : 'Message');
        const senderName = msg.sender_id === currentUser.id ? 'You' : (members[msg.sender_id]?.name || 'Unknown');
        const payload = { id: msg.id, text: pinText, sender_name: senderName };
        
        // Optimistic UI Update
        setLocalChatInfo(prev => ({ ...prev, metadata: { ...prev.metadata, pinned_message: payload } }));
        
        try {
            const res = await invokeSocial({ action: 'pin_message', conversation_id: chat.conversation_id, pinned_message: payload });
            if (res.error) throw new Error(res.error);
        } catch(e) {
            setAlertNotice({ title: "Pin Failed", msg: e.message, success: false });
            // Revert optimistic update on failure
            setLocalChatInfo(prev => {
                const nextMeta = { ...prev.metadata };
                delete nextMeta.pinned_message;
                return { ...prev, metadata: nextMeta };
            });
        }
    };

    const handleUnpinMessage = async () => {
        // Optimistic UI Update
        setLocalChatInfo(prev => {
            const nextMeta = { ...prev.metadata };
            delete nextMeta.pinned_message;
            return { ...prev, metadata: nextMeta };
        });
        
        try {
            const res = await invokeSocial({ action: 'pin_message', conversation_id: chat.conversation_id, pinned_message: null });
            if (res.error) throw new Error(res.error);
        } catch(e) {
            setAlertNotice({ title: "Unpin Failed", msg: e.message, success: false });
        }
    };

    const scrollToMessage = (id) => {
        const el = document.getElementById(`sq-msg-${id}`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('squad-msg-highlight-flash');
        setTimeout(() => el.classList.remove('squad-msg-highlight-flash'), 2500);
    };

    const formatTime = (isoString) => {
        if (!isoString) return '';
        return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const isMember = !!members[currentUser.id];

            const handleBack = () => {
            if (liveState !== 'none') onMinimize();
            else onClose();
        };

        const showHeaderLiveBtn = isLiveActive || (myRole === 'owner' || myRole === 'admin');

        const handleHeaderLiveClick = () => {
            if (isLiveActive) {
                if (liveState === 'minimized') {
                    setLiveState('full');
                } else if (liveState === 'none') {
                    if (isMeHost) {
                        startLiveSession();
                    } else {
                        joinLiveSession();
                    }
                }
            } else {
                setShowLiveSetup(true);
            }
        };

    return (
        <>
        <div className="squad-chat-overlay" style={{ display: isHidden ? 'none' : 'flex' }} onTouchStart={e => e.stopPropagation()}>
            <div className="ambient-prism-light"></div>

            {kickedNotice && (
                <div className="kicked-overlay">
                    <i className="fas fa-user-slash"></i>
                    <h2>Access Revoked</h2>
                    <p>You have been removed or banned from this group by an administrator.</p>
                    <button className="cm-btn-primary" onClick={onClose}>Return to Hub</button>
                </div>
            )}

            {/* Master UI Alert Catch for Main Chat Window */}
            {alertNotice && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', animation: 'fadeIn 0.2s ease-out' }}>
                    <div style={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', width: '100%', maxWidth: '360px', padding: '1.5rem', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: alertNotice.success ? '#42d7b8' : '#ffab40', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {alertNotice.success ? <i className="fas fa-check-circle"></i> : <i className="fas fa-exclamation-circle"></i>} {alertNotice.title || 'Notice'}
                        </h3>
                        <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>{alertNotice.msg || alertNotice}</p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: 600, fontFamily: 'Poppins, sans-serif', cursor: 'pointer', border: 'none', fontSize: '0.9rem', background: 'var(--accent-teal)', color: '#000' }} onClick={() => setAlertNotice(null)}>Okay</button>
                        </div>
                    </div>
                </div>
            )}

            <ChatSearchOverlay 
                isSearchActive={isSearchActive}
                setIsSearchActive={setIsSearchActive}
                messages={messages}
                scrollToMessage={scrollToMessage}
                formatTime={formatTime}
                resolveSenderName={(senderId) => senderId === currentUser.id ? 'You' : (members[senderId]?.name || 'User')}
            />
            
            {!isSearchActive && (
                <header className="squad-header" style={{ justifyContent: 'flex-start', gap: '1.2rem' }}>
                    <button className="icon-button back-btn" onClick={handleBack}><i className="fas fa-chevron-left"></i></button>
                    <div className="squad-contact-profile" onClick={() => setIsInfoOpen(true)} style={{cursor: 'pointer'}}>
                        <div className="squad-avatar-ring">
                            {localChatInfo.avatar_url && !avatarError ? (
                                <img src={localChatInfo.avatar_url} alt="Squad Avatar" onError={() => setAvatarError(true)} />
                            ) : (
                                <div className="squad-default-avatar"><i className="fas fa-users"></i></div>
                            )}
                        </div>
                        <div className="squad-header-info">
                            <h2>{localChatInfo.title}</h2>
                            {typingUsers.length > 0 ? (
                                <div style={{ color: '#42d7b8', fontSize: '0.75rem' }}>
                                    {typingUsers.length === 1 ? `${members[typingUsers[0]]?.name.split(' ')[0] || 'Someone'} is typing...` : `${typingUsers.length} people are typing...`}
                                </div>
                            ) : (
                            <div className="squad-meta-tags">
                                <span className="squad-badge focus">{localChatInfo.metadata?.focus || 'General'}</span>
                                <span className="squad-badge count"><i className="fas fa-user"></i> {Object.keys(members).length}</span>
                            </div>
                            )}
                        </div>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button className="icon-button" onClick={() => setIsSearchActive(true)}><i className="fas fa-search"></i></button>
                        {showHeaderLiveBtn && (
                            <button 
                                className="header-live-trigger-btn"
                                onClick={handleHeaderLiveClick}
                                disabled={isStartingLive}
                                style={{ background: 'transparent', padding: 0, border: 'none', borderRadius: 0, width: '38px', height: '38px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                                {isStartingLive ? (
                                    <i className="fas fa-circle-notch fa-spin"></i>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style={{ width: '100%', height: '100%', display: 'block' }}>
                                      <defs>
                                        <linearGradient id="header-live-pulse-bg" x1="0%" y1="0%" x2="100%" y2="100%">
                                          <stop offset="0%" stopColor="#0b0f19" />
                                          <stop offset="100%" stopColor="#1e293b" />
                                        </linearGradient>

                                        <linearGradient id="header-neon-cyan-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                                          <stop offset="0%" stopColor="#00f0ff" />
                                          <stop offset="100%" stopColor="#0066ff" />
                                        </linearGradient>

                                        <filter id="header-neon-glow" x="-20%" y="-20%" width="140%" height="140%">
                                          <feGaussianBlur stdDeviation="2.5" result="blur" />
                                          <feMerge>
                                            <feMergeNode in="blur" />
                                            <feMergeNode in="SourceGraphic" />
                                          </feMerge>
                                        </filter>

                                        <filter id="header-red-dot-glow" x="-30%" y="-30%" width="160%" height="160%">
                                          <feGaussianBlur stdDeviation="1.5" result="blur" />
                                          <feMerge>
                                            <feMergeNode in="blur" />
                                            <feMergeNode in="SourceGraphic" />
                                          </feMerge>
                                        </filter>
                                      </defs>

                                      <rect x="2" y="2" width="96" height="96" rx="26" fill="url(#header-live-pulse-bg)" stroke="#1e293b" strokeWidth="2.5" />

                                      <path d="M 22,50 C 22,34.5 34.5,22 50,22 C 65.5,22 78,34.5 78,50 C 78,65.5 65.5,78 50,78 C 45,78 40,76.5 36,74 L 18,78 L 22,64 C 20.7,60 22,55 22,50 Z" 
                                            fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />

                                      <path d="M 16,53 L 34,53 L 41,31 L 48,69 L 54,44 L 59,53 L 84,53" 
                                            fill="none" stroke="#00f0ff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3" filter="url(#header-neon-glow)" />

                                      <path d="M 16,53 L 34,53 L 41,31 L 48,69 L 54,44 L 59,53 L 84,53" 
                                            fill="none" stroke="url(#header-neon-cyan-grad)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />

                                      {isLiveActive && (
                                          <circle cx="35" cy="37" r="3.5" fill="#ef4444" filter="url(#header-red-dot-glow)" />
                                      )}

                                      <text x="57" y="41" fill="#ffffff" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="12" letterSpacing="1" textAnchor="middle">
                                          {isLiveActive ? "LIVE" : "START"}
                                      </text>
                                    </svg>
                                )}
                            </button>
                        )}
                    </div>
                </header>
            )}

            {showLiveBanner && liveState === 'none' && (
                <div className="live-stage-banner" style={{ display: 'flex' }}>
                    <div className="live-banner-left">
                        <div className="pulse-indicator"></div>
                        <div className="live-banner-text">
                            <div>Study Session is Live</div>
                            <div>{localChatInfo.metadata?.live_topic ? `${localChatInfo.metadata.live_topic} • ` : ''}Join stage</div>
                        </div>
                    </div>
                    {isMeHost ? (
                        <button className="join-stage-action-btn" onClick={startLiveSession} disabled={isStartingLive}>
                            {isStartingLive ? <i className="fas fa-circle-notch fa-spin"></i> : 'Resume Stage'}
                        </button>
                    ) : (
                        <button className="join-stage-action-btn" onClick={joinLiveSession} disabled={isStartingLive}>
                            {isStartingLive ? <i className="fas fa-circle-notch fa-spin"></i> : 'Join Stage'}
                        </button>
                    )}
                </div>
            )}
            
            {localChatInfo.metadata?.pinned_message && !isSearchActive && liveState === 'none' && (
                <div className="pinned-msg-banner" onClick={() => scrollToMessage(localChatInfo.metadata.pinned_message.id)}>
                    <div className="pinned-bar"></div>
                    <div className="pinned-info">
                        <div className="pinned-title">Pinned Message</div>
                        <div className="pinned-snippet">
                            <span className="pinned-author">{localChatInfo.metadata.pinned_message.sender_name}:</span>
                            <span className="pinned-text">{localChatInfo.metadata.pinned_message.text}</span>
                        </div>
                    </div>
                    {(myRole === 'owner' || myRole === 'admin') && (
                        <button className="icon-button pinned-close-btn" onClick={(e) => { e.stopPropagation(); handleUnpinMessage(); }} title="Unpin message">
                            <i className="fas fa-times"></i>
                        </button>
                    )}
                </div>
            )}
            
            {showRecoveryModal && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-card">
                        <h3>Active Session Detected</h3>
                        <p>You previously started a live broadcast. Would you like to resume your session or end it?</p>
                        <div className="cm-footer">
                            <button className="cm-btn-danger" onClick={() => endLiveSession(true)} disabled={isStartingLive}>End Session</button>
                            <button className="cm-btn-primary" onClick={() => startLiveSession()} disabled={isStartingLive}>
                                {isStartingLive ? <i className="fas fa-circle-notch fa-spin"></i> : 'Resume'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <LiveStageSetupModal 
                showLiveSetup={showLiveSetup} 
                setShowLiveSetup={setShowLiveSetup} 
                liveSetupData={liveSetupData} 
                setLiveSetupData={setLiveSetupData} 
                startLiveSession={startLiveSession} 
                isStartingLive={isStartingLive} 
            />

            <main className="squad-flow" ref={flowRef} onClick={() => setActiveMenu(null)} onScroll={(e) => {
                setActiveMenu(null);
                const { scrollHeight, scrollTop, clientHeight } = e.currentTarget;
                isAutoScrollEnabled.current = scrollHeight - scrollTop - clientHeight < 250;
            }}>
                {isLoading ? (
                    <div className="squad-loading-state">
                        <i className="fas fa-circle-notch fa-spin"></i>
                        <p>Syncing Squad comms...</p>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="squad-empty-state">
                        <i className="fas fa-user-group"></i>
                        <p>{chat.is_preview && !isMember ? "No messages yet. Join to start the discussion!" : "No messages yet. Start the discussion!"}</p>
                    </div>
                ) : (
                    messages.map(m => {
                        const isMine = m.sender_id === currentUser.id;
                        const isDeletedAccount = !m.sender_id;
                        const sender = isDeletedAccount 
                            ? { name: 'Deleted Account', role: 'member' } 
                            : (members[m.sender_id] || { name: 'Unknown User', role: 'member' });
                        const isMenuOpen = activeMenu?.msg?.id === m.id;
                        
                        const repliedMsg = m.reply_to_id ? messages.find(msg => msg.id === m.reply_to_id) : null;
                        const isMissingReply = m.reply_to_id && !repliedMsg;

                        return (
                            <div 
                                key={m.id} 
                                id={`sq-msg-${m.id}`}
                                className={`squad-msg-group ${isMine ? 'mine' : 'theirs'}`} 
                                style={{ zIndex: isMenuOpen ? 100 : 1 }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (chat.is_preview) return; // Read-only context for preview
                                    if (isMenuOpen) {
                                        setActiveMenu(null);
                                        return;
                                    }
                                    
                                    let x = e.clientX || (e.touches && e.touches[0].clientX);
                                    let y = e.clientY || (e.touches && e.touches[0].clientY);
                                    
                                    if (!x || !y) {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        x = rect.left + rect.width / 2;
                                        y = rect.top + rect.height / 2;
                                    }
                                    
                                    const menuW = 160;
                                    const menuH = 200;
                                    
                                    if (x + menuW > window.innerWidth - 20) x = window.innerWidth - menuW - 20;
                                    if (y + menuH > window.innerHeight - 80) y = window.innerHeight - menuH - 80;
                                    if (y < 80) y = 80;
                                    
                                    setActiveMenu({ msg: m, isMine, x, y });
                                }}
                            >
                                {!isMine && (
                                    <img src={sender.avatar || 'https://via.placeholder.com/150'} alt="Avatar" className="squad-msg-avatar" onClick={(e) => { e.stopPropagation(); if(m.sender_id) onOpenUser(m.sender_id); }} style={{cursor: m.sender_id ? 'pointer' : 'default'}} />
                                )}
                                <div className="squad-bubble-wrapper">
                                    {!isMine && (
                                        <div className="squad-sender-name">
                                            {sender.name}
                                            {sender.role === 'owner' && <i className="fas fa-crown admin-crown"></i>}
                                        </div>
                                    )}
                                    {(() => {
                                        const hasMedia = m.attachments && m.attachments.length > 0;
                                        const isNaked = hasMedia && (!m.text || m.text.trim() === '');
                                        const bubbleClass = `squad-bubble ${hasMedia ? (isNaked ? 'media-bubble naked' : 'media-bubble captioned') : ''}`;
                                        return (
                                    <div className={bubbleClass}>
                                    {m.forward_meta && (
                                        <div className="forward-indicator" onClick={(e) => { e.stopPropagation(); onOriginClick(m.forward_meta); }}>
                                            <div className="forward-bar"></div>
                                            <div className="forward-info">
                                                <span className="forward-label">Forwarded message</span>
                                                <span className="forward-from">
                                                    {m.forward_meta.original_sender_avatar && <img src={m.forward_meta.original_sender_avatar} className="forward-avatar" alt="Avatar"/>}
                                                    {m.forward_meta.original_sender_name}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                    {repliedMsg ? (
                                        <div className="squad-reply-quote" onClick={(e) => { e.stopPropagation(); scrollToMessage(m.reply_to_id); }}>
                                            <div className="sq-quote-content">
                                                <div className="sq-quote-user">
    {!repliedMsg.sender_id ? 'Deleted Account' : (members[repliedMsg.sender_id]?.name || 'Unknown User')}
</div>
                                                <div className="sq-quote-text">{repliedMsg.text}</div>
                                            </div>
                                        </div>
                                    ) : isMissingReply ? (
                                        <div className="squad-reply-quote is-deleted">
                                            <div className="sq-quote-content">
                                                <div className="sq-quote-user">System</div>
                                                <div className="sq-quote-text"><i>Original message deleted</i></div>
                                            </div>
                                        </div>
                                    ) : null}
                                    
                                    {(() => {
                                        if (!m.attachments || m.attachments.length === 0) return null;
                                        
                                        const mediaItems = m.attachments.filter(a => a.type.startsWith('image/') || a.type.startsWith('video/'));
                                        const docItems = m.attachments.filter(a => !a.type.startsWith('image/') && !a.type.startsWith('video/'));
                                        const hasMoreMedia = mediaItems.length > 5;
                                        const displayMedia = mediaItems.slice(0, 5);

                                        return (
                                            <>
                                                {displayMedia.length > 0 && (
                                                    <div className="media-gallery-grid" data-count={displayMedia.length} data-more={hasMoreMedia.toString()}>
                                                        {displayMedia.map((att, i) => {
                                                            const isLast = i === 4;
                                                            return (
                                                                <div key={i} className="gallery-item" onClick={(e) => { 
                                                                    e.stopPropagation(); 
                                                                    setFullscreenGallery({ items: mediaItems, index: i });
                                                                }}>
                                                                    {att.type.startsWith('video/') ? (
                                                                        <video src={att.url} />
                                                                    ) : (
                                                                        <img src={att.url} alt="Shared Image" />
                                                                    )}
                                                                    {isLast && hasMoreMedia && (
                                                                        <div className="gallery-more-overlay" data-more-count={(mediaItems.length - 5).toString()}></div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                
                                                {docItems.map((att, i) => {
                                                    const iconData = getFileIconProps(att.name);
                                                    return (
                                                    <div key={i} className="bubble-attachment" style={{marginTop: i === 0 && displayMedia.length === 0 ? '0' : '4px'}}>
                                                        <div className="bubble-file-box" onClick={(e) => { e.stopPropagation(); handleDownload(att.url, att.name); }}>
                                                            <div className="bubble-file-icon" style={{color: iconData.color}}><i className={`fas ${iconData.icon}`}></i></div>
                                                            <div className="bubble-file-info">
                                                                <span className="bubble-file-name">{att.name}</span>
                                                                <span style={{fontSize: '0.65rem', color: '#888'}}>{(att.size / 1024 / 1024).toFixed(2)} MB</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )})}
                                            </>
                                        );
                                    })()}

                                    {m.text && <div className="bubble-text-content">{m.text}</div>}
                                    
                                    <div className={`squad-time-meta ${isMine ? 'mine-meta' : ''}`}>
                                        {m.is_edited && <span>edited</span>}
                                        {formatTime(m.created_at)}
                                        {isMine && (
                                            m.status === 'pending' ? <i className="fa-solid fa-clock" style={{fontSize: '0.6rem'}}></i> : 
                                            m.status === 'failed' ? <i className="fa-solid fa-circle-exclamation" style={{color: '#ff5f5f', fontSize: '0.7rem'}} title="Message Failed"></i> : 
                                            <i className="fa-solid fa-check"></i>
                                        )}
                                    </div>
                                </div>
                                    );
                                })()}
                                </div>
                            </div>
                        );
                    })
                )}
            </main>

            {activeMenu && (
                <div className="squad-ctx-menu" style={{ left: activeMenu.x, top: activeMenu.y }}>
                    {!activeMenu.isMine && (
                        <button className="squad-ctx-btn" onClick={() => startReply(activeMenu.msg)}>
                            <i className="fa-solid fa-reply"></i> Reply
                        </button>
                    )}
                    {activeMenu.msg.text && (
                        <button className="squad-ctx-btn" onClick={() => handleCopy(activeMenu.msg.text)}>
                            <i className="fa-solid fa-copy"></i> Copy Text
                        </button>
                    )}
                    {chat.metadata?.privacy !== 'private' && activeMenu.msg.attachments && activeMenu.msg.attachments.length > 0 && (
                        <button className="squad-ctx-btn" onClick={() => {
                            if (activeMenu.msg.attachments.length > 1) {
                                if(window.confirm(`Download all ${activeMenu.msg.attachments.length} files?`)) {
                                    handleDownloadAll(activeMenu.msg.attachments);
                                }
                            } else {
                                handleDownload(activeMenu.msg.attachments[0].url, activeMenu.msg.attachments[0].name);
                            }
                        }}>
                            <i className="fa-solid fa-download"></i> {activeMenu.msg.attachments.length > 1 ? 'Download All Files' : 'Download File'}
                        </button>
                    )}
                    {(!chat.metadata || chat.metadata.privacy !== 'private') && (
                        <button className="squad-ctx-btn" onClick={() => { 
                            onForward({
                                ...activeMenu.msg, 
                                resolved_sender_name: activeMenu.isMine ? userProfile?.full_name : members[activeMenu.msg.sender_id]?.name || 'Unknown',
                                resolved_sender_avatar: activeMenu.isMine ? userProfile?.avatar_url : members[activeMenu.msg.sender_id]?.avatar || ''
                            }); 
                            setActiveMenu(null); 
                        }}>
                            <i className="fa-solid fa-share"></i> Forward
                        </button>
                    )}
                    {activeMenu.isMine && (
                        <button className="squad-ctx-btn" onClick={() => startEditing(activeMenu.msg)}>
                            <i className="fa-solid fa-pen"></i> Edit
                        </button>
                    )}
                    {(myRole === 'owner' || myRole === 'admin') && (
                        <button className="squad-ctx-btn" onClick={() => handlePinMessage(activeMenu.msg)}>
                            <i className="fa-solid fa-thumbtack"></i> Pin
                        </button>
                    )}
                    {(activeMenu.isMine || myRole === 'owner' || myRole === 'admin') && (
                        <button className="squad-ctx-btn delete" onClick={() => { setDeleteConfirm(activeMenu.msg.id); setActiveMenu(null); }}>
                            <i className="fa-solid fa-trash"></i> {activeMenu.isMine ? 'Delete' : 'Admin Delete'}
                        </button>
                    )}
                </div>
            )}

            <footer className="squad-input-area" style={{ padding: '0 1.5rem calc(1rem + env(safe-area-inset-bottom))', background: 'linear-gradient(to top, #08080c 80%, transparent)' }}>
                {chat.is_preview && !isMember ? (
                    <button className="squad-join-full-btn" onClick={() => onJoin(chat.conversation_id)} disabled={isJoining}>
                        {isJoining ? <i className="fas fa-circle-notch fa-spin"></i> : 'Join Squad'}
                    </button>
                ) : (
                    <>
                        {editingMessage && (
                            <div className="squad-input-mode-header edit-mode">
                                <div className="mode-border"></div>
                                <div className="squad-mode-icon"><i className="fa-solid fa-pen"></i></div>
                                <div className="mode-info">
                                    <span className="mode-user">Editing message</span>
                                    <span className="mode-text">{editingMessage.text}</span>
                                </div>
                                <button className="icon-button" onClick={() => { setEditingMessage(null); setInput(''); }}>
                                    <i className="fa-solid fa-times"></i>
                                </button>
                            </div>
                        )}
                        {replyingTo && (
                            <div className="squad-input-mode-header">
                                <div className="mode-border"></div>
                                <div className="mode-info" onClick={() => scrollToMessage(replyingTo.id)}>
                                    <span className="mode-user">
            Replying to {!replyingTo.sender_id ? 'Deleted Account' : (members[replyingTo.sender_id]?.name || 'Unknown User')}
        </span>
                                    <span className="mode-text">{replyingTo.text}</span>
                                </div>
                                <button className="icon-button" onClick={() => setReplyingTo(null)}>
                                    <i className="fa-solid fa-times"></i>
                                </button>
                            </div>
                        )}
                        {pendingAttachments.length > 0 && (
                            <div className="squad-input-mode-header staging-mode">
                                <div className="mode-border staging-preview-border"></div>
                                <div className="staging-preview-content" style={{ overflowX: 'auto', display: 'flex', gap: '8px' }}>
                                    {pendingAttachments.map((pa, idx) => {
                                        const iconData = getFileIconProps(pa.file.name);
                                        return (
                                        <div key={idx} style={{ position: 'relative', flexShrink: 0 }}>
                                            {pa.previewUrl ? (
                                                <img src={pa.previewUrl} alt="Preview" className="staging-thumb" />
                                            ) : (
                                                <div className="staging-file-icon" style={{color: iconData.color}}><i className={`fas ${iconData.icon}`}></i></div>
                                            )}
                                            <button 
                                                className="icon-button" 
                                                style={{ position: 'absolute', top: '-6px', right: '-6px', background: 'rgba(0,0,0,0.8)', width: '20px', height: '20px', fontSize: '0.6rem', border: '1px solid rgba(255,255,255,0.2)' }} 
                                                onClick={() => setPendingAttachments(p => p.filter((_, i) => i !== idx))}
                                            >
                                                <i className="fa-solid fa-times"></i>
                                            </button>
                                        </div>
                                    )})}
                                </div>
                                <button className="icon-button" onClick={() => setPendingAttachments([])} style={{color: '#ff5f5f', background: 'rgba(255,95,95,0.1)', width: '30px', height: '30px', flexShrink: 0}}>
                                    <i className="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        )}
                        {myMutedUntil && new Date(myMutedUntil) > new Date() ? (
                            <div className="squad-muted-notice">
                                <i className="fas fa-microphone-slash"></i>
                                {new Date(myMutedUntil).getFullYear() > 2100 ? "You have been permanently restricted from posting." : `You are restricted from posting until ${new Date(myMutedUntil).toLocaleString()}.`}
                            </div>
                        ) : !canPost ? (
                            <div className="squad-muted-notice" style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#aaa', justifyContent: 'center' }}>
                                <i className="fas fa-lock"></i> Only admins can send messages right now.
                            </div>
                        ) : (
                            <div className="squad-dock">
                                <input 
                                    type="file" 
                                    ref={fileInputRef} 
                                    style={{display: 'none'}} 
                                    onChange={handleFileSelect} 
                                />
                                <button className="add-btn" onClick={() => fileInputRef.current.click()} disabled={isUploading}>
                                    <i className="fa-solid fa-paperclip"></i>
                                </button>
                                <input 
                                    type="text" 
                                    placeholder="Squad message..." 
                                    disabled={isUploading}
                                    value={input}
                                    onChange={(e) => handleInputChange(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                                />
                                {isUploading ? (
                                    <div className="circular-progress-btn">
                                        <svg viewBox="0 0 36 36">
                                            <path className="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                            <path className="circle-fill" strokeDasharray={`${uploadProgress}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                        </svg>
                                        <span className="prog-text">{uploadProgress}%</span>
                                    </div>
                                ) : (
                                    <button className="squad-send-btn" onClick={handleSend} disabled={!input.trim() && pendingAttachments.length === 0}>
                                        <i className={`fa-solid ${editingMessage ? 'fa-check' : 'fa-arrow-up'}`}></i>
                                    </button>
                                )}
                            </div>
                        )}
                    </>
                )}
            </footer>

            {/* Admin Quick Settings Modal */}
            {showAdminSettings && (
                <div className="custom-modal-overlay" onClick={() => setShowAdminSettings(false)}>
                    <div className="custom-modal-card" onClick={e => e.stopPropagation()}>
                        <h3 style={{marginBottom: '1.5rem'}}><i className="fas fa-key" style={{color: 'var(--accent-teal)', marginRight: '8px'}}></i> Admin Controls</h3>
                        
                        <div className="cm-privacy-options">
                            <div className="si-settings-row" style={{marginBottom: '10px'}} onClick={() => toggleAdminSetting('members_can_add', localChatInfo.metadata?.members_can_add)}>
                                <div className="sr-info">
                                    <h4 style={{fontSize: '0.95rem'}}>Members can add members</h4>
                                    <p style={{fontSize: '0.8rem'}}>Allow everyone to invite others</p>
                                </div>
                                <div className="sr-val">
                                    <div className={`toggle-switch ${(localChatInfo.metadata?.members_can_add !== false) ? 'on' : 'off'}`}></div>
                                </div>
                            </div>

                            <div className="si-settings-row" style={{marginBottom: '10px'}} onClick={() => toggleAdminSetting('members_can_post', localChatInfo.metadata?.members_can_post)}>
                                <div className="sr-info">
                                    <h4 style={{fontSize: '0.95rem'}}>Members can post</h4>
                                    <p style={{fontSize: '0.8rem'}}>Allow everyone to send messages</p>
                                </div>
                                <div className="sr-val">
                                    <div className={`toggle-switch ${(localChatInfo.metadata?.members_can_post !== false) ? 'on' : 'off'}`}></div>
                                </div>
                            </div>
                            
                            <div className="si-settings-row" style={{marginBottom: '0'}} onClick={() => toggleAdminSetting('hide_members', localChatInfo.metadata?.hide_members)}>
                                <div className="sr-info">
                                    <h4 style={{fontSize: '0.95rem'}}>Hide member list</h4>
                                    <p style={{fontSize: '0.8rem'}}>Only owners can view the directory</p>
                                </div>
                                <div className="sr-val">
                                    <div className={`toggle-switch ${(localChatInfo.metadata?.hide_members === true) ? 'on' : 'off'}`}></div>
                                </div>
                            </div>
                        </div>
                        
                        <div className="cm-footer" style={{marginTop: '2rem'}}>
                            <button className="cm-btn-primary" style={{width: '100%'}} onClick={() => setShowAdminSettings(false)}>Done</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Generic Message Delete Confirm Modal */}
            {deleteConfirm && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-card">
                        <h3>Delete Message</h3>
                        <p>Are you sure you want to permanently delete this message for everyone?</p>
                        <div className="cm-footer">
                            <button className="cm-btn-cancel" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                            <button className="cm-btn-danger" onClick={confirmAndDelete}>Purge Message</button>
                        </div>
                    </div>
                </div>
            )}

            
            {isInfoOpen && (
                <GroupInfoPanel 
                    chatInfo={localChatInfo}
                    conversationId={chat.conversation_id}
                    currentUser={currentUser}
                    members={members}
                    setMembers={setMembers}
                    messages={messages}
                    myRole={myRole}
                    onClose={() => setIsInfoOpen(false)}
                    onUpdateInfo={setLocalChatInfo}
                    onDisband={onClose}
                    onOpenAdminSettings={() => setShowAdminSettings(true)}
                    onOpenUser={onOpenUser}
                />
            )}
            <FullscreenMediaGallery 
                fullscreenGallery={fullscreenGallery} 
                setFullscreenGallery={setFullscreenGallery} 
            />

        </div>
        
        {/* React Portal escapes the Hidden Window boundary to float across the entire app */}
        {liveState !== 'none' && liveCredentials && createPortal(
            <LiveKitRoom
                serverUrl={liveCredentials.url}
                token={liveCredentials.token}
                connect={true}
                audio={false}
                video={false}
                options={{
                    webAudioMix: true,
                    publishDefaults: {
                        audioBitrate: 48000,
                        dtx: true
                    }
                }}
            >
                <LiveStageContent 
                    conversationId={chat.conversation_id}
                    chatInfo={localChatInfo}
                    members={members}
                    liveState={liveState}
                    setLiveState={setLiveState}
                    onLeave={endLiveSession}
                    currentUser={currentUser}
                />
                <RoomAudioRenderer />
            </LiveKitRoom>,
            document.body
        )}
        </>
    );
};
export default GroupChat;