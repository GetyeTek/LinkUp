import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import ChatSearchOverlay from './components/ChatSearchOverlay.jsx';
import MessageContextMenu from './components/MessageContextMenu.jsx';
import ChatInputDock from './components/ChatInputDock.jsx';
import ChatBubble from './components/ChatBubble.jsx';
import FullscreenMediaGallery from './components/FullscreenMediaGallery.jsx';
import GenericConfirmModal from './components/GenericConfirmModal.jsx';
import { uploadChatMedia } from './api.js';
import { useChatInputState } from './hooks/useChatInputState.js';
import './UserChat.css';

const UserChat = ({ chat, currentUser, isHidden, isOnline, targetMessageId, onClose, onForward, onOriginClick, onOpenUser }) => {
    const { user: userProfile } = usePlatform();
    const [activeConvId, setActiveConvId] = useState(chat.conversation_id);
    const [messages, setMessages] = useState([]);
    const [otherReadAt, setOtherReadAt] = useState(null);
    const [isOtherTyping, setIsOtherTyping] = useState(false);
    const [activeMenu, setActiveMenu] = useState(null);
    const [editingMessage, setEditingMessage] = useState(null);
    const [replyingTo, setReplyingTo] = useState(null);
    const [fullscreenGallery, setFullscreenGallery] = useState(null);
    const [alertNotice, setAlertNotice] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const [stopPollConfirm, setStopPollConfirm] = useState(null);
    const [downloadConfirm, setDownloadConfirm] = useState(null);
    
    // Search State
    const [isSearchActive, setIsSearchActive] = useState(false);
    
    const fileInputRef = useRef(null);
    const flowRef = useRef(null);
    const isAutoScrollEnabled = useRef(true);
    const roomChannelRef = useRef(null);

    const {
        input, setInput, pendingAttachments, setPendingAttachments,
        isUploading, setIsUploading, uploadProgress, setUploadProgress,
        handleInputChange, handleFileSelect, clearTypingPresence
    } = useChatInputState(roomChannelRef, setAlertNotice);

    const isOtherUserDeleted = chat.type === 'dm' && !chat.other_user_id;
    const chatTitle = isOtherUserDeleted ? 'Deleted Account' : (chat.type === 'dm' ? chat.other_user_name : chat.title);
    const chatAvatar = isOtherUserDeleted ? null : (chat.type === 'dm' ? chat.other_user_avatar : chat.avatar_url);

    const formatLastSeen = (dateStr) => {
        if (!dateStr) return 'Offline';
        const date = new Date(dateStr);
        const now = new Date();
        const diffInMs = now - date;
        const diffInMins = Math.floor(diffInMs / 60000);
        const diffInHours = Math.floor(diffInMs / 3600000);

        if (diffInMins < 1) return 'last seen just now';
        if (diffInMins < 60) return `last seen ${diffInMins}m ago`;
        if (diffInHours < 24) return `last seen ${diffInHours}h ago`;
        return `last seen ${date.toLocaleDateString()}`;
    };

    useEffect(() => {
        if (!activeConvId) return;

        fetchMessages();
        fetchOtherReadReceipt();
        markAsRead();

        const channel = supabase.channel(`room_${activeConvId}`, {
            config: { presence: { key: currentUser.id } }
        });

        roomChannelRef.current = channel;

        channel
            .on('postgres_changes', { 
                event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeConvId}`
            }, (payload) => {
                if (payload.eventType === 'INSERT') {
                    setMessages(prev => {
                        if (prev.find(m => m.id === payload.new.id)) return prev;
                        return [...prev, { ...payload.new, status: 'sent' }];
                    });
                    markAsRead(); // Unconditionally mark as read to clear badges
                } else if (payload.eventType === 'UPDATE') {
                    setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...payload.new, status: 'sent' } : m));
                } else if (payload.eventType === 'DELETE') {
                    setMessages(prev => prev.filter(m => m.id !== payload.old.id));
                }
            })
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                const otherUserPresence = state[chat.other_user_id] || [];
                
                // TIME-RESOLVED ARCHITECTURE: Find the absolute latest presence state across all ghost tabs
                let latestPresence = null;
                otherUserPresence.forEach(p => {
                    if (!latestPresence || (p.updatedAt || 0) > (latestPresence.updatedAt || 0)) {
                        latestPresence = p;
                    }
                });
                
                const isTypingNow = latestPresence ? !!latestPresence.isTyping : false;
                setIsOtherTyping(isTypingNow);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({ isTyping: false, updatedAt: Date.now() });
                }
            });

        const memberChannel = supabase.channel(`members_${activeConvId}`)
            .on('postgres_changes', { 
                event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${activeConvId}`
            }, (payload) => {
                if (payload.new.user_id !== currentUser.id) {
                    setOtherReadAt(payload.new.last_read_at);
                }
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
        };
    }, [activeConvId]);

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
    


    const fetchMessages = async () => {
        if (!activeConvId) return;
        const { data } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', activeConvId)
            .order('created_at', { ascending: true });
        if (data) setMessages(data.map(m => ({ ...m, status: 'sent' })));
    };

    const fetchOtherReadReceipt = async () => {
        if (!activeConvId) return;
        const { data } = await supabase.from('conversation_members')
            .select('last_read_at')
            .eq('conversation_id', activeConvId)
            .neq('user_id', currentUser.id)
            .maybeSingle();
        if (data) setOtherReadAt(data.last_read_at);
    };

    const markAsRead = async () => {
        if (!activeConvId) return;
        // Anti-Clock-Skew: Offset by 5 seconds into the future to ensure server trusts we read it
        const skewAdjustedTime = new Date(Date.now() + 5000).toISOString();
        
        await supabase.from('conversation_members')
            .update({ last_read_at: skewAdjustedTime })
            .eq('conversation_id', activeConvId)
            .eq('user_id', currentUser.id);
    };

    const handleSend = async (overrideData = null) => {
        if (!overrideData && (!input.trim() && pendingAttachments.length === 0) && !isUploading) return;
        
        clearTypingPresence();

        const msgText = overrideData ? overrideData.text : input;
        const currentAttachments = overrideData ? overrideData.attachments : [...pendingAttachments];
        let currentConvId = activeConvId;
        
        setInput('');
        setPendingAttachments([]);

        if (!currentConvId) {
            console.log("[Squad:Chat] Lazy initializing DM with:", chat.other_user_id);
            const { data: newId, error: initError } = await supabase.rpc('create_direct_message', { target_user_id: chat.other_user_id });
            if (initError || !newId) {
                setAlertNotice({ title: "Initialization Error", msg: "Could not start conversation. The user might be restricted or network is unavailable." });
                return;
            }
            currentConvId = newId;
            setActiveConvId(newId);
        }

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
            id: tempId, conversation_id: currentConvId,
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
                    const filePath = `${currentConvId}/${currentUser.id}/${Date.now()}_${safeName}`;
                    
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
            conversation_id: currentConvId,
            sender_id: currentUser.id,
            text: msgText,
            reply_to_id: currentReplyId,
            attachments: finalAttachments
        }).select().maybeSingle();
        
        if (error) {
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed' } : m));
            setAlertNotice({ title: "Delivery Error", msg: "Message failed to send. You may lack permission." });
        } else if (data) {
            // Anti-Stutter cache injection mapping
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
        setMessages(prev => prev.filter(m => m.id !== msgId));
        setActiveMenu(null);
        
        try {
            if (msgToDelete?.attachments && msgToDelete.attachments.length > 0) {
                const paths = msgToDelete.attachments.map(att => att.path).filter(Boolean);
                if (paths.length > 0) {
                    await supabase.storage.from('chat_media').remove(paths);
                }
            }
            const { error } = await supabase.from('messages').delete().eq('id', msgId);
            if (error) {
                setAlertNotice("Deletion failed. You do not have permission to delete this message.");
                fetchMessages();
            }
        } catch (err) {
            console.error("[Squad:Chat] Deletion synchronization failed:", err);
            fetchMessages();
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

    const getMessageStatusIcon = (m) => {
        if (m.sender_id !== currentUser.id) return null;
        if (m.status === 'pending') return <i className="fa-solid fa-clock" style={{color: '#888'}}></i>;
        if (m.status === 'failed') return <i className="fa-solid fa-circle-exclamation" style={{color: '#ff5f5f'}} title="Message Failed"></i>;
        const isRead = otherReadAt && new Date(m.created_at) <= new Date(otherReadAt);
        return isRead ? 
            <i className="fa-solid fa-check-double" style={{color: '#42d7b8'}}></i> : 
            <i className="fa-solid fa-check" style={{color: '#a0a0a0'}}></i>;
    };

    const formatTime = (isoString) => {
        if (!isoString) return '';
        return new Date(isoString).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    };
    const scrollToMessage = (id) => {
        const el = document.getElementById(`msg-${id}`);
        if (!el) return;

        el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Trigger highlight ONLY when the element actually lands in the viewport
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    console.log("[Squad:UI] Viewport intersection confirmed, executing highlight.");
                    el.classList.add('msg-highlight-flash');
                    
                    // Clean up: remove class after animation and disconnect observer
                    setTimeout(() => el.classList.remove('msg-highlight-flash'), 2500);
                    observer.disconnect();
                }
            });
        }, { 
            threshold: 0.5 // Trigger when at least 50% of the bubble is visible
        });

        observer.observe(el);
    };
    return (
        <div className="user-chat-overlay" style={{ display: isHidden ? 'none' : 'flex' }} onTouchStart={e => e.stopPropagation()}>
            <div className="ambient-prism-light"></div>

            <ChatSearchOverlay 
                isSearchActive={isSearchActive}
                setIsSearchActive={setIsSearchActive}
                messages={messages}
                scrollToMessage={scrollToMessage}
                formatTime={formatTime}
                resolveSenderName={(senderId) => senderId === currentUser.id ? 'You' : chatTitle}
            />
            
            {!isSearchActive && (
                <header className="prism-header" style={{ justifyContent: 'flex-start', gap: '1.5rem' }}>
                    <button className="icon-button" style={{ color: 'white', opacity: 0.6 }} onClick={onClose}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <div className="contact-profile" onClick={() => !isOtherUserDeleted && onOpenUser(chat.other_user_id)} style={{cursor: !isOtherUserDeleted ? 'pointer' : 'default'}}>
                        <div className="avatar-ring">
                            <img src={chatAvatar || 'https://via.placeholder.com/150'} alt="Avatar" />
                            {isOnline && <div className="online-dot"></div>}
                        </div>
                        <div className="contact-details">
                            <h2>{chatTitle}</h2>
                            <p style={{ color: (isOnline || isOtherTyping) ? '#42d7b8' : '#888' }}>
                                {isOtherTyping ? (
                                    <span>typing<span className="blink-cursor">...</span></span>
                                ) : (
                                    isOnline ? 'Online' : formatLastSeen(chat.other_user_last_seen)
                                )}
                            </p>
                        </div>
                    </div>
                    <button className="icon-button" style={{marginLeft: 'auto'}} onClick={() => setIsSearchActive(true)}><i className="fas fa-search"></i></button>
                </header>
            )}

            <main className="prism-flow" ref={flowRef} onClick={() => setActiveMenu(null)} onScroll={(e) => {
                setActiveMenu(null);
                const { scrollHeight, scrollTop, clientHeight } = e.currentTarget;
                isAutoScrollEnabled.current = scrollHeight - scrollTop - clientHeight < 250;
            }}>
                {messages.map((m) => {
                    const isMine = m.sender_id === currentUser.id;
                    const repliedMsg = m.reply_to_id ? messages.find(msg => msg.id === m.reply_to_id) : null;
                    const isMissingReply = m.reply_to_id && !repliedMsg;
                    const resolvedReplyName = !repliedMsg?.sender_id ? 'Deleted Account' : chatTitle;

                    return (
                        <ChatBubble 
                            key={m.id}
                            currentUser={currentUser}
                            msg={m}
                            isMine={isMine}
                            isGroup={false}
                            isPreview={false}
                            activeMenu={activeMenu}
                            setActiveMenu={setActiveMenu}
                            onOriginClick={onOriginClick}
                            scrollToMessage={scrollToMessage}
                            formatTime={formatTime}
                            setFullscreenGallery={setFullscreenGallery}
                            handleDownload={handleDownload}
                            repliedMsg={repliedMsg}
                            isMissingReply={isMissingReply}
                            resolvedReplyName={resolvedReplyName}
                            getMessageStatusIcon={getMessageStatusIcon}
                        />
                    );
                })}
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
                        resolved_sender_name: msg.sender_id === currentUser.id ? userProfile?.full_name : chatTitle,
                        resolved_sender_avatar: msg.sender_id === currentUser.id ? userProfile?.avatar_url : chatAvatar
                    });
                }}
                onEdit={startEditing}
                onDeleteRequest={(id, isStopPoll) => {
                    if (isStopPoll) setStopPollConfirm(id);
                    else setDeleteConfirm(id);
                }}
            />

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

            <ChatInputDock
                canPoll={true}
                editingMessage={editingMessage}
                setEditingMessage={setEditingMessage}
                replyingTo={replyingTo}
                setReplyingTo={setReplyingTo}
                scrollToMessage={scrollToMessage}
                resolveReplyUser={(id) => !id ? 'Deleted Account' : chatTitle}
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
            />

            {/* Custom Alert Notice for UserChat */}
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

            <FullscreenMediaGallery 
                fullscreenGallery={fullscreenGallery} 
                setFullscreenGallery={setFullscreenGallery} 
            />
        </div>
    );
};

export default UserChat;