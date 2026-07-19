import React, { useState, useEffect } from 'react';
import { supabase, usePlatform, getAvatarFallback } from '@linkup-platform/sdk-core';
import QAComposerModal from './QAComposerModal.jsx';
import ReplyFullScreen from './ReplyFullScreen.jsx';
import './ForYouFeed.css';

const ForYouFeed = ({ featuredEvents, handleFeaturedAction }) => {
    const { sessionUser: currentUser, routePayload, clearRoutePayload } = usePlatform();
    const [peerQuestions, setPeerQuestions] = useState([]);
    const [liveSessions, setLiveSessions] = useState([]);
    const [replyTarget, setReplyTarget] = useState(null);
    const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
    const [joiningSquadId, setJoiningSquadId] = useState(null);
    const [activeFilter, setActiveFilter] = useState('All');
    const [toastNotice, setToastNotice] = useState(null);

    useEffect(() => {
        if (toastNotice) {
            const timer = setTimeout(() => setToastNotice(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toastNotice]);

    useEffect(() => {
        if (!currentUser?.id) return;
        
        let debounceTimer;
        const triggerUpdate = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                fetchPeerQuestions();
                fetchLiveSessions();
            }, 600); // Wait for multi-table transactions to settle
        };

        fetchPeerQuestions();
        fetchLiveSessions();
        
        const channel = supabase.channel(`explore_feed_${Date.now()}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_study_sessions' }, triggerUpdate)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'peer_questions' }, triggerUpdate)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, triggerUpdate)
            .subscribe();

        return () => {
            clearTimeout(debounceTimer);
            supabase.removeChannel(channel);
        };
    }, [currentUser?.id]);

    // Handle deep-link scrolling from the Home tab
    useEffect(() => {
        if (routePayload?.action === 'open_explore_item') {
            if (routePayload.target_pill) setActiveFilter(routePayload.target_pill);
            
            if (routePayload.target_id) {
                // Wait for the tab to paint, then seek and scroll securely
                setTimeout(() => {
                    const el = document.getElementById(`feed-item-${routePayload.target_id}`);
                    const container = document.getElementById('connect-explore');
                    
                    if (el && container) {
                        // Surgical math scroll (prevents the whole screen from being pushed up)
                        const containerRect = container.getBoundingClientRect();
                        const elRect = el.getBoundingClientRect();
                        const offset = elRect.top - containerRect.top + container.scrollTop - (containerRect.height / 2) + (elRect.height / 2);
                        
                        container.scrollTo({ top: offset, behavior: 'smooth' });
                        
                        el.classList.add('highlight-feed-item');
                        setTimeout(() => el.classList.remove('highlight-feed-item'), 3000);
                    } else if (el) {
                        // Failsafe
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.classList.add('highlight-feed-item');
                        setTimeout(() => el.classList.remove('highlight-feed-item'), 3000);
                    }
                    clearRoutePayload();
                }, 400); 
            } else {
                clearRoutePayload();
            }
        }
    }, [routePayload, clearRoutePayload]);

    const fetchPeerQuestions = async () => {
        const { data } = await supabase.rpc('get_peer_questions');
        if (data) setPeerQuestions(data);
    };

    const fetchLiveSessions = async () => {
        const { data } = await supabase.rpc('get_live_study_sessions', { req_user_id: currentUser.id });
        if (data) setLiveSessions(data);
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
        
        const { error: rpcError } = await supabase.rpc('join_study_group', { req_conversation_id: squadId, req_user_id: currentUser.id });
        
        setJoiningSquadId(null);
        if (rpcError) {
            setToastNotice(rpcError.message.toLowerCase().includes('ban') ? "You have been banned from this group." : `Cannot join: ${rpcError.message}`);
            return;
        }

        window.dispatchEvent(new CustomEvent('navigate-tab', { 
            detail: { 
                tab: 'connect', 
                payload: { action: 'open_chat', conversation_id: squadId, chat_type: 'group' } 
            } 
        }));
    };

    const filteredQuestions = peerQuestions.filter(q => activeFilter === 'All' || activeFilter === 'Q&A Forum');
    const filteredSessions = liveSessions.filter(s => activeFilter === 'All' || activeFilter === 'Study Groups');
    const filteredAnnouncements = (featuredEvents || []).filter(ev => activeFilter === 'All' || activeFilter === 'Announcements');

    return (
        <div className="explore-feed-section">
            <div className="filter-pills-container explore-pills">
                <div className="filter-pills">
                    {['All', 'Announcements', 'Study Groups', 'Q&A Forum', 'Miron Tips'].map(f => (
                        <div key={f} className={`chip ${activeFilter === f ? 'active' : ''}`} onClick={() => setActiveFilter(f)}>{f}</div>
                    ))}
                </div>
            </div>

            <div className="activity-list-container">
                {/* Featured Events & Announcements */}
                {filteredAnnouncements.map(ev => (
                    <div className="activity-card" id={`feed-item-${ev.id}`} key={ev.id} onClick={() => handleFeaturedAction && handleFeaturedAction(ev)}>
                        {ev.image_url ? (
                            <img src={ev.image_url} alt="Cover" className="activity-image" style={{height: '200px'}} />
                        ) : (
                            <div className="stars-canvas" style={{ height: '200px', background: 'radial-gradient(ellipse at 50% 30%, #1a2c3a 0%, #0f1012 80%)' }}></div>
                        )}
                        <div className="activity-content" style={{borderLeft: `4px solid ${ev.tag_color || 'var(--accent-teal)'}`}}>
                            {ev.tag_text && (
                                <div className="activity-tag" style={{ color: ev.tag_color || 'var(--accent-teal)' }}>
                                    {ev.tag_text}
                                </div>
                            )}
                            <h2 className="activity-headline">{ev.title}</h2>
                            {ev.body && <p className="activity-snippet" style={{ marginTop: '8px' }}>{ev.body}</p>}
                            {ev.button_text && (
                                <button className="claim-btn claimable" style={{marginTop: '1rem', width: '100%', background: 'rgba(255,255,255,0.08)', color: '#fff', border: `1px solid ${ev.button_color || 'rgba(255,255,255,0.2)'}`}}>
                                    {ev.button_text} <i className="fas fa-arrow-right" style={{marginLeft: '6px'}}></i>
                                </button>
                            )}
                        </div>
                    </div>
                ))}

                {/* Live Study Sessions */}
                {filteredSessions.map(session => (
                    <div className="activity-card live-session-card" id={`feed-item-${session.id}`} key={session.id}>
                        <div className="activity-content" style={{borderLeft: 'none'}}>
                            <div className="activity-tag" style={{color: '#ff5f5f'}}>
                                <span className="live-pulse-dot"></span> Live Study Group
                            </div>
                            <h2 className="activity-headline" style={{color: 'var(--accent-teal)'}}>{session.course_name}: {session.lesson_topic}</h2>
                            <p className="activity-snippet">{session.dynamic_message}</p>
                            <button 
                                className="claim-btn claimable" 
                                style={{marginTop: '1rem', width: '100%', background: 'var(--accent-teal)', color: '#000'}}
                                onClick={(e) => handleJoinSquad(session.conversation_id, e)}
                                disabled={joiningSquadId === session.conversation_id}
                            >
                                {joiningSquadId === session.conversation_id ? <i className="fas fa-circle-notch fa-spin"></i> : 'Join Session'}
                            </button>
                        </div>
                    </div>
                ))}

                {/* Dynamic Peer Questions Stream */}
                {filteredQuestions.map(q => (
                    <div className="activity-card" id={`feed-item-${q.id}`} key={q.id}>
                        <div className="activity-content" style={{ borderLeft: `4px solid ${q.asker_id === currentUser.id ? '#9b59b6' : 'var(--accent-teal)'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <div className="activity-tag" style={{ color: q.asker_id === currentUser.id ? '#9b59b6' : 'var(--accent-teal)', marginBottom: 0 }}>
                                    {q.course_tag}
                                </div>
                            </div>
                            <h2 className="activity-headline">{q.title}</h2>
                            <div style={{display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 0'}}>
                                <img src={q.asker_avatar || getAvatarFallback(q.asker_name)} onError={(e) => { e.target.onerror = null; e.target.src = getAvatarFallback(q.asker_name); }} style={{width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover'}} alt="Asker" />
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



                {filteredSessions.length === 0 && filteredQuestions.length === 0 && (
                    <div style={{textAlign: 'center', color: '#666', padding: '2rem 1rem', fontStyle: 'italic', fontSize: '0.85rem'}}>
                        Nothing new to explore in this category right now.
                    </div>
                )}
            </div>

            <div className="explore-fab" onClick={() => setIsQuestionModalOpen(true)}>
                <i className="fas fa-question"></i>
            </div>

            {isQuestionModalOpen && (
                <QAComposerModal 
                    currentUser={currentUser}
                    onClose={() => setIsQuestionModalOpen(false)}
                    onSuccess={(msg) => {
                        setToastNotice(msg);
                        fetchPeerQuestions();
                    }}
                    onError={setToastNotice}
                />
            )}

            {replyTarget && (
                <ReplyFullScreen 
                    replyTarget={replyTarget}
                    onClose={() => setReplyTarget(null)}
                    onSuccess={(msg) => {
                        setToastNotice(msg);
                    }}
                    onError={setToastNotice}
                />
            )}

            {toastNotice && (
                <div className="explore-toast">{toastNotice}</div>
            )}
        </div>
    );
};

export default ForYouFeed;