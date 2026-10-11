import React, { useState, useEffect } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';

const timeAgo = (isoString) => {
    const diff = Math.floor((new Date() - new Date(isoString)) / 60000);
    if (diff < 60) return `${diff}m ago`;
    const hrs = Math.floor(diff/60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs/24)}d ago`;
};

import { MIRON_AVATAR_URL } from '@linkup-platform/sdk-core';

const Home = () => {
    const { shell, user: userProfile, unreadCount, language, t } = usePlatform();
    const onOpenActivity = shell.openActivity;
    const [greeting, setGreeting] = useState('Hello');
    const [punctuation, setPunctuation] = useState('.');
    const [mironQuery, setMironQuery] = useState('');
    const firstName = userProfile?.full_name?.split(' ')[0] || 'Scholar';
    const avatarUrl = userProfile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userProfile?.full_name || 'Scholar')}&background=1e1e1e&color=42d7b8`;
    const streak = userProfile?.streak ?? userProfile?.current_streak ?? 0;
    // Dynamic Live Stages Data
    const [whatsNextData, setWhatsNextData] = useState({
        live: [],
        loading: true
    });
    const [deadlines, setDeadlines] = useState([]);
    const [selectedDeadline, setSelectedDeadline] = useState(null);

    const formatDeadlineCountdown = (dateString) => {
        if (!dateString) return { num: 0, unit: 'hours left', isUrgent: false };
        const diffMs = new Date(dateString) - new Date();
        const diffHours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
        const isUrgent = diffHours <= 24;

        if (diffHours >= 48) {
            const days = Math.ceil(diffHours / 24);
            return { num: days, unit: days === 1 ? 'day left' : 'days left', isUrgent: false };
        }
        if (diffHours > 0) {
            return { num: diffHours, unit: diffHours === 1 ? 'hour left' : 'hours left', isUrgent };
        }
        const diffMins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
        return { num: diffMins, unit: diffMins === 1 ? 'min left' : 'mins left', isUrgent: true };
    };

    const formatChannelTitle = (name) => {
        if (!name) return 'Class Notice';
        return name
            .replace(/^@/, '')
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase())
            .trim();
    };

    const formatEventDisplayDate = (isoString) => {
        if (!isoString) return '';
        const date = new Date(isoString);
        
        let datePart = '';
        let ethioDateStr = '';
        let westernTime = '';
        let westernHour = 0;
        let minutes = '00';

        try {
            datePart = date.toLocaleDateString('en-GB', { 
                timeZone: 'Africa/Addis_Ababa',
                weekday: 'short',
                day: 'numeric', 
                month: 'short', 
                year: 'numeric' 
            });

            // Native Ethiopian Calendar Resolution
            try {
                const ethioFmt = new Intl.DateTimeFormat('am-ET-u-ca-ethiopic', {
                    timeZone: 'Africa/Addis_Ababa',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                }).format(date);
                // Strip redundant browser-injected era tags (ERA1, ዓ.ም.) to keep it clean, then re-append neatly
                ethioDateStr = ethioFmt.replace(/(ERA1|ዓ\/?\.?ም\.?|AD|CE)/gi, '').trim() + ' ዓ.ም';
            } catch (e) {
                ethioDateStr = '';
            }

            westernTime = date.toLocaleTimeString([], { 
                timeZone: 'Africa/Addis_Ababa',
                hour: 'numeric', 
                minute: '2-digit', 
                hour12: true 
            });
            const parts = new Intl.DateTimeFormat('en-GB', {
                timeZone: 'Africa/Addis_Ababa',
                hour: 'numeric',
                minute: 'numeric',
                hour12: false
            }).formatToParts(date);
            westernHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
            minutes = parts.find(p => p.type === 'minute')?.value || '00';
        } catch (e) {
            return date.toLocaleString();
        }

        // Habesha 12-hour cycle (sunrise 6:00 AM Western = 12:00 Habesha)
        let habeshaHour = (westernHour - 6 + 24) % 12;
        if (habeshaHour === 0) habeshaHour = 12;

        let habeshaPeriod = '';
        if (westernHour >= 6 && westernHour < 12) habeshaPeriod = 'ጠዋት';
        else if (westernHour >= 12 && westernHour < 13) habeshaPeriod = 'ቀትር';
        else if (westernHour >= 13 && westernHour < 18) habeshaPeriod = 'ከሰዓት';
        else if (westernHour >= 18 && westernHour < 23) habeshaPeriod = 'ማታ';
        else habeshaPeriod = 'ሌሊት';

        const displayDate = ethioDateStr ? `${ethioDateStr} (${datePart})` : datePart;
        return `${displayDate} • ${habeshaPeriod} ${habeshaHour}:${minutes} (${westernTime})`;
    };

    useEffect(() => {
        if (!userProfile?.id) return;
        let isMounted = true;
        
        const fetchLiveSessions = () => {
            supabase.rpc('get_live_study_sessions', { req_user_id: userProfile.id })
                .then((liveRes) => {
                    if (isMounted) {
                        setWhatsNextData({
                            live: liveRes.data || [],
                            loading: false
                        });
                    }
                });
        };

        fetchLiveSessions();

        let debounceTimer;
        const triggerUpdate = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (isMounted) fetchLiveSessions();
            }, 600);
        };

        const channel = supabase.channel(`home_live_${Date.now()}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_study_sessions' }, triggerUpdate)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, triggerUpdate)
            .subscribe();

        return () => {
            isMounted = false;
            clearTimeout(debounceTimer);
            supabase.removeChannel(channel);
        };
    }, [userProfile?.id]);

    useEffect(() => {
        if (!userProfile?.id) return;
        supabase.rpc('get_student_upcoming_deadlines')
            .then(({ data, error }) => {
                if (!error && Array.isArray(data)) {
                    setDeadlines(data);
                }
            })
            .catch(() => {});
    }, [userProfile?.id, userProfile?.class_id, userProfile?.registered_with_telegram]);

    useEffect(() => {
        // Dynamic Time-Slipped Gender-Aware Greeting Logic
        const currentHour = new Date().getHours();
        const userSex = userProfile?.sex || 'polite';
        const isAm = (language === 'am');

        if (currentHour >= 0 && currentHour < 4) {
            setGreeting(isAm ? t('greeting_midnight', userSex, 'እኩለ ሌሊት ጥናት ላይ ነህ') : 'Burning the midnight oil');
            setPunctuation('?');
        } else if (currentHour >= 4 && currentHour < 7) {
            setGreeting(isAm ? t('greeting_early', userSex, 'ማለዳ ጀምረሃል') : 'Starting early');
            setPunctuation('?');
        } else if (currentHour >= 7 && currentHour < 12) {
            setGreeting(isAm ? t('greeting_morning', userSex, 'እንደምን አደርክ') : 'Good morning');
            setPunctuation('.');
        } else if (currentHour >= 12 && currentHour < 17) {
            setGreeting(isAm ? t('greeting_afternoon', userSex, 'እንደምን ዋልክ') : 'Good afternoon');
            setPunctuation('.');
        } else if (currentHour >= 17 && currentHour < 21) {
            setGreeting(isAm ? t('greeting_evening', userSex, 'እንደምን አመሸህ') : 'Good evening');
            setPunctuation('.');
        } else {
            setGreeting(isAm ? t('greeting_late', userSex, 'ለነገ እየተዘጋጀህ ነው') : 'Preparing for tomorrow');
            setPunctuation('?');
        }

    }, []);

    // Global Desktop Keyboard Shortcut (Cmd/Ctrl + K to focus AI dock)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                const inputEl = document.querySelector('.home-miron-dock input');
                if (inputEl) {
                    inputEl.focus();
                } else {
                    shell.openMiron();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                            <button 
                                className="header-miron-btn" 
                                onClick={() => shell.openMiron()} 
                                title="Chat with Miron AI"
                            >
                                <img src={MIRON_AVATAR_URL} alt="Miron" className="header-miron-avatar" />
                                <span className="header-miron-pulse"></span>
                            </button>
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
                            <h2>{streak > 0 ? `${streak} Day Streak 🔥` : 'Start Your Streak 🔥'}</h2>
                            <p>{streak > 0 ? 'Your daily learning consistency is on fire.' : 'Complete a study session today to start your streak.'}</p>
                        </div>
                    </section>
                </div>
                
                <div className="page-content">
                    {/* Interactive "Ask Miron" Quick Dock */}
                    <section className="home-miron-dock-section">
                        <div 
                            className="home-miron-dock"
                            onClick={() => !mironQuery.trim() && shell.openMiron()}
                        >
                            <div className="home-miron-orb-wrap">
                                <img src={MIRON_AVATAR_URL} alt="Miron" />
                                <span className="orb-sparkle-dot"><i className="fas fa-sparkles"></i></span>
                            </div>
                            <input 
                                type="text"
                                placeholder={t('miron_dock_placeholder', 'Ask Miron a formula, concept, or question...')}
                                value={mironQuery}
                                onChange={(e) => setMironQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && mironQuery.trim()) {
                                        e.preventDefault();
                                        shell.openMiron(mironQuery.trim(), true);
                                        setMironQuery('');
                                    }
                                }}
                            />
                            <div className="home-miron-dock-right">
                                <span className="home-miron-kbd-hint">Ctrl K</span>
                                {mironQuery.trim() ? (
                                    <button 
                                        className="home-miron-action-btn send"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            shell.openMiron(mironQuery.trim(), true);
                                            setMironQuery('');
                                        }}
                                        title="Send to Miron"
                                    >
                                        <i className="fas fa-arrow-up"></i>
                                    </button>
                                ) : (
                                    <button 
                                        className="home-miron-action-btn voice"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            window.dispatchEvent(new CustomEvent('miron:open-live-session'));
                                        }}
                                        title="Start Voice Session with Miron"
                                    >
                                        <i className="fas fa-microphone"></i>
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="home-miron-quick-chips">
                            <button 
                                type="button"
                                className="miron-chip-btn"
                                onClick={() => shell.openMiron("Explain the key concepts of our current course chapters", true)}
                            >
                                <i className="fas fa-sparkles"></i>
                                <span>Summarize Chapter</span>
                            </button>
                            <button 
                                type="button"
                                className="miron-chip-btn"
                                onClick={() => shell.openMiron("Generate 3 practice quiz questions from my textbooks", true)}
                            >
                                <i className="fas fa-brain"></i>
                                <span>Quiz Me</span>
                            </button>
                            <button 
                                type="button"
                                className="miron-chip-btn"
                                onClick={() => window.dispatchEvent(new CustomEvent('navigate-tab', { detail: { tab: 'study' } }))}
                            >
                                <i className="fas fa-bullseye"></i>
                                <span>Recall Training</span>
                            </button>
                        </div>
                    </section>

                    <section className="priority-section">
                        <div className="section-label-row" style={{ padding: 0, marginBottom: '0.75rem' }}>
                            <h2 className="section-label" style={{ margin: 0 }}>{t('coming_up', 'Coming Up')}</h2>
                            {deadlines.length > 0 && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--accent-teal)', fontFamily: 'Roboto Mono, monospace', fontWeight: 600 }}>
                                    {deadlines.length} {deadlines.length === 1 ? 'Deadline Due' : 'Deadlines Due'}
                                </span>
                            )}
                        </div>
                        <div className="priority-scroll-wrapper">
                            <div className="priority-track">
                                {deadlines.length > 0 ? (
                                    deadlines.map(item => {
                                        const countdown = formatDeadlineCountdown(item.event_date);
                                        return (
                                            <div 
                                                key={item.id} 
                                                className={`priority-card card-base ${countdown.isUrgent ? 'is-urgent' : ''}`}
                                                onClick={() => setSelectedDeadline(item)}
                                            >
                                                <div className="card-header">
                                                    <i className={`fas ${item.event_type === 'deadline' ? 'fa-hourglass-half' : 'fa-calendar-day'} icon`}></i>
                                                    <span className="category">{formatChannelTitle(item.channel_name || item.event_type)}</span>
                                                </div>
                                                <h3 className="title">{item.title}</h3>
                                                <div className={`countdown ${countdown.isUrgent ? 'is-urgent-text' : ''}`}>
                                                    {countdown.num}
                                                    <span className="label">{countdown.unit}</span>
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <>
                                        {!userProfile?.class_id && (
                                            <div 
                                                className="promo-card link-class" 
                                                onClick={() => {
                                                    window.dispatchEvent(new CustomEvent('navigate-tab', { 
                                                        detail: { tab: 'connect', payload: { action: 'open_classes_tab' } } 
                                                    }));
                                                }}
                                            >
                                                <div className="promo-icon-wrap" style={{ background: 'rgba(66, 215, 184, 0.15)', color: 'var(--accent-teal)' }}>
                                                    <i className="fas fa-users-rectangle"></i>
                                                </div>
                                                <div>
                                                    <h3 className="promo-title">{t('link_class_title', 'Link Your Class')}</h3>
                                                    <div className="promo-desc">{t('link_class_desc', 'Connect your section to receive automated assignment deadlines and exam countdowns.')}</div>
                                                </div>
                                            </div>
                                        )}
                                        <div className="promo-card video-tour" onClick={() => window.dispatchEvent(new CustomEvent('tour:play-video'))}>
                                            <div className="promo-icon-wrap"><i className="fas fa-play"></i></div>
                                            <div>
                                                <h3 className="promo-title">{t('learn_linkup', 'Learn LinkUp')}</h3>
                                                <div className="promo-desc">{t('learn_linkup_desc', "Watch a quick guided tour of the platform's features.")}</div>
                                            </div>
                                        </div>
                                        <div
                                            className="promo-card credits-mission"
                                            onClick={() => {
                                              window.dispatchEvent(
                                                new CustomEvent('navigate-tab', {
                                                  detail: { tab: 'profile' }
                                                })
                                              );
                                              setTimeout(
                                                () =>
                                                  window.dispatchEvent(
                                                    new CustomEvent('open-mission-control')
                                                  ),
                                                100
                                              );
                                            }}
                                          >
                                            <div className="promo-icon-wrap">
                                              <i className="fas fa-coins"></i>
                                            </div>
                                            <div>
                                              <h3 className="promo-title">{t('earn_credits', 'Earn Credits')}</h3>
                                              <div className="promo-desc">
                                                {t('earn_credits_desc', 'Complete daily missions to collect Credits and unlock perks.')}
                                              </div>
                                            </div>
                                          </div>

                                          <div
                                            className="promo-card buy-premium"
                                            onClick={() => window.dispatchEvent(new CustomEvent('open-premium-modal'))}
                                          >
                                            <span className="premium-badge">PRO</span>
                                            <div className="promo-icon-wrap">
                                              <i className="fas fa-crown"></i>
                                            </div>
                                            <div>
                                              <h3 className="promo-title">{t('linkup_premium', 'LinkUp Premium')}</h3>
                                              <div className="promo-desc">
                                                {t('linkup_premium_desc', 'Unlock unlimited Miron AI, complete Exam Archives, & priority Audio Stages.')}
                                              </div>
                                            </div>
                                          </div>

                                          <div
                                            className="promo-card about-us"
                                            onClick={() => window.dispatchEvent(new CustomEvent('open-support-modal'))}
                                          >
                                            <div className="promo-icon-wrap">
                                              <i className="fas fa-shield-heart"></i>
                                            </div>
                                            <div>
                                              <h3 className="promo-title">{t('about_us', 'Learn About Us')}</h3>
                                              <div className="promo-desc">
                                                {t('about_us_desc', 'Built by students, for students. Discover the team & mission behind LinkUp.')}
                                              </div>
                                            </div>
                                          </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* CONDITIONAL LIVE STAGES CAROUSEL */}
                    {(!whatsNextData.loading && whatsNextData.live.length > 0) && (
                        <section className="discovery-section">
                            <div className="section-label-row">
                                <h2 className="section-label" style={{margin: 0, display: 'flex', alignItems: 'center', gap: '8px'}}>
                                    <span style={{width: '8px', height: '8px', borderRadius: '50%', background: '#ff4757', display: 'inline-block', boxShadow: '0 0 8px #ff4757'}}></span>
                                    {t('live_now', 'Live Now')}
                                </h2>
                                <span style={{fontSize: '0.75rem', color: 'var(--accent-teal)', fontFamily: 'Roboto Mono, monospace', fontWeight: 600}}>
                                    {whatsNextData.live.length === 1 ? '1 Active Room' : `${whatsNextData.live.length} Active Rooms`}
                                </span>
                            </div>

                            <div className="discovery-scroll-container">
                                {whatsNextData.live.map((session) => (
                                    <div 
                                        key={session.id}
                                        className="live-orb-wrapper" 
                                        onClick={() => {
                                            window.dispatchEvent(new CustomEvent('navigate-tab', { 
                                                detail: { 
                                                    tab: 'connect', 
                                                    payload: { action: 'open_chat', conversation_id: session.conversation_id, chat_type: 'group' } 
                                                } 
                                            }));
                                        }}
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
                                        <div className="orb-label-title">{session.course_name || 'Study Room'}</div>
                                        <div className="orb-label-meta">
                                            {session.participant_count ? `${session.participant_count} attending` : 'Join Stage'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                </div>
            </div>




            {selectedDeadline && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', animation: 'fadeIn 0.2s ease-out' }} onClick={() => setSelectedDeadline(null)}>
                    <div style={{ background: 'var(--surface-dark)', border: '1px solid var(--border-color)', borderRadius: '24px', width: '100%', maxWidth: '400px', padding: '1.75rem', boxShadow: '0 25px 60px rgba(0,0,0,0.6)', animation: 'popModal 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                            <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, color: 'var(--accent-teal)', background: 'rgba(66, 215, 184, 0.12)', padding: '3px 8px', borderRadius: '6px' }}>
                                {formatChannelTitle(selectedDeadline.channel_name || selectedDeadline.event_type)}
                            </span>
                            <button className="icon-button" style={{ width: '30px', height: '30px', color: '#888' }} onClick={() => setSelectedDeadline(null)}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', margin: '0 0 10px 0', lineHeight: 1.3 }}>{selectedDeadline.title}</h3>
                        <p style={{ fontSize: '0.88rem', color: '#ccc', lineHeight: 1.6, margin: '0 0 1.5rem 0', whiteSpace: 'pre-wrap' }}>
                            {selectedDeadline.description || 'No additional details provided.'}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)', marginBottom: '1.5rem' }}>
                            <i className="far fa-clock" style={{ color: 'var(--accent-teal)' }}></i>
                            <span style={{ fontSize: '0.82rem', color: '#eee', fontFamily: 'Roboto Mono, monospace', fontWeight: 600 }}>
                                {formatEventDisplayDate(selectedDeadline.event_date)}
                            </span>
                        </div>
                        <button 
                            style={{ width: '100%', background: 'var(--accent-teal)', color: '#0c0c0c', border: 'none', padding: '12px', borderRadius: '12px', fontWeight: 700, fontSize: '0.92rem', cursor: 'pointer', fontFamily: 'Poppins, sans-serif' }}
                            onClick={() => setSelectedDeadline(null)}
                        >
                            Got It
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Home;