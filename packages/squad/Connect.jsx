import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './Connect.css';
import UserChat from './UserChat.jsx';
import GroupChat from './GroupChat.jsx';
import GroupCreator from './components/GroupCreator.jsx';
import Notes from './Notes.jsx';
import UserInfoPanel from './components/UserInfoPanel.jsx';
import GlobalSearchOverlay from './components/GlobalSearchOverlay.jsx';
import DiscoveryScreen from './components/DiscoveryScreen.jsx';
import QAComposerModal from './components/QAComposerModal.jsx';
import ReplyFullScreen from './components/ReplyFullScreen.jsx';

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
    const [mountedChats, setMountedChats] = useState({});
    const [activeChatId, setActiveChatId] = useState(null);
    const [isNotesOpen, setIsNotesOpen] = useState(false);
    const [isGroupCreatorOpen, setIsGroupCreatorOpen] = useState(false);
    const [conversations, setConversations] = useState([]);
    const [suggestedSquads, setSuggestedSquads] = useState([]);
    const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
    const [showDiscovery, setShowDiscovery] = useState(false);
    const [onlineUsers, setOnlineUsers] = useState(new Set());
    const [joiningSquadId, setJoiningSquadId] = useState(null);
    const [globalNotice, setGlobalNotice] = useState(null);
    const [presenceSynced, setPresenceSynced] = useState(false);
    const activeChatRef = useRef(null);
    
    // Q&A State
    const [peerQuestions, setPeerQuestions] = useState([]);
    const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
    const [replyTarget, setReplyTarget] = useState(null); // holds question object for full-screen reply
    const [targetMessageId, setTargetMessageId] = useState(null); // Deep link scroller
    
    // Featured Events State
    
    // Featured Events & Live Sessions
    const [featuredEvents, setFeaturedEvents] = useState([]);
    const [activeHtmlRoom, setActiveHtmlRoom] = useState(null);
    const [liveSessions, setLiveSessions] = useState([]);

    const isSessionLive = (metadata) => {
        if (!metadata?.is_live) return false;
        
        // 1. Instant Cleanup Hook: If a human host force-closed the app, their global presence drops instantly.
        // We ensure presence has synced at least once to prevent a false-negative flash on page load.
        if (presenceSynced && !metadata.ai_hosting && metadata.live_host_id && !onlineUsers.has(metadata.live_host_id)) {
            return false;
        }

        // 2. Fallback network heartbeat check (5 mins) for Edge Workers (Miron) or minor network drops
        const hb = metadata.live_heartbeat ? new Date(metadata.live_heartbeat).getTime() : Date.now();
        return (Date.now() - hb) <= 5 * 60 * 1000;
    };

    useEffect(() => {
        activeChatRef.current = mountedChats[activeChatId];
    }, [mountedChats, activeChatId]);

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
            
            const ghostChat = {
                conversation_id: routePayload.conversation_id,
                type: routePayload.chat_type,
                title: 'Loading...',
                is_preview: true
            };
            
            setMountedChats(prev => ({ ...prev, [routePayload.conversation_id]: ghostChat }));
            setActiveChatId(routePayload.conversation_id);
            setTargetMessageId(routePayload.message_id);

            // Fetch true context silently
            supabase.rpc('get_user_conversations', { req_user_id: currentUser.id }).then(({data}) => {
                if (data) {
                    const c = data.find(x => x.conversation_id === routePayload.conversation_id);
                    if (c) setMountedChats(prev => ({ ...prev, [c.conversation_id]: c }));
                }
            });
            clearRoutePayload();
        }

        fetchConversations();
        fetchSuggestedSquads();
        fetchPeerQuestions();
        fetchFeaturedEvents();
        fetchLiveSessions();
        
        // 1. Subscribe to Realtime Messages, Read Receipts, and Conversation updates
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
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'conversations'
            }, () => {
                // Instantly update lists when a group goes live, stops, or alters metadata
                fetchConversations();
                fetchSuggestedSquads();
            })
            .subscribe();

        // 2. Global Presence (Who is Online?)
        const presenceChannel = supabase.channel('global_presence', {
            config: { presence: { key: currentUser.id } }
        });
        
        presenceChannel.on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            setOnlineUsers(new Set(Object.keys(state)));
            setPresenceSynced(true);
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
        
        const existingChat = conversations.find(c => c.conversation_id === squadId);
        if (existingChat) {
            setMountedChats(prev => ({
                ...prev,
                [squadId]: { ...existingChat, is_preview: false, auto_join_live: true }
            }));
            setActiveChatId(squadId);
            return;
        }
        setMountedChats(prev => {
            const existing = prev[squadId];
            return {
                ...prev,
                [squadId]: existing 
                    ? { ...existing, is_preview: false, auto_join_live: true } 
                    : { conversation_id: squadId, type: 'group', title: joinedSquadInfo.title || 'Squad', metadata: joinedSquadInfo.metadata || {}, auto_join_live: true }
            };
        });
        setActiveChatId(squadId);
    };

    const startDirectMessage = (targetUser) => {
        const existing = conversations.find(c => c.type === 'dm' && c.other_user_id === targetUser.id);
        setShowDiscovery(false);

        if (existing) {
            setMountedChats(prev => ({ ...prev, [existing.conversation_id]: existing }));
            setActiveChatId(existing.conversation_id);
            setConversations(prev => prev.map(c => c.conversation_id === existing.conversation_id ? { ...c, unread_count: 0 } : c));
        } else {
            const ghostId = `ghost_${targetUser.id}`;
            setMountedChats(prev => ({
                ...prev,
                [ghostId]: {
                    conversation_id: null,
                    type: 'dm',
                    other_user_id: targetUser.id,
                    other_user_name: targetUser.full_name || targetUser.username,
                    other_user_avatar: targetUser.avatar_url,
                    is_ghost: true,
                    ghost_key: ghostId
                }
            }));
            setActiveChatId(ghostId);
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

    const closeChat = (id) => {
        setMountedChats(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
        if (activeChatId === id) setActiveChatId(null);
        fetchConversations();
    };

    const minimizeChat = () => {
        setActiveChatId(null);
    };

    const handleExecuteForward = async (targetChat) => {
        if (targetChat === 'miron') {
            shell.openMiron(forwardTargetMsg.text);
            setForwardTargetMsg(null);
            return;
        }

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
        
        setMountedChats(prev => ({ ...prev, [targetChat.conversation_id]: targetChat }));
        setActiveChatId(targetChat.conversation_id);
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
            setMountedChats(prev => ({ ...prev, [chat.conversation_id]: chat }));
            setActiveChatId(chat.conversation_id);
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
                const originChat = {
                    conversation_id: data.id,
                    type: 'group',
                    title: data.title,
                    metadata: data.metadata,
                    is_preview: true
                };
                setMountedChats(prev => ({ ...prev, [data.id]: originChat }));
                setActiveChatId(data.id);
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
                        <img 
                            src={userProfile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userProfile?.full_name || 'Scholar')}&background=1e1e1e&color=42d7b8`} 
                            alt="Profile" 
                            className="profile-avatar" 
                            onClick={() => window.dispatchEvent(new CustomEvent('navigate-tab', { detail: { tab: 'profile' } }))}
                            style={{ cursor: 'pointer' }}
                        />
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
                                            <div style={{ position: 'relative', width: '50px', height: '50px', flexShrink: 0 }}>
                                                {isSessionLive(chat.metadata) && <div className="list-live-pulse-ring square"></div>}
                                                <div style={{ width: '100%', height: '100%', borderRadius: '14px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: 'var(--accent-teal)', overflow: 'hidden' }}>
                                                    {chat.avatar_url ? <img src={chat.avatar_url} style={{width:'100%', height:'100%', objectFit:'cover'}} alt="Group" /> : <i className="fas fa-users"></i>}
                                                </div>
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
                                            const previewChat = {
                                                conversation_id: chat.conversation_id,
                                                type: 'group',
                                                title: chat.title,
                                                metadata: chat.metadata,
                                                is_preview: true
                                            };
                                            setMountedChats(prev => ({ ...prev, [chat.conversation_id]: previewChat }));
                                            setActiveChatId(chat.conversation_id);
                                        }}>
                                            <div style={{ position: 'relative', width: '50px', height: '50px', flexShrink: 0 }}>
                                                {isSessionLive(chat.metadata) && <div className="list-live-pulse-ring square"></div>}
                                                <div style={{ width: '100%', height: '100%', borderRadius: '14px', background: 'rgba(66, 215, 184, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: 'var(--accent-teal)', overflow: 'hidden' }}>
                                                    {chat.avatar_url ? <img src={chat.avatar_url} style={{width:'100%', height:'100%', objectFit:'cover'}} alt="Group" /> : <i className="fas fa-globe"></i>}
                                                </div>
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
                                        <div style={{ position: 'relative', width: '50px', height: '50px', flexShrink: 0 }}>
                                            {isDm ? (
                                                <img src={avatar || 'https://via.placeholder.com/150'} alt="Avatar" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                                            ) : (
                                                <>
                                                    {isSessionLive(chat.metadata) && <div className="list-live-pulse-ring"></div>}
                                                    <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: 'var(--accent-teal)', border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden', position: 'relative', zIndex: 2 }}>
                                                        {chat.avatar_url ? <img src={chat.avatar_url} style={{width:'100%', height:'100%', objectFit:'cover'}} alt="Group" /> : <i className="fas fa-users"></i>}
                                                    </div>
                                                </>
                                            )}
                                            {isDm && onlineUsers.has(chat.other_user_id) && (
                                                <div style={{ position: 'absolute', bottom: '0', right: '0', width: '12px', height: '12px', background: '#42d7b8', borderRadius: '50%', border: '2px solid #1e1e1e', zIndex: 3 }}></div>
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
                <QAComposerModal 
                    currentUser={currentUser}
                    onClose={() => setIsQuestionModalOpen(false)}
                    onSuccess={(msg) => {
                        setToastNotice(msg);
                        fetchPeerQuestions();
                    }}
                    onError={setGlobalNotice}
                />
            )}

            {/* Full Screen Reply UI */}
            {replyTarget && (
                <ReplyFullScreen 
                    replyTarget={replyTarget}
                    onClose={() => setReplyTarget(null)}
                    onSuccess={(msg) => {
                        setToastNotice(msg);
                        setActiveView('messages');
                        fetchConversations();
                    }}
                    onError={setGlobalNotice}
                />
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
                        setMountedChats(prev => ({ ...prev, [group.conversation_id]: group }));
                        setActiveChatId(group.conversation_id);
                    }} 
                />
            )}

            {Object.entries(mountedChats).map(([id, chat]) => {
                const isHidden = activeChatId !== id;
                if (chat.type === 'dm') {
                    return <UserChat key={id} isHidden={isHidden} chat={chat} currentUser={currentUser} targetMessageId={targetMessageId} isOnline={onlineUsers.has(chat.other_user_id)} onClose={() => closeChat(id)} onForward={(msg) => { setForwardTargetMsg(msg); setForwardSourceChat(chat); minimizeChat(); }} onOriginClick={handleOriginClick} onOpenUser={(uid) => setViewingUserId(uid)} />;
                }
                if (chat.type === 'group') {
                    return <GroupChat key={id} isHidden={isHidden} chat={chat} currentUser={currentUser} targetMessageId={targetMessageId} onClose={() => closeChat(id)} onMinimize={minimizeChat} onJoin={handleJoinSquad} isJoining={joiningSquadId === chat.conversation_id} onForward={(msg) => { setForwardTargetMsg(msg); setForwardSourceChat(chat); minimizeChat(); }} onOriginClick={handleOriginClick} onOpenUser={(uid) => setViewingUserId(uid)} onlineUsers={onlineUsers} presenceSynced={presenceSynced} />;
                }
                return null;
            })}
            
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