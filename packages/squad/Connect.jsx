import React, { useState, useEffect } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './Connect.css';
import UserChat from './UserChat.jsx';
import GroupChat from './GroupChat.jsx';
import GroupCreator from './components/GroupCreator.jsx';
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
                    <i className="fas fa-chevron-left"></i>
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

const Connect = () => {
    const { shell, user: userProfile, sessionUser: currentUser } = usePlatform();
    const onOpenActivity = shell.openActivity;
    const [activeView, setActiveView] = useState('messages');
    const [activeChat, setActiveChat] = useState(null);
    const [isNotesOpen, setIsNotesOpen] = useState(false);
    const [isGroupCreatorOpen, setIsGroupCreatorOpen] = useState(false);
    const [conversations, setConversations] = useState([]);
    const [suggestedSquads, setSuggestedSquads] = useState([]);
    const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
    const [showDiscovery, setShowDiscovery] = useState(false);
    const [onlineUsers, setOnlineUsers] = useState(new Set());

    useEffect(() => {
        if (!currentUser) return;
        
        fetchConversations();
        fetchSuggestedSquads();
        
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

    const fetchSuggestedSquads = async () => {
        const { data, error } = await supabase.rpc('get_suggested_squads', { req_user_id: currentUser.id });
        if (data) setSuggestedSquads(data);
        if (error) console.error("Error fetching suggestions:", error);
    };

    const handleJoinSquad = async (squadId) => {
        await supabase.rpc('join_study_group', { req_conversation_id: squadId, req_user_id: currentUser.id });
        
        await fetchConversations();
        await fetchSuggestedSquads();
        
        const joinedSquad = suggestedSquads.find(s => s.conversation_id === squadId);
        if (joinedSquad) {
            setActiveChat({
                conversation_id: squadId,
                type: 'group',
                title: joinedSquad.title,
                metadata: joinedSquad.metadata
            });
        }
    };

    const startDirectMessage = (targetUser) => {
        // 1. Check if DM already exists locally
        const existing = conversations.find(c => c.type === 'dm' && c.other_user_id === targetUser.id);
        
        setShowDiscovery(false);

        if (existing) {
            setActiveChat(existing);
        } else {
            // 2. Open as a "Ghost Chat" - No DB entry created yet.
            // We pass the user details so the UI can render, but ID is null.
            setActiveChat({
                conversation_id: null, // Critical: Triggers lazy init on first message
                type: 'dm',
                other_user_id: targetUser.id,
                other_user_name: targetUser.full_name || targetUser.username,
                other_user_avatar: targetUser.avatar_url,
                is_ghost: true
            });
        }
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
                            <div className={`option ${activeView === 'squads' ? 'active' : ''}`} onClick={() => { setActiveView('squads'); setIsHeaderCollapsed(false); }}>
                                <div className="icon-wrapper"><div className="orbiter-indicator"></div><i className="fa-solid fa-layer-group"></i></div>
                                <span className="text-label">Study Groups</span>
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
                
                {/* --- FOR YOU: THE ACADEMIC ACTIVITY FEED (Tweet-style List) --- */}
                <div id="for-you-view" className={`hub-view ${activeView === 'for-you' ? 'active' : ''}`} onScroll={handleScroll} style={{ overflowY: 'auto', height: '100%' }}>
                    <div className="activity-list-container">
                        
                        <div className="activity-card">
                            <div className="activity-content" style={{borderLeft: '4px solid var(--accent-teal)'}}>
                                <div className="activity-tag">Live Study Group</div>
                                <h2 className="activity-headline">Calculus II: Power Series</h2>
                                <p className="activity-snippet">3 classmates from your department are studying this right now. Join and share notes!</p>
                                <button className="claim-btn claimable" style={{marginTop: '1rem', width: '100%'}}>Join Session</button>
                            </div>
                        </div>

                        <div className="activity-card">
                            <div className="activity-content">
                                <div className="activity-tag">Peer Question</div>
                                <h2 className="activity-headline">How do you derive the Navier-Stokes equations?</h2>
                                <div style={{display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 0'}}>
                                    <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100" style={{width: '24px', height: '24px', borderRadius: '50%'}} alt="Asker" />
                                    <span style={{fontSize: '0.8rem', color: '#888'}}>Asked by Dawit</span>
                                </div>
                                <p className="activity-snippet">Struggling with the continuity equation part. Any help?</p>
                            </div>
                        </div>

                        <div className="activity-card">
                            <div className="activity-content" style={{background: 'rgba(66, 215, 184, 0.05)'}}>
                                <div className="activity-tag" style={{color: 'var(--cyber-gold)'}}>Miron Insight</div>
                                <h2 className="activity-headline">Strengthen Projectile Motion</h2>
                                <p className="activity-snippet">I noticed your quiz scores in this topic are dropping. Shall we do a quick 5-minute review?</p>
                            </div>
                        </div>

                        {/* Admin Featured Post 1 */}
                        <div className="activity-card">
                            <img src="https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=800&q=80" className="activity-image" alt="Workshop" />
                            <div className="activity-content">
                                <div className="activity-tag" style={{color: '#ffab40'}}>Featured Event</div>
                                <h2 className="activity-headline">Global Research & Methodology Workshop</h2>
                                <p className="activity-snippet">Join top researchers from across the globe this Friday to learn about the future of STEM. Limited seats available for LinkUp scholars.</p>
                                <button className="claim-btn" style={{marginTop: '1rem', width: '100%', background: '#ffab40', color: '#000'}}>Register Interest</button>
                            </div>
                        </div>

                        {/* Admin Featured Post 2 */}
                        <div className="activity-card">
                            <img src="https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=800&q=80" className="activity-image" alt="Scholarship" />
                            <div className="activity-content">
                                <div className="activity-tag">Admin Update</div>
                                <h2 className="activity-headline">2026 Innovation Scholarships are Open</h2>
                                <p className="activity-snippet">Check your eligibility criteria for this year's regional innovation grants. Applications close in 14 days.</p>
                                <div style={{marginTop: '12px', padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', fontSize: '0.8rem', color: '#888'}}>
                                    <i className="fas fa-paperclip" style={{marginRight: '8px'}}></i> eligibility_guidelines_v2.pdf
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
                {/* --- SQUADS: STUDY GROUPS TAB --- */}
                <div id="squads-view" className={`hub-view ${activeView === 'squads' ? 'active' : ''}`} onScroll={handleScroll} style={{ overflowY: 'auto', height: '100%', padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: '600' }}>Active Squads</h3>
                        <button style={{ background: 'var(--accent-teal)', color: '#000', border: 'none', padding: '8px 16px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer' }} onClick={() => setIsGroupCreatorOpen(true)}>
                            <i className="fas fa-plus"></i> New Group
                        </button>
                    </div>
                    <div className="messages-list" style={{ padding: 0 }}>
                        {conversations.filter(c => c.type === 'group').length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#666', padding: '2rem 1rem' }}>
                                <p style={{fontStyle: 'italic', margin: 0}}>You haven't joined any groups yet.</p>
                            </div>
                        ) : (
                            conversations.filter(c => c.type === 'group').map(chat => (
                                <div className="messages-list-item" key={chat.conversation_id} onClick={() => setActiveChat(chat)}>
                                    <div style={{ width: '50px', height: '50px', borderRadius: '14px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: 'var(--accent-teal)' }}>
                                        <i className="fas fa-users"></i>
                                    </div>
                                    <div className="message-info">
                                        <div className="name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            {chat.title} 
                                            {chat.metadata?.focus && <span style={{ fontSize: '0.65rem', background: 'rgba(66, 215, 184, 0.1)', color: 'var(--accent-teal)', padding: '2px 6px', borderRadius: '4px' }}>{chat.metadata.focus}</span>}
                                        </div>
                                        <div className="last-message">{chat.last_message_text || 'Squad established'}</div>
                                    </div>
                                    <div className="message-meta">
                                        <span>{formatTime(chat.last_message_at)}</span>
                                    </div>
                                </div>
                            ))
                        )}

                        <div className="squads-delimiter"><span>Suggested For You</span></div>
                        {suggestedSquads.length > 0 ? (
                            suggestedSquads.map(chat => (
                                <div className="messages-list-item suggested" key={chat.conversation_id}>
                                    <div style={{ width: '50px', height: '50px', borderRadius: '14px', background: 'rgba(66, 215, 184, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: 'var(--accent-teal)' }}>
                                        <i className="fas fa-globe"></i>
                                    </div>
                                    <div className="message-info">
                                        <div className="name" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#fff' }}>
                                            {chat.title} 
                                            {chat.metadata?.focus && <span style={{ fontSize: '0.65rem', background: 'rgba(255, 255, 255, 0.1)', color: '#ccc', padding: '2px 6px', borderRadius: '4px' }}>{chat.metadata.focus}</span>}
                                        </div>
                                        <div className="last-message" style={{color: '#888'}}>
                                            <i className="fas fa-user" style={{marginRight: '4px'}}></i> {chat.member_count} Members
                                        </div>
                                    </div>
                                    <button className="squad-join-btn" onClick={() => handleJoinSquad(chat.conversation_id)}>Join</button>
                                </div>
                            ))
                        ) : (
                            <div style={{ textAlign: 'center', color: '#666', padding: '1rem', fontStyle: 'italic', fontSize: '0.85rem' }}>
                                No public study groups available right now. Be the first to create one!
                            </div>
                        )}
                    </div>
                </div>

                <div id="messages-view" className={`hub-view ${activeView === 'messages' ? 'active' : ''}`} onScroll={handleScroll} style={{ overflowY: 'auto', height: '100%' }}>
                    <div className="messages-list">
                        
                        {/* Static Miron Entry (Bot) */}
                        <div className="messages-list-item miron-chat-card" onClick={() => shell.openMiron(null)}>
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

                        {conversations
                            .filter(c => c.type === 'dm' || c.type === 'group')
                            .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
                            .map(chat => {
                                const isDm = chat.type === 'dm';
                                const title = isDm ? chat.other_user_name : chat.title;
                                const avatar = isDm ? chat.other_user_avatar : chat.avatar_url;
                                return (
                                    <div className="messages-list-item" key={chat.conversation_id} onClick={() => setActiveChat(chat)}>
                                        <div style={{ position: 'relative' }}>
                                            {isDm ? (
                                                <img src={avatar || 'https://via.placeholder.com/150'} alt="Avatar" />
                                            ) : (
                                                <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justify-content: 'center', fontSize: '1.2rem', color: 'var(--accent-teal)', border: '1px solid rgba(255,255,255,0.1)' }}>
                                                    <i className="fas fa-users"></i>
                                                </div>
                                            )}
                                            {isDm && onlineUsers.has(chat.other_user_id) && (
                                                <div style={{ position: 'absolute', bottom: '0', right: '0', width: '12px', height: '12px', background: '#42d7b8', borderRadius: '50%', border: '2px solid #1e1e1e' }}></div>
                                            )}
                                        </div>
                                        <div className="message-info">
                                            <div className="name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                {title}
                                                {!isDm && chat.metadata?.focus && (
                                                    <span style={{ fontSize: '0.6rem', background: 'rgba(66, 215, 184, 0.1)', color: 'var(--accent-teal)', padding: '1px 5px', borderRadius: '4px', textTransform: 'uppercase' }}>
                                                        {chat.metadata.focus}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="last-message">{chat.last_message_text || (isDm ? 'No messages yet' : 'Squad established')}</div>
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

            {activeChat && activeChat.type === 'dm' && <UserChat chat={activeChat} currentUser={currentUser} isOnline={onlineUsers.has(activeChat.other_user_id)} onClose={() => { setActiveChat(null); fetchConversations(); }} />}
            {activeChat && activeChat.type === 'group' && <GroupChat chat={activeChat} currentUser={currentUser} onClose={() => { setActiveChat(null); fetchConversations(); }} />}
            {isNotesOpen && <Notes currentUser={currentUser} onClose={() => setIsNotesOpen(false)} />}
            {isGroupCreatorOpen && <GroupCreator currentUser={currentUser} onClose={() => setIsGroupCreatorOpen(false)} onCreated={() => { setIsGroupCreatorOpen(false); fetchConversations(); }} />}
        </div>
    );
};

export default Connect;