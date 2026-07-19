import React, { useState, useEffect } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';

const timeAgo = (isoString) => {
    const diff = Math.floor((new Date() - new Date(isoString)) / 60000);
    if (diff < 60) return `${diff}m ago`;
    const hrs = Math.floor(diff/60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs/24)}d ago`;
};

const Home = () => {
    const { shell, user: userProfile, unreadCount } = usePlatform();
    const onOpenActivity = shell.openActivity;
    const [greeting, setGreeting] = useState('Hello');
    const [punctuation, setPunctuation] = useState('.');
    const firstName = userProfile?.full_name?.split(' ')[0] || 'Scholar';
    const avatarUrl = userProfile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userProfile?.full_name || 'Scholar')}&background=1e1e1e&color=42d7b8`;
    const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
    const [isFading, setIsFading] = useState(false);
    
    // Dynamic What's Next Data
    const [whatsNextData, setWhatsNextData] = useState({ live: [], qa: [], events: [], loading: true });
    const [activeHtmlRoom, setActiveHtmlRoom] = useState(null);

    const handleFeaturedAction = (event) => {
        if (event.action_type === 'html_room' && event.html_content) {
            setActiveHtmlRoom(event.html_content);
        } else if (event.action_type === 'external_link' && event.external_url) {
            window.open(event.external_url, '_blank', 'noopener,noreferrer');
        } else if (event.action_type === 'app_route' && event.app_route) {
            window.dispatchEvent(new CustomEvent('navigate-tab', { detail: event.app_route }));
        }
    };

    useEffect(() => {
        if (!userProfile?.id) return;
        let isMounted = true;
        
        const fetchWhatsNextData = () => {
            Promise.all([
                supabase.rpc('get_live_study_sessions', { req_user_id: userProfile.id }),
                supabase.rpc('get_peer_questions'),
                supabase.rpc('get_featured_events')
            ]).then(([liveRes, qaRes, eventsRes]) => {
                if (isMounted) {
                    setWhatsNextData({
                        live: liveRes.data || [],
                        qa: (qaRes.data || []).slice(0, 2),
                        events: eventsRes.data || [],
                        loading: false
                    });
                }
            });
        };

        fetchWhatsNextData();

        let debounceTimer;
        const triggerUpdate = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (isMounted) fetchWhatsNextData();
            }, 600); // 600ms debounce ensures edge functions finish writing all rows
        };

        const channel = supabase.channel(`home_whats_next_${Date.now()}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_study_sessions' }, triggerUpdate)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'peer_questions' }, triggerUpdate)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, triggerUpdate)
            .subscribe();

        return () => {
            isMounted = false;
            clearTimeout(debounceTimer);
            supabase.removeChannel(channel);
        };
    }, [userProfile?.id]);

    const handleWnClick = (filterPill, targetId) => {
        window.dispatchEvent(new CustomEvent('navigate-tab', { 
            detail: { 
                tab: 'connect', 
                payload: { 
                    action: 'open_explore_item', 
                    target_pill: filterPill,
                    target_id: targetId 
                } 
            } 
        }));
    };

    const tasks = [
        { icon: 'fas fa-users', title: 'Physics Study Group', category: 'Collaboration', dueIn: '5d' },
        { icon: 'fas fa-book-open', title: 'Chapter 5 Reading', category: 'Literature', dueIn: '9d' },
        { icon: 'fas fa-flask', title: 'Lab Report Draft', category: 'Chemistry', dueIn: '12d' }
    ];

    useEffect(() => {
        // Dynamic Time-Slipped Greeting Logic
        const currentHour = new Date().getHours();
        if (currentHour >= 0 && currentHour < 4) {
            setGreeting('Burning the midnight oil');
            setPunctuation('?');
        } else if (currentHour >= 4 && currentHour < 7) {
            setGreeting('Starting early');
            setPunctuation('?');
        } else if (currentHour >= 7 && currentHour < 12) {
            setGreeting('Good morning');
            setPunctuation('.');
        } else if (currentHour >= 12 && currentHour < 17) {
            setGreeting('Good afternoon');
            setPunctuation('.');
        } else if (currentHour >= 17 && currentHour < 21) {
            setGreeting('Good evening');
            setPunctuation('.');
        } else {
            setGreeting('Preparing for tomorrow');
            setPunctuation('?');
        }

        // Task Rotation Logic
        const interval = setInterval(() => {
            setIsFading(true);
            setTimeout(() => {
                setCurrentTaskIndex((prev) => (prev + 1) % tasks.length);
                setIsFading(false);
            }, 400);
        }, 4000);

        return () => clearInterval(interval);
    }, []);

    const currentTask = tasks[currentTaskIndex];

    // Dynamic background based on time
    const getHeroImage = () => {
        const h = new Date().getHours();
        if (h < 12) return 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1800&q=80';
        if (h < 18) return 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1800&q=80';
        return 'https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?auto=format&fit=crop&w=1800&q=80';
    };

    return (
        <div className="tab-content active" id="home-content">
            <div className="scrollable-content">
                <div className="hero-wrapper">
<header className="app-header">
                        <div className="welcome-text"><h1>{greeting}, {firstName}{punctuation}</h1></div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <button className="icon-button notification-btn" onClick={onOpenActivity}>
                                <i className="fas fa-bell"></i>
                                {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                            </button>
                            <img 
                                src={avatarUrl} 
                                alt="Profile" 
                                className="profile-avatar" 
                                onClick={() => window.dispatchEvent(new CustomEvent('navigate-tab', { detail: { tab: 'profile' } }))}
                                style={{ cursor: 'pointer' }}
                            />
                        </div>
                    </header>
                    <section 
                        className="welcome-hero" 
                        style={{ backgroundImage: `url('${getHeroImage()}')` }}
                    >
                        <div className="overlay"></div>
                        <div className="hero-summary">
                            <h2>You're on track.</h2>
                            <p>3 tasks are due this week.</p>
                        </div>
                    </section>
                </div>
                
                <div className="page-content">
                    <section className="priority-section">
                        {!userProfile?.class_id ? (
                            <>
                                <h2 className="section-label">Setup</h2>
                                <div className="priority-scroll-wrapper">
                                    <div className="priority-track">
                                                                        <div 
                                    className="priority-card card-base" 
                                    style={{ borderColor: 'var(--accent-teal)', cursor: 'pointer', background: 'rgba(66, 215, 184, 0.05)' }}
                                    onClick={() => window.dispatchEvent(new CustomEvent('navigate-tab', { detail: { tab: 'connect', payload: { action: 'open_classes_tab' } } }))}
                                >
                                    <div>
                                        <div className="card-header">
                                            <i className="fas fa-users-rectangle icon" style={{color: 'var(--accent-teal)'}}></i>
                                            <span className="category" style={{color: 'var(--accent-teal)'}}>Action Required</span>
                                        </div>
                                        <h3 className="title" style={{marginTop: '0.5rem', fontSize: '1.1rem'}}>Link Your Class</h3>
                                    </div>
                                    <div className="countdown" style={{ fontSize: '0.8rem', color: '#aaa', fontWeight: 500, alignSelf: 'flex-start', marginTop: 'auto' }}>Sync Deadlines</div>
                                </div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <h2 className="section-label">Urgent</h2>
                                <div className="priority-scroll-wrapper">
                                    <div className="priority-track">
                                        <a href="#" className="priority-card card-base is-urgent">
                                            <div>
                                                <div className="card-header">
                                                    <i className="fas fa-file-signature icon"></i>
                                                    <span className="category">Exam</span>
                                                </div>
                                                <h3 className="title">Thermodynamics</h3>
                                            </div>
                                            <div className="countdown is-urgent-text">3<span className="label">days</span></div>
                                        </a>
                                        <a href="#" className="priority-card card-base">
                                            <div>
                                                <div className="card-header">
                                                    <i className="fas fa-clipboard-list icon"></i>
                                                    <span className="category">Assignment</span>
                                                </div>
                                                <h3 className="title">Problem Set 5 Due</h3>
                                            </div>
                                            <div className="countdown">7<span className="label">days</span></div>
                                        </a>
                                    </div>
                                </div>
                            </>
                        )}
                    </section>

                    {/* OVERHAULED HIGH-FIDELITY DISCOVERY BAR */}
                    {(!whatsNextData.loading && (whatsNextData.live.length > 0 || whatsNextData.qa.length > 0 || whatsNextData.events.length > 0)) && (
                        <section className="discovery-section">
                            <div className="section-label-row">
                                <h2 className="section-label" style={{margin: 0}}>Discover</h2>
                                <button 
                                    className="view-all-link" 
                                    style={{background: 'none', border: 'none', cursor: 'pointer'}}
                                    onClick={() => handleWnClick('All', null)}
                                >
                                    See All
                                </button>
                            </div>

                            <div className="discovery-scroll-container">
                                {/* Featured Announcements */}
                                {whatsNextData.events.map(ev => (
                                    <div key={ev.id} className="premium-announcement-card" onClick={() => handleFeaturedAction(ev)}>
                                        {ev.image_url ? (
                                            <div className="pac-bg" style={{ backgroundImage: `url(${ev.image_url})` }}></div>
                                        ) : (
                                            <div className="pac-bg stars-canvas" style={{ background: 'radial-gradient(ellipse at 50% 30%, #1a2c3a 0%, #0f1012 80%)' }}></div>
                                        )}
                                        <div className="pac-overlay">
                                            {ev.tag_text && <span className="pac-tag" style={{ color: ev.tag_color || 'var(--accent-teal)' }}>{ev.tag_text}</span>}
                                            <h3 className="pac-title">{ev.title}</h3>
                                            <div className="pac-footer">
                                                <span>{ev.button_text || 'View'}</span>
                                                <i className="fas fa-arrow-right"></i>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {/* The Live Orb */}
                                {whatsNextData.live.length > 0 && (
                                    <div 
                                        className="live-orb-wrapper" 
                                        onClick={() => handleWnClick('Study Groups', whatsNextData.live[0].id)}
                                    >
                                        <div className="live-orb-outer-ring">
                                            <div className="orb-halo-ring"></div>
                                            <div className="orb-halo-ring" style={{animationDelay: '0.8s'}}></div>
                                            <div className="orb-live-badge">LIVE</div>
                                            <div className="live-orb">
                                                <i className="fas fa-microphone-alt orb-icon"></i>
                                                <div className="orb-wave-container">
                                                    <svg viewBox="0 0 100 40">
                                                        <path className="wave-line wave-line-sub" d="M10,20 Q25,5 40,20 T70,20 T90,20" />
                                                        <path className="wave-line" d="M10,20 Q25,35 40,20 T70,20 T90,20" />
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="orb-label-title">{whatsNextData.live[0].course_name}</div>
                                        <div className="orb-label-meta">
                                            {whatsNextData.live.length > 1 ? `+${whatsNextData.live.length - 1} other sessions` : `${whatsNextData.live[0].participant_count || 1} attending`}
                                        </div>
                                    </div>
                                )}

                                {/* Premium Q&A Glass Cards */}
                                {whatsNextData.qa.map((q, idx) => {
                                    const isTeal = idx % 2 !== 0;
                                    const replyCount = q.replies_count || 0;
                                    return (
                                        <div 
                                            key={q.id} 
                                            className={`premium-qa-card ${isTeal ? 'teal-theme' : ''}`} 
                                            onClick={() => handleWnClick('Q&A Forum', q.id)}
                                        >
                                            <div className="qac-header">
                                                <img src={q.asker_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(q.asker_name || 'U')}&background=1e1e1e&color=42d7b8`} alt="Avatar" className="qac-avatar" />
                                                <div className="qac-user-meta">
                                                    <span className="qac-username">{q.asker_name}</span>
                                                    <span className="qac-time">{timeAgo(q.created_at)}</span>
                                                </div>
                                            </div>
                                            <div className="qac-body">
                                                <h3 className="qac-title">{q.title}</h3>
                                                <p className="qac-snippet">{q.body || 'Tap to view discussion...'}</p>
                                            </div>
                                            <div className="qac-footer">
                                                <span className="qac-tag">{q.course_tag}</span>
                                                <div className="qac-reply-indicator">
                                                    <i className="far fa-comment-dots"></i> {replyCount} replies
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    <section className="whats-next-section">
                        <h2 className="section-label">Up Next</h2>
                        <div className="next-task-container card-base">
                            <div id="next-task-content" className={isFading ? 'is-fading' : ''}>
                                <div className="task-icon"><i className={currentTask.icon}></i></div>
                                <div className="task-details">
                                    <div className="title">{currentTask.title}</div>
                                    <div className="category">{currentTask.category}</div>
                                </div>
                                <div className="task-countdown">{currentTask.dueIn}</div>
                            </div>
                        </div>
                    </section>
                </div>
            </div>

            {/* Sandbox Render Modal */}
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

export default Home;