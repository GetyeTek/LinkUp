import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './Connect.css';
import UserChat from './UserChat.jsx';
import GroupChat from './GroupChat.jsx';
import GroupCreator from './components/GroupCreator.jsx';
import Notes from './Notes.jsx';
import AvatarCropperModal from '../../src/core/components/AvatarCropperModal.jsx';

// Inline Component: User Info Panel
const UserInfoPanel = ({ userId, currentUser, onClose }) => {
    const isMe = userId === currentUser.id;
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [editForm, setEditForm] = useState({ name: '', username: '', bio: '' });
    const [isSaving, setIsSaving] = useState(false);
    const [statusMsg, setStatusMsg] = useState(null); // { text, type }
    const [selectedFile, setSelectedFile] = useState(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        const fetchUser = async () => {
            try {
                let profileData = null;
                
                if (isMe) {
                    // Full access to own profile
                    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
                    profileData = data;
                } else {
                    // Secure RPC access to public fields for peers
                    const { data, error } = await supabase.rpc('get_user_profile_public', { target_user_id: userId });
                    if (!error && data) {
                        profileData = data;
                    }
                }
                
                if (profileData) {
                    setProfile(profileData);
                    setEditForm({ name: profileData.full_name || '', username: profileData.username || '', bio: profileData.bio || '' });
                }
            } catch (err) {
                console.error("Profile fetch error:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchUser();
    }, [userId, isMe]);

    const handleSave = async () => {
        if (!isMe) return;
        setIsSaving(true);
        setStatusMsg(null);
        
        const cleanUsername = editForm.username.toLowerCase().trim();
        
        try {
            const { error } = await supabase.from('profiles').update({
                full_name: editForm.name.trim(),
                username: cleanUsername,
                bio: editForm.bio.trim()
            }).eq('id', currentUser.id);
            
            if (error) throw error;
            setStatusMsg({ text: "Profile updated successfully.", type: "success" });
            setProfile(prev => ({ ...prev, full_name: editForm.name.trim(), username: cleanUsername, bio: editForm.bio.trim() }));
        } catch (err) {
            setStatusMsg({ text: err.message || "Failed to update profile.", type: "error" });
        } finally {
            setIsSaving(false);
        }
    };

    const handleAvatarUpdate = async (blob) => {
        setSelectedFile(null);
        setIsSaving(true);
        setStatusMsg({ text: "Uploading avatar...", type: "success" });
        try {
            const arrayBuffer = await blob.arrayBuffer();
            const filePath = `${currentUser.id}/avatar_${Date.now()}.png`;
            const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, arrayBuffer, { contentType: 'image/png', upsert: true });
            if (uploadError) throw uploadError;
            
            const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
            await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', currentUser.id);
            setProfile(prev => ({ ...prev, avatar_url: publicUrl }));
            setStatusMsg({ text: "Avatar updated!", type: "success" });
        } catch (err) {
            setStatusMsg({ text: "Failed to upload avatar.", type: "error" });
        } finally {
            setIsSaving(false);
        }
    };

    const navigateToSettings = () => {
        onClose();
        window.dispatchEvent(new CustomEvent('navigate-tab', { detail: { tab: 'profile' } }));
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('open-profile-editor'));
        }, 100); // Slight delay ensures tab switches before overlay triggers
    };

    if (loading) return (
        <div className="user-info-overlay" style={{alignItems: 'center', justifyContent: 'center'}}>
            <i className="fas fa-circle-notch fa-spin" style={{fontSize: '2rem', color: 'var(--accent-teal)'}}></i>
        </div>
    );

    if (!profile) return (
        <div className="user-info-overlay" style={{alignItems: 'center', justifyContent: 'center'}}>
            <p style={{color: '#888'}}>User not found.</p>
            <button className="ui-back" style={{position: 'static', marginTop: '1rem'}} onClick={onClose}><i className="fas fa-arrow-left"></i></button>
        </div>
    );

    const hasChanges = isMe && (editForm.name !== profile.full_name || editForm.username !== profile.username || editForm.bio !== (profile.bio || ''));

    return (
        <div className="user-info-overlay">
            {selectedFile && (
                <AvatarCropperModal 
                    imageFile={selectedFile} 
                    onCancel={() => setSelectedFile(null)} 
                    onSave={handleAvatarUpdate}
                />
            )}
            <div className="ui-hero">
                <button className="ui-back" onClick={onClose} disabled={isSaving}><i className="fas fa-chevron-left"></i></button>
                <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={(e) => {
                    if (e.target.files && e.target.files[0]) setSelectedFile(e.target.files[0]);
                    e.target.value = null;
                }} />
                <div className="ui-avatar-container" onClick={() => isMe && fileInputRef.current?.click()} style={{cursor: isMe ? 'pointer' : 'default'}}>
                    <div className="ui-avatar">
                        <img src={profile.avatar_url || 'https://via.placeholder.com/150'} alt="Avatar" />
                    </div>
                    {isMe && <div className="ui-avatar-edit"><i className="fas fa-pencil"></i></div>}
                </div>
            </div>
            <div className="ui-body">
                <div className="ui-input-group">
                    <label>Full Name</label>
                    <input 
                        type="text" 
                        className="ui-input" 
                        value={isMe ? editForm.name : profile.full_name} 
                        onChange={e => setEditForm({...editForm, name: e.target.value})} 
                        disabled={!isMe || isSaving} 
                    />
                </div>
                <div className="ui-input-group">
                    <label>Username</label>
                    <div className="handle-input-wrapper status-idle" style={{background: !isMe ? 'transparent' : '', borderColor: !isMe ? 'transparent' : '', paddingLeft: !isMe ? '0' : ''}}>
                        <span className="handle-prefix">@</span>
                        <input 
                            type="text" 
                            value={isMe ? editForm.username : profile.username} 
                            onChange={e => setEditForm({...editForm, username: e.target.value})} 
                            disabled={!isMe || isSaving} 
                            style={{background: 'transparent', border: 'none', color: '#fff', outline: 'none', width: '100%', padding: '12px 8px', fontSize: isMe ? '1rem' : '1.1rem', fontWeight: !isMe ? '500' : 'normal'}}
                        />
                    </div>
                </div>

                <div className="ui-input-group">
                    <label>About</label>
                    {isMe ? (
                        <>
                            <textarea 
                                className="ui-textarea" 
                                placeholder="Write a short bio..."
                                value={editForm.bio}
                                onChange={e => setEditForm({...editForm, bio: e.target.value})}
                                disabled={isSaving}
                                maxLength={150}
                                rows={3}
                            />
                            <div className="bio-char-count">{editForm.bio.length}/150</div>
                        </>
                    ) : (
                        <div className="ui-bio-text">
                            {profile.bio ? profile.bio : <span style={{color: '#666', fontStyle: 'italic'}}>No bio provided.</span>}
                        </div>
                    )}
                </div>

                {statusMsg && <div className={`ui-status-text ${statusMsg.type}`}>{statusMsg.text}</div>}

                {isMe && hasChanges && (
                    <button className="ui-save-btn" onClick={handleSave} disabled={isSaving || !editForm.name.trim() || !editForm.username.trim()}>
                        {isSaving ? <i className="fas fa-circle-notch fa-spin"></i> : "Save Changes"}
                    </button>
                )}

                <div style={{marginTop: '1rem'}}>
                    {profile.department && (
                        <div className="ui-meta-card">
                            <div className="ui-meta-icon"><i className="fas fa-graduation-cap"></i></div>
                            <div className="ui-meta-info">
                                <h4>Academic Program</h4>
                                <p>{profile.department}</p>
                            </div>
                        </div>
                    )}
                </div>

                {isMe && (
                    <button className="ui-full-settings-btn" onClick={navigateToSettings}>
                        <i className="fas fa-sliders-h"></i> Full Account & Registry Settings
                    </button>
                )}
            </div>
        </div>
    );
};

// Inline Component: Global Network Search
const GlobalSearchOverlay = ({ currentUser, onClose, onSelectUser, onSelectGroup }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);

    useEffect(() => {
        if (!query.trim()) {
            setResults([]);
            return;
        }
        const fetchSearch = async () => {
            setIsSearching(true);
            const { data, error } = await supabase.rpc('global_network_search', { search_term: query.trim(), req_user_id: currentUser.id });
            if (data) setResults(data);
            setIsSearching(false);
        };
        const timer = setTimeout(fetchSearch, 400); // Debounce typing
        return () => clearTimeout(timer);
    }, [query, currentUser.id]);

    return (
        <div className="global-search-overlay">
            <header className="gs-header">
                <button className="icon-button" onClick={onClose}><i className="fas fa-chevron-left"></i></button>
                <div className="gs-input-box">
                    <i className="fas fa-search"></i>
                    <input 
                        type="text" 
                        className="gs-input" 
                        placeholder="Search names, usernames, or groups..." 
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        autoFocus
                    />
                    {isSearching && <i className="fas fa-circle-notch fa-spin" style={{color: 'var(--accent-teal)'}}></i>}
                </div>
            </header>
            <div className="gs-body">
                {query.trim() && results.length === 0 && !isSearching && (
                    <div className="not-found-state">
                        <i className="fas fa-search-minus" style={{fontSize: '2rem', display: 'block', marginBottom: '10px'}}></i>
                        No users or groups found matching "{query}".
                    </div>
                )}
                {results.map(res => (
                    <div className="gs-result-item" key={res.id + res.type} onClick={() => {
                        onClose();
                        if (res.type === 'user') onSelectUser({ id: res.id, full_name: res.title, username: res.subtitle, avatar_url: res.avatar_url });
                        else onSelectGroup({ conversation_id: res.id, type: 'group', title: res.title, metadata: res.metadata, is_preview: !res.is_member });
                    }}>
                        {res.type === 'user' ? (
                            <img src={res.avatar_url || 'https://via.placeholder.com/150'} className="gs-avatar" alt="Avatar" />
                        ) : (
                            <div className="gs-icon-avatar"><i className="fas fa-users"></i></div>
                        )}
                        <div className="gs-info">
                            <div className="gs-name">{res.title}</div>
                            <div className="gs-meta">{res.type === 'user' ? `@${res.subtitle}` : res.subtitle}</div>
                        </div>
                        <div className={`gs-status ${!res.is_member ? 'unjoined' : ''}`}>
                            {res.type === 'user' ? (res.is_member ? 'Connected' : 'Connect') : (res.is_member ? 'Joined' : 'Join')}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Inline Component: Discovery Screen
const DiscoveryScreen = ({ currentUser, onClose, onStartChat, onOpenSearch }) => {
    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchDiscovery = async () => {
            const { data } = await supabase.rpc('get_social_discovery', { req_user_id: currentUser.id });
            if (data) setSuggestions(data);
            setLoading(false);
        };
        fetchDiscovery();
    }, [currentUser.id]);

    return (
        <div className="discovery-screen">
            <header className="discovery-header">
                <button className="icon-button" onClick={onClose} style={{color: 'white'}}>
                    <i className="fas fa-chevron-left"></i>
                </button>
                <h2>Discover Peers</h2>
                <button className="icon-button" onClick={onOpenSearch} style={{color: 'white'}}>
                    <i className="fas fa-search"></i>
                </button>
            </header>

            <div className="discovery-body">
                <div className="add-friend-trigger" onClick={onOpenSearch}>
                    <div className="icon-box"><i className="fas fa-search"></i></div>
                    <div>
                        <div style={{fontSize: '1rem'}}>Global Search</div>
                        <div style={{fontSize: '0.75rem', color: '#888', fontWeight: '400'}}>Find users or public groups</div>
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
        </div>
    );
};

const Connect = () => {
    const { shell, user: userProfile, sessionUser: currentUser, unreadCount, routePayload, clearRoutePayload } = usePlatform();
    const [forwardTargetMsg, setForwardTargetMsg] = useState(null);
    const [forwardSourceChat, setForwardSourceChat] = useState(null);
    const [toastNotice, setToastNotice] = useState(null);
    const [viewingUserId, setViewingUserId] = useState(null);
    const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);

    useEffect(() => {
        if (toastNotice) {
            const timer = setTimeout(() => setToastNotice(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toastNotice]);
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
    const [joiningSquadId, setJoiningSquadId] = useState(null);
    const [globalNotice, setGlobalNotice] = useState(null);
    const activeChatRef = useRef(null);
    
    // Q&A State
    const [peerQuestions, setPeerQuestions] = useState([]);
    const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
    const [qForm, setQForm] = useState({ title: '', body: '', course: '' });
    const [replyTarget, setReplyTarget] = useState(null); // holds question object for full-screen reply
    const [replyText, setReplyText] = useState('');
    const [isSubmittingQA, setIsSubmittingQA] = useState(false);
    const [targetMessageId, setTargetMessageId] = useState(null); // Deep link scroller
    
    // Featured Events State
    
    // Featured Events & Live Sessions
    const [featuredEvents, setFeaturedEvents] = useState([]);
    const [activeHtmlRoom, setActiveHtmlRoom] = useState(null);
    const [liveSessions, setLiveSessions] = useState([]);

    useEffect(() => {
        activeChatRef.current = activeChat;
    }, [activeChat]);

    useEffect(() => {
        if (!currentUser) return;
        
        // --- DEEP LINK INTERCEPTOR & SLUG RESOLVER ---
        const params = new URLSearchParams(window.location.search);
        const rawSquadId = params.get('squad');
        const shortSqCode = params.get('sq');
        
        const resolveSquad = async () => {
            let targetId = rawSquadId;
            
            if (shortSqCode) {
                // 1. Try to find by friendly slug first
                const { data: slugData } = await supabase.from('conversations')
                    .select('id')
                    .eq('metadata->>slug', shortSqCode)
                    .single();
                    
                if (slugData) {
                    targetId = slugData.id;
                } else {
                    // 2. Fallback decoding for old Base62 UUIDs (Backward Compatibility)
                    try {
                        let base64 = shortSqCode.replace(/-/g, '+').replace(/_/g, '/');
                        while(base64.length % 4) base64 += '=';
                        const hex = Array.from(atob(base64)).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
                        const decodedId = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
                        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decodedId)) {
                            targetId = decodedId;
                        }
                    } catch (e) {}
                }
            }

            if (targetId) {
                // Strip the param cleanly from URL
                window.history.replaceState({}, document.title, window.location.href.split('?')[0]);
                
                // Fetch and open the squad
                const { data } = await supabase.from('conversations').select('*').eq('id', targetId).single();
                if (data && data.type === 'group') {
                    setActiveChat({
                        conversation_id: data.id,
                        type: 'group',
                        title: data.title,
                        metadata: data.metadata,
                        is_preview: true
                    });
                }
            }
        };

        if (rawSquadId || shortSqCode) resolveSquad();
        
        // Handle Inbound Deep Links from Notifications
        if (routePayload && routePayload.action === 'open_chat') {
            setActiveView('messages');
            
            // Setup Ghost UI instantly to block glitches
            setActiveChat({
                conversation_id: routePayload.conversation_id,
                type: routePayload.chat_type,
                title: 'Loading...',
                is_preview: true
            });
            setTargetMessageId(routePayload.message_id);

            // Fetch true context silently
            supabase.rpc('get_user_conversations', { req_user_id: currentUser.id }).then(({data}) => {
                if (data) {
                    const c = data.find(x => x.conversation_id === routePayload.conversation_id);
                    if (c) setActiveChat(c);
                }
            });
            clearRoutePayload();
        }

        fetchConversations();
        fetchSuggestedSquads();
        fetchPeerQuestions();
        fetchFeaturedEvents();
        fetchLiveSessions();
        
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

        // Explicitly untrack to instantly kill global online ghosts
        const handleBeforeUnload = () => {
            presenceChannel.untrack();
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            presenceChannel.untrack(); // Force drop presence
            supabase.removeChannel(msgChannel);
            supabase.removeChannel(presenceChannel);
        };
    }, [currentUser]);

    // --- SWIPE INTERCEPTOR ---
    useEffect(() => {
        const handleSubSwipe = (e) => {
            const { direction } = e.detail;
            const views = ['for-you', 'messages', 'squads'];
            const currentIndex = views.indexOf(activeView);
            
            // Intercept the global swipe if we can shift tabs internally
            if (direction === 'left' && currentIndex < views.length - 1) {
                e.preventDefault(); // Stop App.jsx from swiping
                setActiveView(views[currentIndex + 1]);
            } else if (direction === 'right' && currentIndex > 0) {
                e.preventDefault(); // Stop App.jsx from swiping
                setActiveView(views[currentIndex - 1]);
            }
        };
        
        window.addEventListener('app-swipe', handleSubSwipe);
        return () => window.removeEventListener('app-swipe', handleSubSwipe);
    }, [activeView]);

    const fetchConversations = async () => {
        const { data, error } = await supabase.rpc('get_user_conversations', { req_user_id: currentUser.id });
        
        if (error) {
            console.error("[Connect:Fetch] RPC Error:", error);
            return;
        }

        if (data) {
            const activeId = activeChatRef.current?.conversation_id;
            // Force unread_count to 0 for the currently open chat to prevent ghost flashes
            setConversations(data.map(c => 
                c.conversation_id === activeId ? { ...c, unread_count: 0 } : c
            ));
        }
    };

    const fetchSuggestedSquads = async () => {
        const { data, error } = await supabase.rpc('get_suggested_squads', { req_user_id: currentUser.id });
        if (data) setSuggestedSquads(data);
        if (error) console.error("Error fetching suggestions:", error);
    };

    const fetchPeerQuestions = async () => {
        const { data, error } = await supabase.rpc('get_peer_questions');
        if (data) setPeerQuestions(data);
    };

    const fetchFeaturedEvents = async () => {
        const { data } = await supabase.rpc('get_featured_events');
        if (data) setFeaturedEvents(data);
    };

    const fetchLiveSessions = async () => {
        const { data } = await supabase.rpc('get_live_study_sessions', { req_user_id: currentUser.id });
        if (data) setLiveSessions(data);
    };

    const handleFeaturedAction = (event) => {
        if (event.action_type === 'html_room' && event.html_content) {
            setActiveHtmlRoom(event.html_content);
        } else if (event.action_type === 'external_link' && event.external_url) {
            window.open(event.external_url, '_blank', 'noopener,noreferrer');
        } else if (event.action_type === 'app_route' && event.app_route) {
            window.dispatchEvent(new CustomEvent('navigate-tab', { detail: event.app_route }));
        }
    };

    const handlePostQuestion = async () => {
        if (!qForm.title.trim() || !qForm.course) return;
        setIsSubmittingQA(true);
        const { error } = await supabase.from('peer_questions').insert({
            user_id: currentUser.id,
            title: qForm.title.trim(),
            body: qForm.body.trim(),
            course_tag: qForm.course
        });
        setIsSubmittingQA(false);
        if (error) {
            setGlobalNotice("Failed to post question: " + error.message);
        } else {
            setToastNotice("Question posted securely.");
            setIsQuestionModalOpen(false);
            setQForm({ title: '', body: '', course: '' });
            fetchPeerQuestions();
        }
    };

    const handleSendReply = async () => {
        if (!replyText.trim() || !replyTarget) return;
        setIsSubmittingQA(true);
        const { error } = await supabase.rpc('reply_to_peer_question', {
            req_question_id: replyTarget.id,
            req_reply_text: replyText.trim()
        });
        setIsSubmittingQA(false);
        if (error) {
            setGlobalNotice("Failed to route reply: " + error.message);
        } else {
            setToastNotice("Reply sent to their DMs!");
            setReplyTarget(null);
            setReplyText('');
            // Optional: redirect to messages so they see the DM thread created
            setActiveView('messages');
            fetchConversations();
        }
    };

    const timeAgo = (isoString) => {
        const diff = Math.floor((new Date() - new Date(isoString)) / 60000);
        if (diff < 60) return `${diff}m ago`;
        const hrs = Math.floor(diff/60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs/24)}d ago`;
    };

    const handleJoinSquad = async (squadId, e) => {
        if (e) e.stopPropagation();
        setJoiningSquadId(squadId);
        
        const joinedSquadInfo = suggestedSquads.find(s => s.conversation_id === squadId) || {};
        
        const { error: rpcError } = await supabase.rpc('join_study_group', { req_conversation_id: squadId, req_user_id: currentUser.id });
        
        if (rpcError) {
            setGlobalNotice(rpcError.message.toLowerCase().includes('ban') ? "You have been banned from this group and cannot rejoin." : `Cannot join: ${rpcError.message}`);
            setJoiningSquadId(null);
            return;
        }

        // Ironclad Verification: Catch silent RLS failures or function exits
        const { data: verifyData } = await supabase.from('conversation_members')
            .select('role')
            .eq('conversation_id', squadId)
            .eq('user_id', currentUser.id)
            .maybeSingle();

        if (!verifyData) {
            setGlobalNotice("Join rejected. You have been banned by the group administrators.");
            setJoiningSquadId(null);
            return;
        }

        await fetchConversations();
        await fetchSuggestedSquads();
        
        setJoiningSquadId(null);
        
        setActiveChat(prev => {
            if (prev && prev.conversation_id === squadId) {
                return { ...prev, is_preview: false };
            }
            return {
                conversation_id: squadId,
                type: 'group',
                title: joinedSquadInfo.title || 'Squad',
                metadata: joinedSquadInfo.metadata || {}
            };
        });
    };

    const startDirectMessage = (targetUser) => {
        // 1. Check if DM already exists locally
        const existing = conversations.find(c => c.type === 'dm' && c.other_user_id === targetUser.id);
        
        setShowDiscovery(false);

        if (existing) {
            setActiveChat(existing);
            setConversations(prev => prev.map(c => c.conversation_id === existing.conversation_id ? { ...c, unread_count: 0 } : c));
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

    const handleExecuteForward = async (targetChat) => {
        if (targetChat === 'miron') {
            shell.openMiron(forwardTargetMsg.text);
            setForwardTargetMsg(null);
            return;
        }

        // Chain forwarding meta or create fresh
        let meta = forwardTargetMsg.forward_meta;
        if (!meta) {
            meta = {
                original_sender_id: forwardTargetMsg.sender_id,
                original_sender_name: forwardTargetMsg.resolved_sender_name || 'Unknown',
                original_sender_avatar: forwardTargetMsg.resolved_sender_avatar || '',
                original_conversation_id: forwardSourceChat.conversation_id,
                original_conversation_title: forwardSourceChat.type === 'dm' ? 'Direct Message' : forwardSourceChat.title
            };
        }
        
        // Optimistically drop out of forward mode and open target
        setActiveChat(targetChat);
        setForwardTargetMsg(null);

        const { error } = await supabase.from('messages').insert({
            conversation_id: targetChat.conversation_id,
            sender_id: currentUser.id,
            text: forwardTargetMsg.text,
            attachments: forwardTargetMsg.attachments,
            forward_meta: meta
        });

        if (error) {
            setGlobalNotice(`Forwarding blocked: ${error.message}`);
        } else {
            setToastNotice("Message forwarded");
        }
    };
    
    const handleChatClick = (chat) => {
        if (forwardTargetMsg) {
            handleExecuteForward(chat);
        } else {
            setActiveChat(chat);
            setConversations(prev => prev.map(c => c.conversation_id === chat.conversation_id ? { ...c, unread_count: 0 } : c));
        }
    };

    const handleOriginClick = async (meta) => {
        if (meta.original_conversation_id && meta.original_conversation_title !== 'Direct Message') {
            const { data } = await supabase.from('conversations').select('*').eq('id', meta.original_conversation_id).single();
            if (data) {
                if (data.metadata?.privacy === 'private') {
                    const { data: mem } = await supabase.from('conversation_members').select('id').eq('conversation_id', data.id).eq('user_id', currentUser.id).maybeSingle();
                    if (!mem) {
                        setGlobalNotice("This is a private group. You don't have access.");
                        return;
                    }
                }
                setActiveChat({
                    conversation_id: data.id,
                    type: 'group',
                    title: data.title,
                    metadata: data.metadata,
                    is_preview: true
                });
            }
        } else if (meta.original_sender_id) {
            setViewingUserId(meta.original_sender_id);
        } else {
            setGlobalNotice("This user account has been deleted.");
        }
    };

    return (
        <div className={`tab-content active ${isHeaderCollapsed ? 'header-collapsed' : ''} ${activeView === 'for-you' ? 'for-you-active' : ''}`} id="connect-content">
            <header className="interactive-header">
                {forwardTargetMsg && !activeChat && (
                    <div className="forward-mode-banner">
                        <span>Forward to...</span>
                        <button onClick={() => setForwardTargetMsg(null)}><i className="fas fa-times"></i></button>
                    </div>
                )}
                <div className="large-title-row">
                    <h2 className="large-title">Social Hub</h2>
                    <div className="header-actions">
                        <button className="icon-button" onClick={() => setIsGlobalSearchOpen(true)}>
                            <i className="fas fa-search"></i>
                        </button>
                        <button className="icon-button notification-btn" onClick={onOpenActivity}>
                            <i className="fas fa-bell"></i>
                            {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                        </button>
                        <img src={userProfile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userProfile?.full_name || 'Scholar')}&background=1e1e1e&color=42d7b8`} alt="Profile" className="profile-avatar" />
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
                                <span className="text-label">Groups</span>
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
                        
                        {/* Dynamic Peer Questions Stream */}
                        {peerQuestions.map(q => (
                            <div className="activity-card" key={q.id}>
                                <div className="activity-content" style={{ borderLeft: `4px solid ${q.asker_id === currentUser.id ? '#9b59b6' : 'var(--accent-teal)'}` }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                        <div className="activity-tag" style={{ color: q.asker_id === currentUser.id ? '#9b59b6' : 'var(--accent-teal)', marginBottom: 0 }}>
                                            {q.course_tag}
                                        </div>
                                    </div>
                                    <h2 className="activity-headline">{q.title}</h2>
                                    <div style={{display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 0'}}>
                                        <img src={q.asker_avatar || 'https://via.placeholder.com/150'} style={{width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover'}} alt="Asker" />
                                        <span style={{fontSize: '0.8rem', color: '#888'}}>
                                            {q.asker_id === currentUser.id ? 'Asked by You' : `Asked by ${q.asker_name}`} • {timeAgo(q.created_at)}
                                        </span>
                                    </div>
                                    {q.body && <p className="activity-snippet">{q.body}</p>}
                                    {q.asker_id !== currentUser.id && (
                                        <button className="claim-btn claimable" style={{marginTop: '1rem'}} onClick={() => setReplyTarget(q)}>
                                            Reply <i className="fas fa-reply" style={{marginLeft: '6px'}}></i>
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}

                        <div className="squads-delimiter"><span>Campus Highlights</span></div>

                        {/* Dynamic Live Study Sessions computed via Miron & Proximity RPC */}
                        {liveSessions.map(session => (
                            <div className="activity-card" key={session.session_id}>
                                <div className="activity-content" style={{borderLeft: '4px solid var(--accent-teal)'}}>
                                    <div className="activity-tag">Live Study Group</div>
                                    <h2 className="activity-headline">{session.course_name}: {session.lesson_topic}</h2>
                                    <p className="activity-snippet">{session.dynamic_message}</p>
                                    <button 
                                        className="claim-btn claimable" 
                                        style={{marginTop: '1rem', width: '100%'}}
                                        onClick={(e) => handleJoinSquad(session.conversation_id, e)}
                                        disabled={joiningSquadId === session.conversation_id}
                                    >
                                        {joiningSquadId === session.conversation_id ? <i className="fas fa-circle-notch fa-spin"></i> : 'Join Session'}
                                    </button>
                                </div>
                            </div>
                        ))}

                    </div>
                </div>
                {/* --- SQUADS: STUDY GROUPS TAB --- */}
                <div id="squads-view" className={`hub-view ${activeView === 'squads' ? 'active' : ''}`} onScroll={handleScroll} style={{ overflowY: 'auto', height: '100%', padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: '600' }}>Your Groups</h3>
                        <button style={{ background: 'var(--accent-teal)', color: '#000', border: 'none', padding: '8px 16px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer' }} onClick={() => setIsGroupCreatorOpen(true)}>
                            <i className="fas fa-plus"></i> New Group
                        </button>
                    </div>
                    <div className="messages-list" style={{ padding: 0 }}>
                        {conversations.filter(c => c.type === 'group').length === 0 && suggestedSquads.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#666', padding: '3rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
                                <i className="fas fa-users-slash" style={{fontSize: '2.5rem', opacity: 0.5}}></i>
                                <p style={{margin: 0, fontSize: '0.95rem'}}>You don't have any active groups and there are no suggestions available right now.</p>
                                <p style={{margin: 0, fontSize: '0.85rem', fontStyle: 'italic'}}>Be the first to create a group and invite your peers!</p>
                            </div>
                        ) : (
                            <>
                                {conversations.filter(c => c.type === 'group').length === 0 ? (
                                    <div style={{ textAlign: 'center', color: '#666', padding: '2rem 1rem', fontStyle: 'italic', fontSize: '0.85rem' }}>
                                        You haven't joined any groups yet.
                                    </div>
                                ) : (
                                    conversations.filter(c => c.type === 'group').map(chat => (
                                        <div className="messages-list-item" key={chat.conversation_id} onClick={() => handleChatClick(chat)}>
                                            <div style={{ width: '50px', height: '50px', borderRadius: '14px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: 'var(--accent-teal)' }}>
                                                <i className="fas fa-users"></i>
                                            </div>
                                            <div className="message-info">
                                                <div className="name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    {chat.title} 
                                                    {chat.metadata?.focus && <span style={{ fontSize: '0.65rem', background: 'rgba(66, 215, 184, 0.1)', color: 'var(--accent-teal)', padding: '2px 6px', borderRadius: '4px' }}>{chat.metadata.focus}</span>}
                                                </div>
                                                <div className="last-message">{chat.last_message_text || 'Group established'}</div>
                                            </div>
                                            <div className="message-meta">
                                                <span>{formatTime(chat.last_message_at)}</span>
                                            </div>
                                        </div>
                                    ))
                                )}

                                <div className="squads-delimiter"><span>Suggested Groups</span></div>
                                
                                {suggestedSquads.length > 0 ? (
                                    suggestedSquads.map(chat => (
                                        <div className="messages-list-item suggested" key={chat.conversation_id} onClick={() => {
                                            if (forwardTargetMsg) {
                                                setToastNotice("You must join this group first to forward messages.");
                                                return;
                                            }
                                            if (chat.metadata?.privacy === 'private') {
                                                setGlobalNotice("This group is private. You need an invite link to join.");
                                                return;
                                            }
                                            setActiveChat({
                                                conversation_id: chat.conversation_id,
                                                type: 'group',
                                                title: chat.title,
                                                metadata: chat.metadata,
                                                is_preview: true
                                            });
                                        }}>
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
                                            <button className="squad-join-btn" style={{ minWidth: '70px', textAlign: 'center' }} onClick={(e) => handleJoinSquad(chat.conversation_id, e)} disabled={joiningSquadId === chat.conversation_id}>
                                                {joiningSquadId === chat.conversation_id ? <i className="fas fa-circle-notch fa-spin"></i> : 'Join'}
                                            </button>
                                        </div>
                                    ))
                                ) : (
                                    <div style={{ textAlign: 'center', color: '#666', padding: '1rem', fontStyle: 'italic', fontSize: '0.85rem' }}>
                                        No public groups available right now. Be the first to create one!
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <div id="messages-view" className={`hub-view ${activeView === 'messages' ? 'active' : ''}`} onScroll={handleScroll} style={{ overflowY: 'auto', height: '100%' }}>
                    <div className="messages-list">
                        
                        {/* Static Miron Entry (Bot) */}
                        <div className="messages-list-item miron-chat-card" onClick={() => {
                            if (forwardTargetMsg) handleExecuteForward('miron');
                            else shell.openMiron(null);
                        }}>
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
                        <div className="messages-list-item" style={{ background: 'rgba(66, 215, 184, 0.05)', border: '1px solid rgba(66, 215, 184, 0.2)' }} onClick={() => {
                            if (forwardTargetMsg) {
                                setToastNotice("Feature unavailable: Forwarding directly to Notes pending vault sync.");
                            } else {
                                setIsNotesOpen(true);
                            }
                        }}>
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
                                    <div className="messages-list-item" key={chat.conversation_id} onClick={() => handleChatClick(chat)}>
                                        <div style={{ position: 'relative' }}>
                                            {isDm ? (
                                                <img src={avatar || 'https://via.placeholder.com/150'} alt="Avatar" />
                                            ) : (
                                                <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: 'var(--accent-teal)', border: '1px solid rgba(255,255,255,0.1)' }}>
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
            
            {/* The Shape-Shifting FAB */}
            <div 
                className="connect-fab" 
                style={{ 
                    background: activeView === 'for-you' ? 'var(--purple-glow, #9b59b6)' : 'var(--accent-teal)',
                    color: activeView === 'for-you' ? '#fff' : '#0c0c0c'
                }}
                onClick={() => activeView === 'for-you' ? setIsQuestionModalOpen(true) : setShowDiscovery(true)}
            >
                <i className={`fas ${activeView === 'for-you' ? 'fa-question' : 'fa-comment-medical'}`}></i>
            </div>

            {/* Q&A Composer Modal */}
            {isQuestionModalOpen && (
                <div className="qa-composer-overlay" onClick={() => setIsQuestionModalOpen(false)}>
                    <div className="qa-composer-card" onClick={e => e.stopPropagation()}>
                        <header className="qa-composer-header" style={{ justifyContent: 'flex-start', gap: '1rem' }}>
                            <button className="icon-button" onClick={() => setIsQuestionModalOpen(false)} style={{ color: 'white', opacity: 0.7 }}><i className="fas fa-chevron-left"></i></button>
                            <h2 style={{ fontSize: '1.1rem' }}>Ask a Question</h2>
                        </header>
                        <div className="qa-composer-body">
                            <input 
                                type="text" 
                                className="qa-input-main" 
                                placeholder="What's your main question?" 
                                value={qForm.title}
                                onChange={e => setQForm({...qForm, title: e.target.value})}
                                maxLength={100}
                                autoFocus
                            />
                            <textarea 
                                className="qa-input-details" 
                                placeholder="Add context, formulas, or what you're struggling with (optional)..."
                                value={qForm.body}
                                onChange={e => setQForm({...qForm, body: e.target.value})}
                            ></textarea>
                            <div>
                                <span style={{fontSize: '0.8rem', color: '#888', fontWeight: 600, textTransform: 'uppercase'}}>Select Course Tag</span>
                                <div className="qa-pills-wrap">
                                    {['Physics', 'Chemistry', 'Mathematics', 'Biology', 'CS', 'General'].map(c => (
                                        <div key={c} className={`qa-pill ${qForm.course === c ? 'active' : ''}`} onClick={() => setQForm({...qForm, course: c})}>
                                            {c}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <button 
                                className="ui-save-btn" 
                                disabled={isSubmittingQA || !qForm.title.trim() || !qForm.course}
                                onClick={handlePostQuestion}
                                style={{marginTop: '0.5rem'}}
                            >
                                {isSubmittingQA ? <i className="fas fa-circle-notch fa-spin"></i> : 'Post Question'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Full Screen Reply UI */}
            {replyTarget && (
                <div className="reply-fs-overlay">
                    <header className="reply-fs-header">
                        <button className="icon-button" onClick={() => setReplyTarget(null)}><i className="fas fa-times"></i></button>
                        <h2 style={{color: '#fff', fontSize: '1.1rem', margin: 0}}>Reply to {replyTarget.asker_name}</h2>
                        <button className="icon-button" style={{color: 'var(--accent-teal)'}} onClick={handleSendReply} disabled={isSubmittingQA || !replyText.trim()}>
                            {isSubmittingQA ? <i className="fas fa-circle-notch fa-spin"></i> : <i className="fas fa-paper-plane"></i>}
                        </button>
                    </header>
                    <div className="reply-fs-body">
                        <div className="reply-ref-card">
                            <div className="reply-ref-asker">{replyTarget.course_tag} • Asked by {replyTarget.asker_name}</div>
                            <div className="reply-ref-title">{replyTarget.title}</div>
                            {replyTarget.body && <div className="reply-ref-body">{replyTarget.body}</div>}
                        </div>
                        <textarea 
                            className="reply-textarea" 
                            placeholder="Write your explanation or answer here..."
                            value={replyText}
                            onChange={e => setReplyText(e.target.value)}
                            autoFocus
                        ></textarea>
                    </div>
                </div>
            )}

            {showDiscovery && (
                <DiscoveryScreen 
                    currentUser={currentUser} 
                    onClose={() => setShowDiscovery(false)} 
                    onStartChat={startDirectMessage}
                    onOpenSearch={() => setIsGlobalSearchOpen(true)}
                />
            )}

            {isGlobalSearchOpen && (
                <GlobalSearchOverlay 
                    currentUser={currentUser} 
                    onClose={() => setIsGlobalSearchOpen(false)} 
                    onSelectUser={startDirectMessage} 
                    onSelectGroup={(group) => {
                        if (forwardTargetMsg) {
                            setToastNotice("You must join this group first to forward messages.");
                            return;
                        }
                        setActiveChat(group);
                    }} 
                />
            )}

            {activeChat && activeChat.type === 'dm' && <UserChat chat={activeChat} currentUser={currentUser} targetMessageId={targetMessageId} isOnline={onlineUsers.has(activeChat.other_user_id)} onClose={() => { setActiveChat(null); fetchConversations(); }} onForward={(msg) => { setForwardTargetMsg(msg); setForwardSourceChat(activeChat); setActiveChat(null); }} onOriginClick={handleOriginClick} onOpenUser={(uid) => setViewingUserId(uid)} />}
            {activeChat && activeChat.type === 'group' && <GroupChat chat={activeChat} currentUser={currentUser} targetMessageId={targetMessageId} onClose={() => { setActiveChat(null); fetchConversations(); }} onJoin={handleJoinSquad} isJoining={joiningSquadId === activeChat.conversation_id} onForward={(msg) => { setForwardTargetMsg(msg); setForwardSourceChat(activeChat); setActiveChat(null); }} onOriginClick={handleOriginClick} onOpenUser={(uid) => setViewingUserId(uid)} />}
            {isNotesOpen && <Notes currentUser={currentUser} onClose={() => setIsNotesOpen(false)} />}
            {viewingUserId && <UserInfoPanel userId={viewingUserId} currentUser={currentUser} onClose={() => setViewingUserId(null)} />}
            {isGroupCreatorOpen && <GroupCreator currentUser={currentUser} onClose={() => setIsGroupCreatorOpen(false)} onCreated={() => { setIsGroupCreatorOpen(false); fetchConversations(); }} />}
            
            {toastNotice && (
                <div className="connect-toast">
                    {toastNotice}
                </div>
            )}

            {globalNotice && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', animation: 'fadeInModal 0.2s ease-out' }}>
                    <div style={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', width: '100%', maxWidth: '400px', padding: '1.5rem', boxShadow: '0 25px 50px rgba(0,0,0,0.5)', animation: 'popModal 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', color: '#fff' }}>
                            <i className="fas fa-exclamation-circle" style={{color: '#ffab40', marginRight: '8px'}}></i> Notice
                        </h3>
                        <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>{globalNotice}</p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: 600, fontFamily: 'Poppins, sans-serif', cursor: 'pointer', border: 'none', fontSize: '0.9rem', background: 'var(--accent-teal)', color: '#000' }} onClick={() => setGlobalNotice(null)}>Okay</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Immersive Sandboxed HTML Room Override */}
            {activeHtmlRoom && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: '#0c0c0c', display: 'flex', flexDirection: 'column', animation: 'fadeInModal 0.3s ease-out' }}>
                    <header style={{ padding: '0.8rem 1.2rem', background: '#0c0c0c', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center' }}>
                        <button 
                            onClick={() => setActiveHtmlRoom(null)} 
                            style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '1.2rem', cursor: 'pointer', padding: '5px' }}
                        >
                            <i className="fas fa-chevron-left"></i>
                        </button>
                        <span style={{ marginLeft: '1rem', fontSize: '0.9rem', color: '#888', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px' }}>Platform Activity</span>
                    </header>
                    <iframe 
                        srcDoc={activeHtmlRoom} 
                        sandbox="allow-scripts allow-forms" 
                        style={{ flex: 1, width: '100%', border: 'none' }} 
                        title="LinkUp Sandbox Environment"
                    />
                </div>
            )}
        </div>
    );
};

export default Connect;