import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './UserChat.css';

const UserChat = ({ chat, currentUser, isOnline, onClose }) => {
    const { user: userProfile } = usePlatform();
    const [activeConvId, setActiveConvId] = useState(chat.conversation_id);
    const [messages, setMessages] = useState([]);
    const [otherReadAt, setOtherReadAt] = useState(null);
    const [isOtherTyping, setIsOtherTyping] = useState(false);
    const [activeMenu, setActiveMenu] = useState(null);
    const [editingMessage, setEditingMessage] = useState(null);
    const [replyingTo, setReplyingTo] = useState(null);
    const [input, setInput] = useState('');
    const [pendingAttachment, setPendingAttachment] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    
    // Search State
    const [isSearchActive, setIsSearchActive] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
    const [showSearchList, setShowSearchList] = useState(false);
    
    const fileInputRef = useRef(null);
    const flowRef = useRef(null);
    const typingTimeoutRef = useRef(null);
    const roomChannelRef = useRef(null);

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
                    if (payload.new.sender_id !== currentUser.id) markAsRead();
                } else if (payload.eventType === 'UPDATE') {
                    setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...payload.new, status: 'sent' } : m));
                } else if (payload.eventType === 'DELETE') {
                    setMessages(prev => prev.filter(m => m.id !== payload.old.id));
                }
            })
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                const otherUserPresence = state[chat.other_user_id];
                setIsOtherTyping(!!(otherUserPresence && otherUserPresence[0]?.isTyping));
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({ isTyping: false });
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

        return () => {
            supabase.removeChannel(channel);
            supabase.removeChannel(memberChannel);
        };
    }, [activeConvId]);

    useEffect(() => {
        // Prevent yanking the scrollbar down if the user is actively searching old messages
        if (flowRef.current && !isSearchActive) {
            flowRef.current.scrollTop = flowRef.current.scrollHeight;
        }
    }, [messages, isSearchActive]);
    
    const executeSearch = (query) => {
        setSearchQuery(query);
        if (!query.trim()) {
            setSearchResults([]);
            setCurrentSearchIndex(-1);
            return;
        }
        const term = query.toLowerCase();
        const results = messages.filter(m => m.text && m.text.toLowerCase().includes(term));
        setSearchResults(results);
        if (results.length > 0) {
            setCurrentSearchIndex(results.length - 1);
            scrollToMessage(results[results.length - 1].id);
        } else {
            setCurrentSearchIndex(-1);
        }
    };

    const nextSearchResult = () => {
        if (searchResults.length === 0) return;
        let newIdx = currentSearchIndex + 1;
        if (newIdx >= searchResults.length) newIdx = 0;
        setCurrentSearchIndex(newIdx);
        scrollToMessage(searchResults[newIdx].id);
    };

    const prevSearchResult = () => {
        if (searchResults.length === 0) return;
        let newIdx = currentSearchIndex - 1;
        if (newIdx < 0) newIdx = searchResults.length - 1;
        setCurrentSearchIndex(newIdx);
        scrollToMessage(searchResults[newIdx].id);
    };

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
            .single();
        if (data) setOtherReadAt(data.last_read_at);
    };

    const markAsRead = async () => {
        if (!activeConvId) return;
        await supabase.from('conversation_members')
            .update({ last_read_at: new Date().toISOString() })
            .eq('conversation_id', activeConvId)
            .eq('user_id', currentUser.id);
    };

    const handleInputChange = (val) => {
        setInput(val);
        if (roomChannelRef.current) roomChannelRef.current.track({ isTyping: true });
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            if (roomChannelRef.current) roomChannelRef.current.track({ isTyping: false });
        }, 2500);
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
        setPendingAttachment({ file, previewUrl });
        e.target.value = null; // Reset input
    };

    const handleSend = async () => {
        if ((!input.trim() && !pendingAttachment) || isUploading) return;
        
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        if (roomChannelRef.current) roomChannelRef.current.track({ isTyping: false });

        const msgText = input;
        const currentAttachment = pendingAttachment;
        let currentConvId = activeConvId;
        
        setInput('');
        setPendingAttachment(null);

        // 1. LAZY INITIALIZATION: Create conversation if this is a Ghost Chat
        if (!currentConvId) {
            console.log("[Squad:Chat] Lazy initializing DM with:", chat.other_user_id);
            const { data: newId, error: initError } = await supabase.rpc('create_direct_message', { 
                target_user_id: chat.other_user_id 
            });
            
            if (initError || !newId) {
                console.error("Failed to initialize lazy chat:", initError);
                return;
            }
            currentConvId = newId;
            setActiveConvId(newId); // This triggers the Realtime useEffect
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
            attachments: currentAttachment ? [{ name: currentAttachment.file.name, type: currentAttachment.file.type, url: currentAttachment.previewUrl || '' }] : [],
            created_at: new Date().toISOString(), status: 'pending'
        }]);

        let finalAttachments = [];

        if (currentAttachment) {
            setIsUploading(true);
            try {
                const file = currentAttachment.file;
                const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                const filePath = `${currentConvId}/${currentUser.id}/${Date.now()}_${safeName}`;
                const arrayBuffer = await file.arrayBuffer();
                const { error: uploadError } = await supabase.storage.from('chat_media').upload(filePath, arrayBuffer, { contentType: file.type, upsert: true });
                if (uploadError) throw uploadError;
                const { data: { publicUrl } } = supabase.storage.from('chat_media').getPublicUrl(filePath);
                finalAttachments = [{ name: file.name, url: publicUrl, path: filePath, type: file.type, size: file.size }];
            } catch (err) {
                console.error("[Squad:Media] Asset upload failed:", err);
                setIsUploading(false);
                return;
            }
            setIsUploading(false);
        }

        const { data, error } = await supabase.from('messages').insert({
            conversation_id: currentConvId,
            sender_id: currentUser.id,
            text: msgText,
            reply_to_id: currentReplyId,
            attachments: finalAttachments
        }).select().single();
        
        if (!error && data) {
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
            const response = await supabase.from('messages').delete().eq('id', msgId).select();
            console.log("Delete Response:", response);
        } catch (err) {
            console.error("[Squad:Chat] Deletion synchronization failed:", err);
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
        
        console.log(`[Squad:Media] Instantiating secure download stream for: ${filename}`);
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
        <div className="user-chat-overlay">
            <div className="ambient-prism-light"></div>

            {isSearchActive ? (
                <header className="chat-search-header">
                    <button className="icon-button back-btn" onClick={() => { setIsSearchActive(false); setSearchQuery(''); }}><i className="fas fa-arrow-left"></i></button>
                    <div className="chat-search-input-wrapper">
                        <input 
                            type="text" 
                            className="chat-search-input" 
                            value={searchQuery} 
                            onChange={(e) => executeSearch(e.target.value)} 
                            placeholder="Search..." 
                            autoFocus 
                        />
                        <span className="search-count">
                            {searchResults.length > 0 ? `${currentSearchIndex + 1}/${searchResults.length}` : '0/0'}
                        </span>
                    </div>
                    <div className="chat-search-nav">
                        <button onClick={prevSearchResult} disabled={searchResults.length === 0}><i className="fas fa-chevron-up"></i></button>
                        <button onClick={nextSearchResult} disabled={searchResults.length === 0}><i className="fas fa-chevron-down"></i></button>
                        <button className="snippet-btn" onClick={() => setShowSearchList(true)} disabled={searchResults.length === 0}><i className="fas fa-list"></i></button>
                    </div>
                </header>
            ) : (
                <header className="prism-header" style={{ justifyContent: 'flex-start', gap: '1.5rem' }}>
                    <button className="icon-button" style={{ color: 'white', opacity: 0.6 }} onClick={onClose}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <div className="contact-profile">
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

            <main className="prism-flow" ref={flowRef} onClick={() => setActiveMenu(null)} onScroll={() => setActiveMenu(null)}>
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
                            <div className="prism-bubble">
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
                                {m.attachments && m.attachments.map((att, i) => (
                                    <div key={i} className="bubble-attachment">
                                        {att.type.startsWith('image/') ? (
                                            <img src={att.url} alt="Shared Image" className="bubble-image" />
                                        )                                         : (
                                            <div className="bubble-file-box" onClick={(e) => { e.stopPropagation(); handleDownload(att.url, att.name); }}>
                                                <div className="bubble-file-icon"><i className="fas fa-file"></i></div>
                                                <div className="bubble-file-info">
                                                    <span className="bubble-file-name">{att.name}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {m.text && <div className="bubble-text-content">{m.text}</div>}
                            </div>
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
                {pendingAttachment && (
                    <div className="input-mode-header staging-mode">
                        <div className="staging-preview-border"></div>
                        <div className="staging-preview-content">
                            {pendingAttachment.previewUrl ? (
                                <img src={pendingAttachment.previewUrl} alt="Preview" className="staging-thumb" />
                            ) : (
                                <div className="staging-file-icon"><i className="fas fa-file"></i></div>
                            )}
                            <div className="staging-file-details">
                                <span className="staging-title">Attachment ready</span>
                                <span className="staging-name">{pendingAttachment.file.name}</span>
                            </div>
                        </div>
                        <button className="icon-button" onClick={() => setPendingAttachment(null)}>
                            <i className="fa-solid fa-times"></i>
                        </button>
                    </div>
                )}
                <div className="prism-dock">
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        style={{display: 'none'}} 
                        onChange={handleFileSelect} 
                    />
                    <button className="add-btn" onClick={() => fileInputRef.current.click()} disabled={isUploading}>
                        <i className="fa-solid fa-plus"></i>
                    </button>
                    <input 
                        type="text" 
                        placeholder="Message..." 
                        disabled={isUploading}
                        value={input}
                        onChange={(e) => handleInputChange(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    />
                    <button className="prism-send-btn" onClick={handleSend} disabled={isUploading || (!input.trim() && !pendingAttachment)}>
                        {isUploading ? (
                            <i className="fa-solid fa-circle-notch fa-spin"></i>
                        ) : (
                            <i className={`fa-solid ${editingMessage ? 'fa-check' : 'fa-arrow-up'}`}></i>
                        )}
                    </button>
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
                    {activeMenu.msg.attachments?.[0] && (
                        <button className="msg-action-btn" onClick={() => handleDownload(activeMenu.msg.attachments[0].url, activeMenu.msg.attachments[0].name)}>
                            <i className="fa-solid fa-download"></i> Download File
                        </button>
                    )}
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
            {showSearchList && (
                <div className="chat-search-modal-overlay" onClick={() => setShowSearchList(false)}>
                    <div className="chat-search-modal" onClick={e => e.stopPropagation()}>
                        <div className="csm-header">
                            <h3>Search Results</h3>
                            <button className="icon-button" onClick={() => setShowSearchList(false)}><i className="fas fa-times"></i></button>
                        </div>
                        <div className="csm-body">
                            {searchResults.length === 0 ? (
                                <div className="csm-empty">No matching records found.</div>
                            ) : searchResults.map((m, idx) => (
                                <div key={m.id} className="csm-snippet-card" onClick={() => {
                                    setCurrentSearchIndex(idx);
                                    setShowSearchList(false);
                                    scrollToMessage(m.id);
                                }}>
                                    <div className="csm-meta">
                                        <span>{m.sender_id === currentUser.id ? 'You' : chatTitle}</span>
                                        <span>{formatTime(m.created_at)}</span>
                                    </div>
                                    <div className="csm-text">
                                        {m.text.split(new RegExp(`(${searchQuery})`, 'gi')).map((part, i) => 
                                            part.toLowerCase() === searchQuery.toLowerCase() ? 
                                            <span key={i} className="csm-highlight">{part}</span> : part
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserChat;