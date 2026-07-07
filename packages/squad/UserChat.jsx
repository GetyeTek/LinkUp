import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import ChatSearchOverlay from './components/ChatSearchOverlay.jsx';
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
    const [input, setInput] = useState('');
    const [pendingAttachments, setPendingAttachments] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [fullscreenMedia, setFullscreenMedia] = useState(null);
    const [alertNotice, setAlertNotice] = useState(null);
    
    // Search State
    const [isSearchActive, setIsSearchActive] = useState(false);
    
    const fileInputRef = useRef(null);
    const flowRef = useRef(null);
    const isAutoScrollEnabled = useRef(true);
    const typingTimeoutRef = useRef(null);
    const roomChannelRef = useRef(null);
    const localTypingRef = useRef(false);

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

    const handleInputChange = (val) => {
        setInput(val);
        if (roomChannelRef.current) {
            const isTypingNow = val.length > 0;
            
            if (isTypingNow && !localTypingRef.current) {
                roomChannelRef.current.track({ isTyping: true, updatedAt: Date.now() }).catch(e => console.error("[UserChat] Track error:", e));
                localTypingRef.current = true;
            } else if (!isTypingNow && localTypingRef.current) {
                roomChannelRef.current.track({ isTyping: false, updatedAt: Date.now() }).catch(e => console.error("[UserChat] Track error:", e));
                localTypingRef.current = false;
            }

            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            if (isTypingNow) {
                typingTimeoutRef.current = setTimeout(() => {
                    if (roomChannelRef.current) roomChannelRef.current.track({ isTyping: false, updatedAt: Date.now() });
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
            setAlertNotice({ title: "Limit Reached", msg: "You can only attach up to 10 files at once. The first available slots have been filled." });
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
        if (roomChannelRef.current && localTypingRef.current) {
            roomChannelRef.current.track({ isTyping: false, updatedAt: Date.now() });
            localTypingRef.current = false;
        }

        const msgText = input;
        const currentAttachments = [...pendingAttachments];
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
            setMessages(prev => prev.map(m => m.id === editingMessage.id ? { ...m, text: msgText, is_edited: true } : m));
            await supabase.from('messages').update({ text: msgText, is_edited: true }).eq('id', editingMessage.id);
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
                    const filePath = `${currentConvId}/${currentUser.id}/${Date.now()}_${safeName}`;
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

    const deleteMessage = async (msgId) => {
        if (!window.confirm("Delete this message for everyone?")) return;
        console.group(`[Squad:Chat] Executing DELETE for node: ${msgId}`);
        
        const msgToDelete = messages.find(m => m.id === msgId);
        
        // 1. Optimistic UI removal
        setMessages(prev => prev.filter(m => m.id !== msgId));
        setActiveMenu(null);
        
        try {
            // 2. Storage Cleanup
            if (msgToDelete?.attachments && msgToDelete.attachments.length > 0) {
                const paths = msgToDelete.attachments.map(att => att.path).filter(Boolean);
                if (paths.length > 0) {
                    console.log("[Squad:Media] Purging orphaned assets:", paths);
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
            console.error("[Squad:Chat] Deletion synchronization failed:", err);
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
        return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
                {messages.map((m, idx) => {
                    const isMine = m.sender_id === currentUser.id;
                    const isMenuOpen = activeMenu?.msg?.id === m.id;
                    
                    const repliedMsg = m.reply_to_id ? messages.find(msg => msg.id === m.reply_to_id) : null;
                    const isMissingReply = m.reply_to_id && !repliedMsg;

                    return (
                        <div 
                            key={m.id} 
                            id={`msg-${m.id}`} 
                            className={`msg-prism-group ${isMine ? 'sent' : 'received'}`} 
                            onClick={(e) => { 
                                e.stopPropagation(); 
                                if (isMenuOpen) {
                                    setActiveMenu(null);
                                    return;
                                }
                                
                                // Capture exact touch/click coordinates
                                let x = e.clientX || (e.touches && e.touches[0].clientX);
                                let y = e.clientY || (e.touches && e.touches[0].clientY);
                                
                                // Fallback to element center if coordinates fail
                                if (!x || !y) {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    x = rect.left + rect.width / 2;
                                    y = rect.top + rect.height / 2;
                                }
                                
                                const menuW = 160;
                                const menuH = 200;
                                
                                // Push the menu inwards if the user tapped too close to the screen edge
                                if (x + menuW > window.innerWidth - 20) x = window.innerWidth - menuW - 20;
                                if (y + menuH > window.innerHeight - 80) y = window.innerHeight - menuH - 80;
                                if (y < 80) y = 80; // Don't let it overlap the header
                                
                                setActiveMenu({ msg: m, isMine, x, y });
                            }}
                            style={{ zIndex: isMenuOpen ? 100 : 1 }}
                        >
                            {(() => {
                                const hasMedia = m.attachments && m.attachments.length > 0;
                                const isNaked = hasMedia && (!m.text || m.text.trim() === '');
                                const bubbleClass = `prism-bubble ${hasMedia ? (isNaked ? 'media-bubble naked' : 'media-bubble captioned') : ''}`;
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
                                    <div className="reply-quote" onClick={(e) => { e.stopPropagation(); scrollToMessage(m.reply_to_id); }}>
                                        <div className="reply-quote-bar"></div>
                                                                                <div className="reply-quote-content">
                                            <div className="reply-quote-user">
    {!repliedMsg.sender_id ? 'Deleted Account' : chatTitle}
</div>
                                            <div className="reply-quote-text">{repliedMsg.text}</div>
                                        </div>
                                    </div>
                                ) : isMissingReply ? (
                                    <div className="reply-quote is-deleted">
                                        <div className="reply-quote-bar"></div>
                                        <div className="reply-quote-content">
                                            <div className="reply-quote-user">System</div>
                                            <div className="reply-quote-text"><i>Original message deleted</i></div>
                                        </div>
                                    </div>
                                ) : null}
                                
                                {/* ATTACHMENTS RENDER */}
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
                                                                    setFullscreenMedia(att); // Temporary placeholder before FullscreenGallery
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
                            </div>
                            );
                            })()}
                            <div className="prism-time">
                                {m.is_edited && <span className="edited-label">edited</span>}
                                {formatTime(m.created_at)}
                                {isMine && <span style={{ marginLeft: '6px' }}>{getMessageStatusIcon(m)}</span>}
                            </div>
                        </div>
                    );
                })}
            </main>

            <footer className="prism-input-wrapper">
                {editingMessage && (
                    <div className="input-mode-header edit-mode">
                        <div className="edit-preview-border"></div>
                        <div className="input-mode-icon">
                            <i className="fa-solid fa-pen"></i>
                        </div>
                        <div className="reply-preview-info">
                            <span className="edit-user">Editing message</span>
                            <span className="reply-text">{editingMessage.text}</span>
                        </div>
                        <button className="icon-button" onClick={() => { setEditingMessage(null); setInput(''); }}>
                            <i className="fa-solid fa-times"></i>
                        </button>
                    </div>
                )}
                {replyingTo && (
                    <div className="input-mode-header">
                        <div className="reply-preview-border"></div>
                        <div className="reply-preview-info" onClick={() => scrollToMessage(replyingTo.id)} style={{ cursor: 'pointer' }}>
                            <span className="reply-user">
    Replying to {!replyingTo.sender_id ? 'Deleted Account' : chatTitle}
</span>
                            <span className="reply-text">{replyingTo.text}</span>
                        </div>
                        <button className="icon-button" onClick={() => setReplyingTo(null)}>
                            <i className="fa-solid fa-times"></i>
                        </button>
                    </div>
                )}
                {pendingAttachments.length > 0 && (
                    <div className="input-mode-header staging-mode">
                        <div className="staging-preview-border"></div>
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
                        <button className="icon-button" onClick={() => setPendingAttachments([])} style={{color: '#ff5f5f', background: 'rgba(255,95,95,0.1)', width: '30px', height: '30px'}}>
                            <i className="fa-solid fa-trash"></i>
                        </button>
                    </div>
                )}
                <div className="prism-dock">
                    <input 
                        type="file" 
                        multiple
                        ref={fileInputRef} 
                        style={{display: 'none'}} 
                        onChange={handleFileSelect} 
                    />
                    <button className="add-btn" onClick={() => fileInputRef.current.click()} disabled={isUploading}>
                        <i className="fa-solid fa-paperclip"></i>
                    </button>
                    <input 
                        type="text" 
                        placeholder="Message..." 
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
                        <button className="prism-send-btn" onClick={handleSend} disabled={!input.trim() && pendingAttachments.length === 0}>
                            <i className={`fa-solid ${editingMessage ? 'fa-check' : 'fa-arrow-up'}`}></i>
                        </button>
                    )}
                </div>
            </footer>

            {activeMenu && (
                <div className="msg-actions-menu-fixed" style={{ left: activeMenu.x, top: activeMenu.y }}>
                    {!activeMenu.isMine && (
                        <button className="msg-action-btn" onClick={() => startReply(activeMenu.msg)}>
                            <i className="fa-solid fa-reply"></i> Reply
                        </button>
                    )}
                    {activeMenu.msg.text && (
                        <button className="msg-action-btn" onClick={() => handleCopy(activeMenu.msg.text)}>
                            <i className="fa-solid fa-copy"></i> Copy Text
                        </button>
                    )}
                    {activeMenu.msg.attachments && activeMenu.msg.attachments.length > 0 && (
                        <button className="msg-action-btn" onClick={() => {
                            if (activeMenu.msg.attachments.length > 1) {
                                handleDownloadAll(activeMenu.msg.attachments);
                            } else {
                                handleDownload(activeMenu.msg.attachments[0].url, activeMenu.msg.attachments[0].name);
                            }
                        }}>
                            <i className="fa-solid fa-download"></i> {activeMenu.msg.attachments.length > 1 ? 'Download All Files' : 'Download File'}
                        </button>
                    )}
                    <button className="msg-action-btn" onClick={() => { 
                        onForward({
                            ...activeMenu.msg, 
                            resolved_sender_name: activeMenu.isMine ? userProfile?.full_name : chatTitle,
                            resolved_sender_avatar: activeMenu.isMine ? userProfile?.avatar_url : chatAvatar
                        }); 
                        setActiveMenu(null); 
                    }}>
                        <i className="fa-solid fa-share"></i> Forward
                    </button>
                    {activeMenu.isMine && (
                        <button className="msg-action-btn" onClick={() => startEditing(activeMenu.msg)}>
                            <i className="fa-solid fa-pen"></i> Edit
                        </button>
                    )}
                    {activeMenu.isMine && (
                        <button className="msg-action-btn delete" onClick={() => deleteMessage(activeMenu.msg.id)}>
                            <i className="fa-solid fa-trash"></i> Delete
                        </button>
                    )}
                </div>
            )}
            {/* Custom Alert Notice for UserChat */}
            {alertNotice && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', animation: 'fadeIn 0.2s ease-out' }}>
                    <div style={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', width: '100%', maxWidth: '360px', padding: '1.5rem', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: '#ffab40', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <i className="fas fa-exclamation-circle"></i> Notice
                        </h3>
                        <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>{alertNotice}</p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: 600, fontFamily: 'Poppins, sans-serif', cursor: 'pointer', border: 'none', fontSize: '0.9rem', background: 'var(--accent-teal)', color: '#000' }} onClick={() => setAlertNotice(null)}>Okay</button>
                        </div>
                    </div>
                </div>
            )}


            {fullscreenMedia && (
                <div className="fullscreen-media-overlay" onClick={() => setFullscreenMedia(null)}>
                    <button className="icon-button close-media" onClick={() => setFullscreenMedia(null)}>
                        <i className="fas fa-times"></i>
                    </button>
                    {fullscreenMedia.type.startsWith('video/') ? (
                        <video src={fullscreenMedia.url} controls autoPlay onClick={e => e.stopPropagation()} style={{maxWidth: '100%', maxHeight: '100%'}} />
                    ) : (
                        <img src={fullscreenMedia.url} alt="Fullscreen Media" onClick={e => e.stopPropagation()} />
                    )}
                </div>
            )}
        </div>
    );
};

export default UserChat;