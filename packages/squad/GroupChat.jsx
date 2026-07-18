import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';

import LiveStageSetupModal from './components/LiveStageSetupModal.jsx';
import ChatSearchOverlay from './components/ChatSearchOverlay.jsx';
import FullscreenMediaGallery from './components/FullscreenMediaGallery.jsx';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import AdminSettingsModal from './components/AdminSettingsModal.jsx';
import GenericConfirmModal from './components/GenericConfirmModal.jsx';
import LiveRecoveryModal from './components/LiveRecoveryModal.jsx';
import { invokeSocial, uploadChatMedia } from './api.js';
import { useChatInputState } from './hooks/useChatInputState.js';
import { useLiveStageSession } from './hooks/useLiveStageSession.js';
import './GroupChat.css';
import FloatingLiveOrb from './components/FloatingLiveOrb.jsx';
import ConnectionRing from './components/ConnectionRing.jsx';
import GroupInfoPanel from './components/GroupInfoPanel.jsx';
import LiveStageContent from './components/LiveStageContent.jsx';
import MessageContextMenu from './components/MessageContextMenu.jsx';
import ChatInputDock from './components/ChatInputDock.jsx';
import ChatBubble from './components/ChatBubble.jsx';





const GroupChat = ({ chat, currentUser, isHidden, targetMessageId, onClose, onMinimize, onJoin, isJoining, onForward, onOriginClick, onOpenUser, onlineUsers, presenceSynced }) => {
    const { user: userProfile } = usePlatform();
    const [messages, setMessages] = useState([]);
    const [members, setMembers] = useState({});
    const [myRole, setMyRole] = useState('member');
    const [activeMenu, setActiveMenu] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [editingMessage, setEditingMessage] = useState(null);
    const [replyingTo, setReplyingTo] = useState(null);
    const [fullscreenGallery, setFullscreenGallery] = useState(null);
    const fileInputRef = useRef(null);

    const [alertNotice, setAlertNotice] = useState(null); // Parent Error Trapper
    const [typingUsers, setTypingUsers] = useState([]);
    
    // Group Hub State
    const [localChatInfo, setLocalChatInfo] = useState({ title: chat.title, avatar_url: chat.avatar_url, metadata: chat.metadata });
    const [isInfoOpen, setIsInfoOpen] = useState(false);
    const [showMironSetup, setShowMironSetup] = useState(false);
    const [devBoardPayload, setDevBoardPayload] = useState(null);
    const [autoTriggerLinkFlow, setAutoTriggerLinkFlow] = useState(false);
    
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
    const [stopPollConfirm, setStopPollConfirm] = useState(null); // ID of poll message to stop
    const [downloadConfirm, setDownloadConfirm] = useState(null); // Attachments array
    const [kickedNotice, setKickedNotice] = useState(false);
    const [avatarError, setAvatarError] = useState(false);
    const [showAdminSettings, setShowAdminSettings] = useState(false);

    // Reset header avatar error state if URL changes
    useEffect(() => setAvatarError(false), [localChatInfo.avatar_url]);

    const toggleAdminSetting = async (key, currentVal) => {
        let defaultVal = false;
        if (key === 'members_can_post' || key === 'members_can_add' || key === 'members_can_poll') defaultVal = true;
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
    const isMemberSafe = !!members[currentUser.id]?.is_current_member;
    const canPost = isMemberSafe && (myRole === 'owner' || myRole === 'admin' || membersCanPost);

    // Search State
    const [isSearchActive, setIsSearchActive] = useState(false);

    const flowRef = useRef(null);
    const channelRef = useRef(null);
    const isAutoScrollEnabled = useRef(true);

    const {
        input, setInput, pendingAttachments, setPendingAttachments,
        isUploading, setIsUploading, uploadProgress, setUploadProgress,
        handleInputChange, handleFileSelect, clearTypingPresence
    } = useChatInputState(channelRef, setAlertNotice);

    const heartBeatTime = localChatInfo.metadata?.live_heartbeat ? new Date(localChatInfo.metadata.live_heartbeat).getTime() : Date.now(); 
    const isHostOnline = localChatInfo.metadata?.ai_hosting || (currentUser.id === localChatInfo.metadata?.live_host_id) || (onlineUsers && onlineUsers.has(localChatInfo.metadata?.live_host_id));
    const isLiveDead = (Date.now() - heartBeatTime) > 5 * 60 * 1000 || (presenceSynced && !localChatInfo.metadata?.ai_hosting && !isHostOnline);
    const isLiveActive = localChatInfo.metadata?.is_live && !isLiveDead;
    const isMeHost = localChatInfo.metadata?.live_host_id === currentUser.id;
    const showLiveBanner = isLiveActive;

    const {
        liveState, setLiveState, liveCredentials, setLiveCredentials,
        showLiveSetup, setShowLiveSetup, liveSetupData, setLiveSetupData,
        isStartingLive, showRecoveryModal, pendingChunks,
        startLiveSession, joinLiveSession, endLiveSession
    } = useLiveStageSession({ chat, localChatInfo, setLocalChatInfo, currentUser, isMeHost, isLiveDead, setAlertNotice });

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
                    
                    if (uid === currentUser.id) {
                        if (memData) {
                            setMyRole(memData.role);
                            setMyMutedUntil(memData.muted_until);
                        } else {
                            setMyRole(null);
                        }
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
    


    const handleSend = async (overrideData = null) => {
        const isEvent = overrideData && typeof overrideData.preventDefault === 'function';
        const actualData = isEvent ? null : overrideData;

        if (!actualData && (!input.trim() && pendingAttachments.length === 0) && !isUploading) return;
        
        clearTypingPresence();

        const msgText = actualData ? actualData.text : input;
        const currentAttachments = actualData ? (actualData.attachments || []) : [...pendingAttachments];
        
        setInput('');
        setPendingAttachments([]);

        if (editingMessage) {
            setMessages(prev => prev.map(m => m.id === editingMessage.id ? { ...m, text: msgText, attachments: currentAttachments, is_edited: true } : m));
            await supabase.from('messages').update({ text: msgText, attachments: currentAttachments, is_edited: true }).eq('id', editingMessage.id);
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
            attachments: currentAttachments.map(a => a.file ? { name: a.file.name, type: a.file.type, url: a.previewUrl || '' } : a),
            created_at: new Date().toISOString(), status: 'pending'
        }]);

        let finalAttachments = [];

        if (currentAttachments.length > 0) {
            setIsUploading(true);
            setUploadProgress(0);
            const totalFiles = currentAttachments.length;
            let completedFiles = 0;

            for (const att of currentAttachments) {
                if (!att.file) {
                    finalAttachments.push(att);
                    continue;
                }
                try {
                    const file = att.file;
                    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    const filePath = `groups/${chat.conversation_id}/${currentUser.id}/${Date.now()}_${safeName}`;
                    
                    const publicUrl = await uploadChatMedia(file, filePath, (fileProg) => {
                        const globalProg = Math.round(((completedFiles + fileProg) / totalFiles) * 100);
                        setUploadProgress(globalProg);
                    });
                    
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
            if (finalAttachments.length > 0 && Array.isArray(data.attachments)) {
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

    const executeStopPoll = async () => {
        if (!stopPollConfirm) return;
        const msgId = stopPollConfirm;
        setStopPollConfirm(null);

        const targetMsg = messages.find(m => m.id === msgId);
        if (!targetMsg) return;

        const updatedAttachments = targetMsg.attachments.map(a => {
            if (a.type === 'poll') {
                return { ...a, poll_data: { ...a.poll_data, is_stopped: true } };
            }
            return a;
        });

        // Optimistic UI
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, attachments: updatedAttachments } : m));
        await supabase.from('messages').update({ attachments: updatedAttachments }).eq('id', msgId);
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

    const handleDownload = async (url, filename) => {
        setActiveMenu(null);
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Network response was not ok');
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename || 'download';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        } catch (e) {
            // Failsafe strictly using target blank to prevent routing crash
            const link = document.createElement('a');
            link.href = `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(filename)}`;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const confirmAndDownloadAll = () => {
        if (!downloadConfirm) return;
        const attachments = downloadConfirm;
        setDownloadConfirm(null);
        attachments.forEach((att, index) => {
            setTimeout(() => {
                handleDownload(att.url, att.name);
            }, index * 400);
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
        const isPoll = msg.attachments?.some(a => a.type === 'poll');
        const pinText = msg.text || (isPoll ? '📊 Poll' : (msg.attachments?.length > 0 ? '📎 Attachment' : 'Message'));
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
        return new Date(isoString).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    };

    const isMember = !!members[currentUser.id]?.is_current_member;

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
                    <div style={{ background: 'var(--surface-dark)', border: '1px solid var(--border-color)', borderRadius: '20px', width: '100%', maxWidth: '360px', padding: '1.5rem', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: alertNotice.success ? '#42d7b8' : '#ffab40', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {alertNotice.success ? <i className="fas fa-check-circle"></i> : <i className="fas fa-exclamation-circle"></i>} {alertNotice.title || 'Notice'}
                        </h3>
                        <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>{typeof alertNotice === 'string' ? alertNotice : alertNotice.msg}</p>
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
            
            {isMember && localChatInfo.metadata?.focus === 'Class' && userProfile?.class_id !== chat.conversation_id && !isSearchActive && liveState === 'none' && (
                <div className="pinned-msg-banner" style={{background: 'rgba(66, 215, 184, 0.1)', borderBottom: '1px solid rgba(66, 215, 184, 0.3)', cursor: 'default'}}>
                    <div className="pinned-bar"></div>
                    <div className="pinned-info">
                        <div className="pinned-title" style={{color: '#fff', fontSize: '0.85rem'}}>Unlinked Class</div>
                        <div className="pinned-snippet" style={{color: '#aaa', whiteSpace: 'normal', lineHeight: 1.3}}>
                            Link this as your official class group to track deadlines and exams?
                        </div>
                    </div>
                    <div className="toggle-switch off" style={{ flexShrink: 0, marginLeft: '12px' }} onClick={() => {
                        setAutoTriggerLinkFlow(true);
                        setIsInfoOpen(true);
                    }}></div>
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
                <LiveRecoveryModal
                    onEnd={() => endLiveSession(true)}
                    onResume={() => startLiveSession()}
                    isStartingLive={isStartingLive}
                />
            )}

            <LiveStageSetupModal 
                mode="host"
                show={showLiveSetup} 
                conversation_id={chat.conversation_id}
                onClose={() => setShowLiveSetup(false)} 
                liveSetupData={liveSetupData} 
                setLiveSetupData={setLiveSetupData} 
                onStartLive={startLiveSession} 
                isStartingLive={isStartingLive} 
                onDevInject={(payload) => {
                    setLiveCredentials({ token: 'local', url: 'local' });
                    setDevBoardPayload(payload);
                    setLiveState('full');
                    setShowLiveSetup(false);
                }}
            />

            <LiveStageSetupModal 
                mode="miron"
                show={showMironSetup}
                conversation_id={chat.conversation_id}
                onClose={() => setShowMironSetup(false)}
                onDevInject={(payload) => {
                    setDevBoardPayload(payload);
                    setLiveState('full');
                    setShowMironSetup(false);
                }}
                onInviteMiron={async (chunks, rawText) => {
                    const { error } = await supabase.from('live_study_sessions')
                        .update({ lecture_chunks: chunks, raw_source_text: rawText })
                        .eq('conversation_id', chat.conversation_id);
                    if (error) {
                        setAlertNotice({ title: 'Failed to update chunks', msg: error.message, success: false });
                        return;
                    }
                    try {
                        const res = await invokeSocial({ action: 'toggle_miron', conversation_id: chat.conversation_id, ai_hosting: true });
                        if (res.error) throw new Error(res.error);
                        setLocalChatInfo(prev => ({...prev, metadata: res.metadata || {...prev.metadata, ai_hosting: true}}));
                    } catch(e) {
                        console.error("Failed to toggle Miron:", e.message);
                        setAlertNotice({ title: 'Miron failed to join', msg: e.message, success: false });
                    }
                }}
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
                        
                        const repliedMsg = m.reply_to_id ? messages.find(msg => msg.id === m.reply_to_id) : null;
                        const isMissingReply = m.reply_to_id && !repliedMsg;
                        const resolvedReplyName = !repliedMsg?.sender_id ? 'Deleted Account' : (members[repliedMsg.sender_id]?.name || 'Unknown User');

                        return (
                            <ChatBubble 
                                key={m.id}
                                currentUser={currentUser}
                                msg={m}
                                isMine={isMine}
                                isGroup={true}
                                sender={sender}
                                isPreview={chat.is_preview}
                                activeMenu={activeMenu}
                                setActiveMenu={setActiveMenu}
                                onOriginClick={onOriginClick}
                                onOpenUser={onOpenUser}
                                scrollToMessage={scrollToMessage}
                                formatTime={formatTime}
                                setFullscreenGallery={setFullscreenGallery}
                                handleDownload={handleDownload}
                                repliedMsg={repliedMsg}
                                isMissingReply={isMissingReply}
                                resolvedReplyName={resolvedReplyName}
                            />
                        );
                    })
                )}
            </main>

                            <MessageContextMenu 
                activeMenu={activeMenu}
                onClose={() => setActiveMenu(null)}
                onReply={startReply}
                onCopy={handleCopy}
                onDownload={handleDownload}
                onDownloadAllRequest={(attachments) => setDownloadConfirm(attachments)}
                onForward={(msg) => {
                    onForward({
                        ...msg, 
                        resolved_sender_name: msg.sender_id === currentUser.id ? userProfile?.full_name : members[msg.sender_id]?.name || 'Unknown',
                        resolved_sender_avatar: msg.sender_id === currentUser.id ? userProfile?.avatar_url : members[msg.sender_id]?.avatar || ''
                    });
                }}
                onEdit={startEditing}
                onPin={handlePinMessage}
                onDeleteRequest={(id, isStopPoll) => {
                    if (isStopPoll) setStopPollConfirm(id);
                    else setDeleteConfirm(id);
                }}
                canDownload={!chat.metadata || chat.metadata.privacy !== 'private'}
                canForward={!chat.metadata || chat.metadata.privacy !== 'private'}
                canPin={myRole === 'owner' || myRole === 'admin'}
                canDeleteAny={myRole === 'owner' || myRole === 'admin'}
            />

            {chat.is_preview && !isMember ? (
                <div style={{ padding: '0 1.5rem calc(1rem + env(safe-area-inset-bottom))', background: 'linear-gradient(to top, #08080c 80%, transparent)' }}>
                    <button className="squad-join-full-btn" onClick={() => onJoin(chat.conversation_id)} disabled={isJoining}>
                        {isJoining ? <i className="fas fa-circle-notch fa-spin"></i> : 'Join Squad'}
                    </button>
                </div>
            ) : (
                            <ChatInputDock
                canPoll={myRole === 'owner' || myRole === 'admin' || localChatInfo.metadata?.members_can_poll !== false}
                editingMessage={editingMessage}
                    setEditingMessage={setEditingMessage}
                    replyingTo={replyingTo}
                    setReplyingTo={setReplyingTo}
                    scrollToMessage={scrollToMessage}
                    resolveReplyUser={(id) => !id ? 'Deleted Account' : (members[id]?.name || 'Unknown User')}
                    pendingAttachments={pendingAttachments}
                    setPendingAttachments={setPendingAttachments}
                    isUploading={isUploading}
                    uploadProgress={uploadProgress}
                    fileInputRef={fileInputRef}
                    input={input}
                    setInput={setInput}
                    handleInputChange={handleInputChange}
                    handleSend={handleSend}
                    handleFileSelect={handleFileSelect}
                    restrictedNotice={
                        myMutedUntil && new Date(myMutedUntil) > new Date() ? (
                            <div className="squad-muted-notice">
                                <i className="fas fa-microphone-slash"></i>
                                {new Date(myMutedUntil).getFullYear() > 2100 ? "You have been permanently restricted from posting." : `You are restricted from posting until ${new Date(myMutedUntil).toLocaleString()}.`}
                            </div>
                        ) : !canPost ? (
                            <div className="squad-muted-notice" style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#aaa', justifyContent: 'center' }}>
                                <i className="fas fa-lock"></i> Only admins can send messages right now.
                            </div>
                        ) : null
                    }
                />
            )}

            {showAdminSettings && (
                <AdminSettingsModal 
                    localChatInfo={localChatInfo} 
                    toggleAdminSetting={toggleAdminSetting} 
                    onClose={() => setShowAdminSettings(false)} 
                />
            )}

            {stopPollConfirm && (
                <GenericConfirmModal
                    title="Stop Poll"
                    description="Are you sure you want to stop this poll? This action is irreversible and the poll will no longer accept votes."
                    onConfirm={executeStopPoll}
                    onCancel={() => setStopPollConfirm(null)}
                    confirmText="Stop Poll"
                    isDanger={true}
                />
            )}

            {deleteConfirm && (
                <GenericConfirmModal
                    title="Delete Message"
                    description="Are you sure you want to permanently delete this message for everyone?"
                    onConfirm={confirmAndDelete}
                    onCancel={() => setDeleteConfirm(null)}
                    confirmText="Purge Message"
                    isDanger={true}
                />
            )}

            {downloadConfirm && (
                <GenericConfirmModal
                    title="Bulk Download"
                    description={`You are about to securely download ${downloadConfirm.length} files to your device.`}
                    onConfirm={confirmAndDownloadAll}
                    onCancel={() => setDownloadConfirm(null)}
                    confirmText="Download All"
                    isDanger={false}
                />
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
                    autoTriggerLinkFlow={autoTriggerLinkFlow}
                    setAutoTriggerLinkFlow={setAutoTriggerLinkFlow}
                />
            )}
            <FullscreenMediaGallery 
                fullscreenGallery={fullscreenGallery} 
                setFullscreenGallery={setFullscreenGallery} 
            />

        </div>
        
        {liveState !== 'none' && liveCredentials && createPortal(
            <div style={{ position: 'fixed', inset: 0, zIndex: 99999, pointerEvents: liveState === 'minimized' ? 'none' : 'auto' }}>
                <LiveKitRoom
                    serverUrl={liveCredentials.url}
                    token={liveCredentials.token}
                    connect={liveCredentials.url !== 'local'}
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
                        pendingChunks={pendingChunks}
                        setShowMironSetup={setShowMironSetup}
                        devBoardPayload={devBoardPayload}
                        setDevBoardPayload={setDevBoardPayload}
                    />
                    <RoomAudioRenderer />
                </LiveKitRoom>
            </div>,
            document.body
        )}
        </>
    );
};
export default GroupChat;