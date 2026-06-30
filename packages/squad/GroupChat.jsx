import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './GroupChat.css';

const GroupChat = ({ chat, currentUser, onClose, onJoin, isJoining }) => {
    const { user: userProfile } = usePlatform();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [members, setMembers] = useState({});
    const [myRole, setMyRole] = useState('member');
    const [activeMenu, setActiveMenu] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [editingMessage, setEditingMessage] = useState(null);
    const [replyingTo, setReplyingTo] = useState(null);

    // Search State
    const [isSearchActive, setIsSearchActive] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
    const [showSearchList, setShowSearchList] = useState(false);

    const flowRef = useRef(null);

    useEffect(() => {
        const fetchState = async () => {
            // OPTIMIZATION: Fire the heavy queries in parallel instead of sequentially
            const [msgResponse, memResponse] = await Promise.all([
                supabase.from('messages')
                    .select('*')
                    .eq('conversation_id', chat.conversation_id)
                    .order('created_at', { ascending: true }),
                supabase.from('conversation_members')
                    .select('user_id, role')
                    .eq('conversation_id', chat.conversation_id)
            ]);

            let memMap = {};

            // If we have members, fetch their profile metadata
            if (memResponse.data && memResponse.data.length > 0) {
                const userIds = memResponse.data.map(m => m.user_id);
                
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, full_name, avatar_url')
                    .in('id', userIds);

                memResponse.data.forEach(m => {
                    const prof = profiles?.find(p => p.id === m.user_id);
                    memMap[m.user_id] = { role: m.role, name: prof?.full_name, avatar: prof?.avatar_url };
                    if (m.user_id === currentUser.id) setMyRole(m.role);
                });
                setMembers(memMap);
            }

            // Immediately set the messages that we fetched concurrently
            if (msgResponse.data) {
                setMessages(msgResponse.data.map(m => ({ ...m, status: 'sent' })));
            }
            
            setIsLoading(false);
        };

        fetchState();

        const channel = supabase.channel(`group_${chat.conversation_id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chat.conversation_id}` }, (payload) => {
                if (payload.eventType === 'INSERT') {
                    setMessages(prev => {
                        if (prev.find(m => m.id === payload.new.id)) return prev;
                        return [...prev, { ...payload.new, status: 'sent' }];
                    });
                } else if (payload.eventType === 'UPDATE') {
                    setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...payload.new, status: 'sent' } : m));
                } else if (payload.eventType === 'DELETE') {
                    setMessages(prev => prev.filter(m => m.id !== payload.old.id));
                }
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [chat.conversation_id]);

    useEffect(() => {
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
        // Reverse array so newest messages (bottom) are index 0
        const results = messages.filter(m => m.text && m.text.toLowerCase().includes(term)).reverse();
        setSearchResults(results);
        if (results.length > 0) {
            setCurrentSearchIndex(0);
            scrollToMessage(results[0].id);
        } else {
            setCurrentSearchIndex(-1);
        }
    };

    const searchOlder = () => {
        if (searchResults.length === 0) return;
        let newIdx = currentSearchIndex + 1;
        if (newIdx >= searchResults.length) newIdx = 0; // Wrap around
        setCurrentSearchIndex(newIdx);
        scrollToMessage(searchResults[newIdx].id);
    };

    const searchNewer = () => {
        if (searchResults.length === 0) return;
        let newIdx = currentSearchIndex - 1;
        if (newIdx < 0) newIdx = searchResults.length - 1; // Wrap around
        setCurrentSearchIndex(newIdx);
        scrollToMessage(searchResults[newIdx].id);
    };

    const getSnippet = (text, query) => {
        if (!query) return text;
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return text;
        const start = Math.max(0, idx - 40);
        const end = Math.min(text.length, idx + query.length + 60);
        let snippet = text.substring(start, end);
        if (start > 0) snippet = '...' + snippet;
        if (end < text.length) snippet = snippet + '...';
        return snippet;
    };

    const handleSend = async () => {
        if (!input.trim()) return;
        const msgText = input;
        setInput('');

        // Handle Edit
        if (editingMessage) {
            setMessages(prev => prev.map(m => m.id === editingMessage.id ? { ...m, text: msgText, is_edited: true } : m));
            await supabase.from('messages').update({ text: msgText, is_edited: true }).eq('id', editingMessage.id);
            setEditingMessage(null);
            return;
        }

        const currentReplyId = replyingTo?.id;
        setReplyingTo(null);

        // Optimistic UI temp message
        const tempId = `temp-${Date.now()}`;
        setMessages(prev => [...prev, {
            id: tempId, conversation_id: chat.conversation_id,
            sender_id: currentUser.id, text: msgText,
            reply_to_id: currentReplyId,
            created_at: new Date().toISOString(), status: 'pending'
        }]);

        const { data } = await supabase.from('messages').insert({
            conversation_id: chat.conversation_id,
            sender_id: currentUser.id,
            text: msgText,
            reply_to_id: currentReplyId
        }).select().single();

        if (data) {
            setMessages(prev => prev.map(m => m.id === tempId ? { ...data, status: 'sent' } : m));
        }
    };

    const handleDelete = async (msgId) => {
        if (!window.confirm("Purge this entry?")) return;
        setMessages(prev => prev.filter(m => m.id !== msgId));
        setActiveMenu(null);
        await supabase.from('messages').delete().eq('id', msgId);
    };

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
        setActiveMenu(null);
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

    return (
        <div className="squad-chat-overlay">
            <div className="squad-bg-pattern"></div>
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
                        <button onClick={searchOlder} disabled={searchResults.length === 0}><i className="fas fa-chevron-up"></i></button>
                        <button onClick={searchNewer} disabled={searchResults.length === 0}><i className="fas fa-chevron-down"></i></button>
                        <button className="snippet-btn" onClick={() => setShowSearchList(true)} disabled={searchResults.length === 0}><i className="fas fa-list"></i></button>
                    </div>
                </header>
            ) : (
                <header className="squad-header" style={{ justifyContent: 'flex-start', gap: '1.2rem' }}>
                    <button className="icon-button back-btn" onClick={onClose}><i className="fas fa-chevron-left"></i></button>
                    <div className="squad-contact-profile">
                        <div className="squad-avatar-ring">
                            {chat.avatar_url ? (
                                <img src={chat.avatar_url} alt="Squad Avatar" />
                            ) : (
                                <div className="squad-default-avatar"><i className="fas fa-users"></i></div>
                            )}
                        </div>
                        <div className="squad-header-info">
                            <h2>{chat.title}</h2>
                            <div className="squad-meta-tags">
                                <span className="squad-badge focus">{chat.metadata?.focus || 'General'}</span>
                                <span className="squad-badge count"><i className="fas fa-user"></i> {Object.keys(members).length}</span>
                            </div>
                        </div>
                    </div>
                    <button className="icon-button" style={{marginLeft: 'auto'}} onClick={() => setIsSearchActive(true)}><i className="fas fa-search"></i></button>
                </header>
            )}

            <main className="squad-flow" ref={flowRef} onClick={() => setActiveMenu(null)} onScroll={() => setActiveMenu(null)}>
                {isLoading ? (
                    <div className="squad-loading-state">
                        <i className="fas fa-circle-notch fa-spin"></i>
                        <p>Syncing Squad comms...</p>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="squad-empty-state">
                        <i className="fas fa-user-group"></i>
                        <p>{chat.is_preview ? "No messages yet. Join to start the discussion!" : "No messages yet. Start the discussion!"}</p>
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
                                    <img src={sender.avatar || 'https://via.placeholder.com/150'} alt="Avatar" className="squad-msg-avatar" />
                                )}
                                <div className="squad-bubble-wrapper">
                                    {!isMine && (
                                        <div className="squad-sender-name">
                                            {sender.name}
                                            {sender.role === 'owner' && <i className="fas fa-crown admin-crown"></i>}
                                        </div>
                                    )}
                                    <div className="squad-bubble">
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
                                    
                                    {m.text}
                                    
                                    <div className={`squad-time-meta ${isMine ? 'mine-meta' : ''}`}>
                                        {m.is_edited && <span>edited</span>}
                                        {formatTime(m.created_at)}
                                        {isMine && (m.status === 'pending' ? <i className="fa-solid fa-clock" style={{fontSize: '0.6rem'}}></i> : <i className="fa-solid fa-check"></i>)}
                                    </div>
                                </div>
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
                    {activeMenu.isMine && (
                        <button className="squad-ctx-btn" onClick={() => startEditing(activeMenu.msg)}>
                            <i className="fa-solid fa-pen"></i> Edit
                        </button>
                    )}
                    {(activeMenu.isMine || myRole === 'owner' || myRole === 'admin') && (
                        <button className="squad-ctx-btn delete" onClick={() => handleDelete(activeMenu.msg.id)}>
                            <i className="fa-solid fa-trash"></i> {activeMenu.isMine ? 'Delete' : 'Admin Delete'}
                        </button>
                    )}
                </div>
            )}

            <footer className="squad-input-area" style={{ padding: '0 1.5rem calc(1rem + env(safe-area-inset-bottom))', background: 'linear-gradient(to top, #08080c 80%, transparent)' }}>
                {chat.is_preview ? (
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
                        
                        <div className="squad-dock">
                            <input 
                                type="text" 
                                placeholder="Squad message..." 
                                value={input} 
                                onChange={e => setInput(e.target.value)} 
                                onKeyPress={e => e.key === 'Enter' && handleSend()} 
                            />
                            <button className="squad-send-btn" onClick={handleSend} disabled={!input.trim()}>
                                <i className={`fa-solid ${editingMessage ? 'fa-check' : 'fa-arrow-up'}`}></i>
                            </button>
                        </div>
                    </>
                )}
            </footer>
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
                                        <span>{m.sender_id === currentUser.id ? 'You' : (members[m.sender_id]?.name || 'User')}</span>
                                        <span>{formatTime(m.created_at)}</span>
                                    </div>
                                                                <div className="csm-text">
                                {getSnippet(m.text, searchQuery).split(new RegExp(`(${searchQuery})`, 'gi')).map((part, i) => 
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
export default GroupChat;