import React, { useState, useEffect } from 'react';
import { supabase } from '../config/supabaseClient.js';
import UserChat from './UserChat.jsx';
import Notes from './Notes.jsx';

// Inline Component: Discovery Screen
const DiscoveryScreen = ({ currentUser, onClose, onStartChat }) => {
    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [searchStatus, setSearchStatus] = useState('idle'); // idle, searching, found, not_found
    const [searchResults, setSearchResults] = useState([]);

    useEffect(() => {
        const fetchDiscovery = async () => {
            const { data } = await supabase.rpc('get_social_discovery', { req_user_id: currentUser.id });
            if (data) setSuggestions(data);
            setLoading(false);
        };
        fetchDiscovery();
    }, [currentUser.id]);

    const handleSearch = async () => {
        if (!searchTerm.trim()) return;
        setSearchStatus('searching');
        const { data, error } = await supabase.rpc('find_user_by_any_identity', { 
            search_term: searchTerm.trim(),
            req_user_id: currentUser.id
        });
        
        if (data && data.length > 0) {
            setSearchResults(data);
            setSearchStatus('found');
        } else {
            setSearchStatus('not_found');
        }
    };

    return (
        <div className="discovery-screen">
            <header className="discovery-header">
                <button className="icon-button" onClick={onClose} style={{color: 'white'}}>
                    <i className="fas fa-arrow-left"></i>
                </button>
                <h2>Discover Peers</h2>
            </header>

            <div className="discovery-body">
                <div className="add-friend-trigger" onClick={() => { setIsSheetOpen(true); setSearchStatus('idle'); setSearchTerm(''); }}>
                    <div className="icon-box"><i className="fas fa-user-plus"></i></div>
                    <div>
                        <div style={{fontSize: '1rem'}}>Add Connection</div>
                        <div style={{fontSize: '0.75rem', color: '#888', fontWeight: '400'}}>Search by Phone, Email, or @handle</div>
                    </div>
                </div>

                {suggestions.length > 0 && (
                    <div className="suggestion-section">
                        <h3 className="section-title" style={{marginBottom: '0.5rem'}}>Suggested Classmates</h3>
                        {suggestions.map(user => (
                            <div className="peer-card" key={user.id} onClick={() => onStartChat(user)}>
                                <img src={user.avatar_url || 'https://via.placeholder.com/150'} className="peer-avatar" alt="Avatar" />
                                <div className="peer-info">
                                    <div className="peer-name">{user.full_name}</div>
                                    <div className="peer-meta">
                                        <span className={`peer-tier-badge tier-${user.tier}`}>
                                            {user.tier === 1 ? 'Classmate' : user.tier === 2 ? 'Campus' : 'Global'}
                                        </span>
                                        <span>@{user.username}</span>
                                    </div>
                                </div>
                                <i className="fas fa-paper-plane" style={{color: 'var(--text-secondary-dark)'}}></i>
                            </div>
                        ))}
                    </div>
                )}
                
                {!loading && suggestions.length === 0 && (
                    <div style={{textAlign: 'center', color: '#666', marginTop: '2rem', fontStyle: 'italic'}}>
                        No new suggestions right now.
                    </div>
                )}
            </div>

            {isSheetOpen && (
                <>
                    <div className="bottom-sheet-backdrop" onClick={() => setIsSheetOpen(false)}></div>
                    <div className="bottom-sheet">
                        <div className="sheet-handle"></div>
                        <h3 className="sheet-title">Find Someone</h3>
                        <p className="sheet-subtitle">Enter their exact phone number, email, or partial @username.</p>
                        
                        <div className="sheet-input-group">
                            <i className="fas fa-search"></i>
                            <input 
                                type="text" 
                                className="sheet-input" 
                                placeholder="e.g. 0912..., @scholar, or email"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                autoFocus
                            />
                        </div>

                        <button className="sheet-btn" onClick={handleSearch} disabled={searchStatus === 'searching' || !searchTerm.trim()}>
                            {searchStatus === 'searching' ? <i className="fas fa-circle-notch fa-spin"></i> : 'Search Network'}
                        </button>

                        {searchStatus === 'not_found' && (
                            <div className="not-found-state">
                                <i className="fas fa-user-slash"></i> No active users matched that identity.
                            </div>
                        )}

                        {searchStatus === 'found' && searchResults.map(res => (
                            <div className="search-result-card" key={res.id} onClick={() => { setIsSheetOpen(false); onStartChat(res); }}>
                                <img src={res.avatar_url} className="peer-avatar" style={{width: '40px', height: '40px'}} alt="Avatar" />
                                <div className="peer-info">
                                    <div className="peer-name" style={{color: '#fff'}}>{res.full_name}</div>
                                    <div className="peer-meta">@{res.username}</div>
                                </div>
                                <i className="fas fa-comment-dots" style={{color: 'var(--accent-teal)'}}></i>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

const Connect = ({ onOpenActivity, userProfile, currentUser }) => {
    const [activeView, setActiveView] = useState('messages');
    const [activeChat, setActiveChat] = useState(null);
    const [isNotesOpen, setIsNotesOpen] = useState(false);
    const [conversations, setConversations] = useState([]);
    const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
    const [showDiscovery, setShowDiscovery] = useState(false);
    const [onlineUsers, setOnlineUsers] = useState(new Set());

    useEffect(() => {
        if (!currentUser) return;
        
        fetchConversations();
        
        // 1. Subscribe to Realtime Messages and Read Receipt updates
        const msgChannel = supabase.channel('chat_list_updates')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
                fetchConversations();
            })
            .on('postgres_changes', { 
                event: 'UPDATE', 
                schema: 'public', 
                table: 'conversation_members',
                filter: `user_id=eq.${currentUser.id}` 
            }, () => {
                // Refresh list when I mark a chat as read to clear badges instantly
                fetchConversations();
            })
            .subscribe();

        // 2. Global Presence (Who is Online?)
        const presenceChannel = supabase.channel('global_presence', {
            config: { presence: { key: currentUser.id } }
        });
        
        presenceChannel.on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            setOnlineUsers(new Set(Object.keys(state)));
        }).subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await presenceChannel.track({ online_at: new Date().toISOString() });
            }
        });

        return () => {
            supabase.removeChannel(msgChannel);
            supabase.removeChannel(presenceChannel);
        };
    }, [currentUser]);

    const fetchConversations = async () => {
        const { data, error } = await supabase.rpc('get_user_conversations', { req_user_id: currentUser.id });
        if (data) setConversations(data);
        if (error) console.error("Error fetching chats:", error);
    };

    const startDirectMessage = async (targetUser) => {
        // 1. Check if DM already exists locally
        const existing = conversations.find(c => c.type === 'dm' && c.other_user_id === targetUser.id);
        if (existing) {
            setShowDiscovery(false);
            setActiveChat(existing);
            return;
        }

        // 2. Call the secure RPC to create the DM atomically
        const { data: newConvId, error } = await supabase.rpc('create_direct_message', { 
            target_user_id: targetUser.id 
        });

        if (error) {
            console.error("Failed to create DM:", error);
            return;
        }

        setShowDiscovery(false);
        fetchConversations();
        
        // Construct temporary object to open chat immediately
        setActiveChat({
            conversation_id: newConvId,
            type: 'dm',
            other_user_id: targetUser.id,
            other_user_name: targetUser.full_name,
            other_user_avatar: targetUser.avatar_url
        });
    };

    const handleScroll = (e) => {
        setIsHeaderCollapsed(e.currentTarget.scrollTop > 30);
    };

    const formatTime = (isoString) => {
        if (!isoString) return '';
        const date = new Date(isoString);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className={`tab-content active ${isHeaderCollapsed ? 'header-collapsed' : ''} ${activeView === 'for-you' ? 'for-you-active' : ''}`} id="connect-content">
            <header className="interactive-header">
                <div className="large-title-row">
                    <h2 className="large-title">Social Hub</h2>
                    <div className="header-actions">
                        <button className="icon-button notification-btn" onClick={onOpenActivity}>
                            <i className="fas fa-bell"></i>
                            <span className="notification-badge">3</span>
                        </button>
                        <img src={userProfile?.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80'} alt="Profile" className="profile-avatar" />
                    </div>
                </div>
                <div className="main-nav-row">
                    <div className="orbiter-container">
                        <div className="icon-orbiter">
                            <div className={`option ${activeView === 'for-you' ? 'active' : ''}`} onClick={() => { setActiveView('for-you'); setIsHeaderCollapsed(false); }}>
                                <div className="icon-wrapper"><div className="orbiter-indicator"></div><i className="fa-solid fa-star"></i></div>
                                <span className="text-label">For You</span>
                            </div>
                            <div className={`option ${activeView === 'messages' ? 'active' : ''}`} onClick={() => { setActiveView('messages'); setIsHeaderCollapsed(false); }}>
                                <div className="icon-wrapper"><div className="orbiter-indicator"></div><i className="fa-solid fa-paper-plane"></i></div>
                                <span className="text-label">Messages</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                {/* Embedded Filter Pills specifically for the For You academic feed */}
                <div className="filter-pills-container">
                    <div className="filter-pills">
                        <div className="chip active">All</div>
                        <div className="chip">Study Groups</div>
                        <div className="chip">Q&A Forum</div>
                        <div className="chip">Miron Tips</div>
                    </div>
                </div>
            </header>

            <div className="content-panel">
                
                {/* --- FOR YOU: THE ACADEMIC SNAP FEED --- */}
                <div id="for-you-view" className={`hub-view feed-container ${activeView === 'for-you' ? 'active' : ''}`} onScroll={handleScroll}>
                    
                    <section className="feed-slide">
                        <div className="card-content-wrapper">
                            <div className="mission-card">
                                <canvas className="stars-canvas"></canvas>
                                <div className="mission-content">
                                    <div className="portal-graphic"><div className="portal-ring"></div></div>
                                    <p className="kicker">// LIVE STUDY GROUP</p>
                                    <h2 className="title">Calculus II: Integrals</h2>
                                    <p style={{color: '#aaa', fontSize: '0.9rem', marginTop: '15px'}}>3 classmates from your department are studying this right now.</p>
                                    <button className="story-cta-btn" style={{ color: 'var(--bg-dark)', background: 'var(--accent-teal)', border: 'none' }}>
                                        Join Session <i className="fas fa-arrow-right"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="feed-slide">
                        <div className="card-content-wrapper">
                            <div className="story-card">
                                <div className="background-image" style={{ backgroundImage: "url('https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=800&q=80')" }}></div>
                                <div className="content-overlay" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.9) 100%)' }}>
                                    <p className="kicker"><i className="fas fa-question-circle"></i> Q&A Forum</p>
                                    <h2 className="title" style={{ color: 'white' }}>How do you derive the Navier-Stokes equations?</h2>
                                    <div style={{display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px'}}>
                                        <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100" style={{width: '28px', height: '28px', borderRadius: '50%', border: '1px solid #42d7b8'}} alt="Asker" />
                                        <span style={{fontSize: '0.85rem', color: '#ccc'}}>Asked by Dawit</span>
                                    </div>
                                    <button className="story-cta-btn" style={{ color: 'white', borderColor: 'rgba(255,255,255,0.3)' }}>
                                        Help a Peer <i className="fas fa-hands-helping"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="feed-slide">
                        <div className="card-content-wrapper">
                            <div className="action-slide-content">
                                <i className="fas fa-brain action-icon"></i>
                                <p className="action-prompt">Miron noticed your mock exam scores in <strong style={{color: 'white'}}>Projectile Motion</strong> are dropping...</p>
                                <button className="action-cta-btn">Review Topic with Miron</button>
                            </div>
                        </div>
                    </section>

                </div>
                <div id="messages-view" className={`hub-view ${activeView === 'messages' ? 'active' : ''}`} onScroll={handleScroll} style={{ overflowY: 'auto', height: '100%' }}>
                    <div className="messages-list">
                        
                        {/* Static Miron Entry (Bot) */}
                        <div className="messages-list-item miron-chat-card" onClick={() => window.dispatchEvent(new CustomEvent('open-full-miron-chat'))}>
                            <div className="miron-avatar-orb">
                                <span className="material-symbols-outlined">auto_awesome</span>
                            </div>
                            <div className="message-info">
                                <div className="name">Miron</div>
                                <div className="typewriter-wrapper">
                                    <span className="typewriter-text">Ask me anything about your courses...</span>
                                    <span className="blinking-cursor"></span>
                                </div>
                            </div>
                        </div>

                        {/* My Notes Entry */}
                        <div className="messages-list-item" style={{ background: 'rgba(66, 215, 184, 0.05)', border: '1px solid rgba(66, 215, 184, 0.2)' }} onClick={() => setIsNotesOpen(true)}>
                            <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: '#42d7b8', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>
                                <i className="fas fa-bookmark"></i>
                            </div>
                            <div className="message-info">
                                <div className="name" style={{ color: '#42d7b8' }}>My Notes</div>
                                <div className="last-message">
                                    {(() => {
                                        const note = conversations.find(c => c.type === 'notes');
                                        if (!note) return 'Save thoughts, files, or links here...';
                                        if (note.last_message_text) return note.last_message_text;
                                        // This is the fallback if text is empty but a file was sent
                                        return '📎 File Attachment';
                                    })()}
                                </div>
                            </div>
                        </div>

                        {conversations.filter(c => c.type !== 'notes').map(chat => {
                                const title = chat.type === 'dm' ? chat.other_user_name : chat.title;
                                const avatar = chat.type === 'dm' ? chat.other_user_avatar : chat.avatar_url;
                                return (
                                    <div className="messages-list-item" key={chat.conversation_id} onClick={() => setActiveChat(chat)}>
                                        <div style={{ position: 'relative' }}>
                                            <img src={avatar || 'https://via.placeholder.com/150'} alt="Avatar" />
                                            {onlineUsers.has(chat.other_user_id) && (
                                                <div style={{ position: 'absolute', bottom: '0', right: '0', width: '12px', height: '12px', background: '#42d7b8', borderRadius: '50%', border: '2px solid #1e1e1e' }}></div>
                                            )}
                                        </div>
                                        <div className="message-info">
                                            <div className="name">{title}</div>
                                            <div className="last-message">{chat.last_message_text || 'No messages yet'}</div>
                                        </div>
                                        <div className="message-meta">
                                            <span>{formatTime(chat.last_message_at)}</span>
                                            {chat.unread_count > 0 && <div className="unread-badge">{chat.unread_count}</div>}
                                        </div>
                                    </div>
                                )
                            })}
                    </div>
                </div>
            </div>
            
            {/* The FAB specifically for the Connect Tab */}
            <div className="connect-fab" onClick={() => setShowDiscovery(true)}>
                <i className="fas fa-comment-medical"></i>
            </div>

            {showDiscovery && (
                <DiscoveryScreen 
                    currentUser={currentUser} 
                    onClose={() => setShowDiscovery(false)} 
                    onStartChat={startDirectMessage} 
                />
            )}

            {activeChat && <UserChat chat={activeChat} currentUser={currentUser} isOnline={onlineUsers.has(activeChat.other_user_id)} onClose={() => { setActiveChat(null); fetchConversations(); }} />}
            {isNotesOpen && <Notes currentUser={currentUser} onClose={() => setIsNotesOpen(false)} />}
        </div>
    );
};

export default Connect;