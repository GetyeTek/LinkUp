import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import { fetchLiveNewsFeed } from './api.js';
import TelegramCard from './components/TelegramCard.jsx';
import AnnouncementCard from './components/AnnouncementCard.jsx';
import './Discover.css';

const Discover = () => {
    const { shell, user, unreadCount, routePayload, clearRoutePayload, t } = usePlatform();
    const onOpenActivity = shell.openActivity;
    
    const [liveNews, setLiveNews] = useState([]);
    const [featuredEvents, setFeaturedEvents] = useState([]);
    const [activeHtmlRoom, setActiveHtmlRoom] = useState(null);
    const [newsLoading, setNewsLoading] = useState(true);

    // Pagination Engine States
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [isFetchingMore, setIsFetchingMore] = useState(false);

    // 1. Fetch Featured Announcements (Weighted)
    const fetchAnnouncements = useCallback(async () => {
        try {
            const { data, error } = await supabase.rpc('get_featured_events');
            if (!error && data) {
                setFeaturedEvents(data);
            }
        } catch (err) {
            console.warn('[Discover] Failed to fetch featured announcements:', err);
        }
    }, []);

    useEffect(() => {
        fetchAnnouncements();
    }, [fetchAnnouncements]);

    // 2. Fetch Paginated Telegram News Feed
    useEffect(() => {
        let isMounted = true;
        const loadNews = async () => {
            if (page === 0) setNewsLoading(true);
            else setIsFetchingMore(true);

            try {
                const data = await fetchLiveNewsFeed(page, 15);
                if (!isMounted) return;

                if (data.news && data.news.length > 0) {
                    setLiveNews(prev => {
                        const existingIds = new Set(prev.map(p => p.id));
                        const newItems = data.news.filter(p => !existingIds.has(p.id));
                        return page === 0 ? data.news : [...prev, ...newItems];
                    });
                    if (data.news.length < 15) setHasMore(false);
                } else {
                    setHasMore(false);
                }
            } catch (err) {
                console.error('[Discover] Failed to load live feed:', err);
            } finally {
                if (isMounted) {
                    setNewsLoading(false);
                    setIsFetchingMore(false);
                }
            }
        };
        loadNews();
        
        return () => { isMounted = false; };
    }, [page]);

    // 3. Algorithmic Feed Interleaver with Anti-Clumping & Tier Randomization
    const unifiedFeed = useMemo(() => {
        if (!featuredEvents || featuredEvents.length === 0) {
            return liveNews.map(n => ({ type: 'news', data: n, id: `feed-item-${n.id}` }));
        }

        // Shuffle helper: Randomizes posts within the same tier/weight
        const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

        // Filter and shuffle each priority tier
        const tierHigh = shuffle(featuredEvents.filter(e => (e.weight ?? 10) > 80));
        const tierMid = shuffle(featuredEvents.filter(e => (e.weight ?? 10) >= 50 && (e.weight ?? 10) <= 80));
        const tierLow = shuffle(featuredEvents.filter(e => (e.weight ?? 10) >= 30 && (e.weight ?? 10) < 50));
        const tierLowest = shuffle(featuredEvents.filter(e => (e.weight ?? 10) < 30));

        const result = [];
        let newsIdx = 0;

        // Pushes news items up to a specific index
        const pushNewsUntil = (targetCount) => {
            while (newsIdx < targetCount && newsIdx < liveNews.length) {
                result.push({ type: 'news', data: liveNews[newsIdx], id: `feed-item-${liveNews[newsIdx].id}` });
                newsIdx++;
            }
        };

        // Anti-Clumping Helper: Never allows two announcement cards back-to-back
        const pushAnnouncement = (event) => {
            if (result.length > 0 && result[result.length - 1].type === 'announcement' && newsIdx < liveNews.length) {
                result.push({ type: 'news', data: liveNews[newsIdx], id: `feed-item-${liveNews[newsIdx].id}` });
                newsIdx++;
            }
            result.push({ type: 'announcement', data: event, id: `feed-item-${event.id}` });
        };

        // 1. High Priority (> 80): First item at slot 0; remaining high items spaced by news
        if (tierHigh.length > 0) {
            pushAnnouncement(tierHigh.shift());
        }
        while (tierHigh.length > 0) {
            pushNewsUntil(newsIdx + 2);
            pushAnnouncement(tierHigh.shift());
        }

        // 2. Advance to News post #3
        pushNewsUntil(Math.max(newsIdx, 3));

        // 3. Middle Priority (50 - 80): Spaced out by at least 2 news items
        while (tierMid.length > 0) {
            pushAnnouncement(tierMid.shift());
            if (tierMid.length > 0) pushNewsUntil(newsIdx + 2);
        }

        // 4. Advance to News post #7
        pushNewsUntil(Math.max(newsIdx, 7));

        // 5. Low Priority (30 - 49): Spaced out by at least 2 news items
        while (tierLow.length > 0) {
            pushAnnouncement(tierLow.shift());
            if (tierLow.length > 0) pushNewsUntil(newsIdx + 2);
        }

        // 6. Advance to News post #11
        pushNewsUntil(Math.max(newsIdx, 11));

        // 7. Lowest Priority (< 30): Spaced out so they never flood together
        while (tierLowest.length > 0) {
            pushAnnouncement(tierLowest.shift());
            if (tierLowest.length > 0) pushNewsUntil(newsIdx + 2);
        }

        // 8. Append remaining news items
        while (newsIdx < liveNews.length) {
            result.push({ type: 'news', data: liveNews[newsIdx], id: `feed-item-${liveNews[newsIdx].id}` });
            newsIdx++;
        }

        return result;
    }, [liveNews, featuredEvents]);

    // Concept B: Channel Filtering
    const [selectedChannel, setSelectedChannel] = useState('all');

    const filteredFeed = useMemo(() => {
        if (selectedChannel === 'all') return unifiedFeed;
        if (selectedChannel === 'announcements') return unifiedFeed.filter(item => item.type === 'announcement');
        return unifiedFeed.filter(item => item.type === 'news' && (item.data?.channel?.toLowerCase() || '').includes(selectedChannel.toLowerCase()));
    }, [unifiedFeed, selectedChannel]);

    // 4. Deep Link Resolver from Home tab or External routes
    useEffect(() => {
        if (routePayload?.action === 'open_explore_item') {
            const targetId = routePayload.target_id;
            if (targetId) {
                setTimeout(() => {
                    const el = document.getElementById(`feed-item-${targetId}`);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.classList.add('highlight-feed-item');
                        setTimeout(() => el.classList.remove('highlight-feed-item'), 2600);
                    }
                    clearRoutePayload?.();
                }, 300);
            } else {
                clearRoutePayload?.();
            }
        }
    }, [routePayload, clearRoutePayload, unifiedFeed]);

    const handleRefresh = async () => {
        setNewsLoading(true);
        setHasMore(true);
        try {
            await fetchAnnouncements();
            const data = await fetchLiveNewsFeed(0, 15);
            if (data.news && data.news.length > 0) {
                setLiveNews(data.news);
                if (data.news.length < 15) setHasMore(false);
            } else {
                setLiveNews([]);
                setHasMore(false);
            }
        } catch (err) {
            console.error('[Discover] Failed to refresh feed:', err);
        } finally {
            setNewsLoading(false);
            if (page !== 0) setPage(0);
        }
    };

    const handleAnnouncementAction = (event) => {
        if (event.action_type === 'html_room' && event.html_content) {
            setActiveHtmlRoom(event.html_content);
        } else if (event.action_type === 'external_link' && event.external_url) {
            window.open(event.external_url, '_blank', 'noopener,noreferrer');
        } else if (event.action_type === 'app_route' && event.app_route) {
            window.dispatchEvent(new CustomEvent('navigate-tab', { detail: event.app_route }));
        }
    };

    // Smooth Intersection Observer (Fires 600px BEFORE reaching the bottom)
    const observer = useRef();
    const lastElementRef = useCallback(node => {
        if (newsLoading || isFetchingMore) return;
        if (observer.current) observer.current.disconnect();
        
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) {
                setPage(prevPage => prevPage + 1);
            }
        }, { rootMargin: '600px' }); 
        
        if (node) observer.current.observe(node);
    }, [newsLoading, isFetchingMore, hasMore]);

    return (
        <div className="tab-content active" id="discover-content">
            <header id="discover-header">
                <h1 className="discover-title">{t('nav_discover', 'Discover')}</h1>
                <div className="header-actions">
                    <button 
                        className="header-miron-btn" 
                        onClick={() => shell.openMiron()} 
                        title="Chat with Miron AI"
                    >
                        <img src="https://linkup-gateway.getyeteklu2.workers.dev/storage/v1/object/public/avatars/Miron/20260706_101739.png" alt="Miron" className="header-miron-avatar" />
                        <span className="header-miron-pulse"></span>
                    </button>
                    <button className="icon-button notification-btn" onClick={onOpenActivity}>
                        <i className="fas fa-bell"></i>
                        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                    </button>
                    <img 
                        src={user?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.full_name || 'Scholar')}&background=1e1e1e&color=42d7b8`} 
                        alt="Profile" 
                        className="profile-avatar" 
                        onClick={() => window.dispatchEvent(new CustomEvent('navigate-tab', { detail: { tab: 'profile' } }))}
                        style={{ cursor: 'pointer' }}
                    />
                </div>
            </header>

            <div className="discover-workspace">
                <div className="feed-container">
                    {newsLoading ? (
                        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--accent-teal)' }}>
                            <i className="fas fa-circle-notch fa-spin fa-2x"></i>
                        </div>
                    ) : (
                        filteredFeed.length > 0 ? (
                            <>
                                {filteredFeed.map((item, index) => {
                                    const isLast = filteredFeed.length === index + 1;
                                    const content = item.type === 'announcement' ? (
                                        <AnnouncementCard 
                                            key={item.id} 
                                            event={item.data} 
                                            onAction={handleAnnouncementAction} 
                                        />
                                    ) : (
                                        <TelegramCard 
                                            key={item.id} 
                                            post={item.data} 
                                        />
                                    );

                                    if (isLast) {
                                        return (
                                            <div key={item.id} ref={lastElementRef}>
                                                {content}
                                            </div>
                                        );
                                    }
                                    return content;
                                })}
                                
                                {isFetchingMore && (
                                    <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--accent-teal)' }}>
                                        <i className="fas fa-circle-notch fa-spin fa-lg"></i>
                                    </div>
                                )}
                                
                                {!hasMore && (
                                    <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#888', fontStyle: 'italic', fontSize: '0.85rem' }}>
                                        <i className="fas fa-check-circle" style={{marginBottom: '0.5rem', display: 'block', color: 'var(--accent-teal)'}}></i>
                                        You're all caught up.
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '3rem 1.5rem', color: '#aaa', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(66, 215, 184, 0.1)', color: 'var(--accent-teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', marginBottom: '0.5rem', boxShadow: '0 0 20px rgba(66, 215, 184, 0.15)' }}>
                                    <i className="fas fa-sparkles"></i>
                                </div>
                                <h3 style={{ color: '#fff', fontSize: '1.25rem', margin: 0, fontWeight: 600 }}>{t('all_caught_up_excl', "You're all caught up!")}</h3>
                                <p style={{ fontSize: '0.85rem', color: '#888', maxWidth: '300px', lineHeight: 1.5, margin: '4px 0 1rem 0' }}>
                                    {selectedChannel !== 'all' ? 'No updates in this channel right now.' : "No new posts right now. We'll bring you the latest campus announcements as soon as they drop."}
                                </p>
                                <button 
                                    onClick={handleRefresh}
                                    style={{
                                        background: 'rgba(66, 215, 184, 0.1)',
                                        border: '1px solid var(--accent-teal)',
                                        color: 'var(--accent-teal)',
                                        padding: '10px 22px',
                                        borderRadius: '12px',
                                        fontSize: '0.85rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        transition: 'all 0.2s ease',
                                        fontFamily: 'Poppins, sans-serif'
                                    }}
                                >
                                    <i className="fas fa-rotate-right"></i> {t('check_updates', 'Check for Updates')}
                                </button>
                            </div>
                        )
                    )}
                </div>

                {/* Concept B: Desktop Editorial Sidebar */}
                <aside className="discover-desktop-sidebar">
                    <div className="dds-card filter-card">
                        <h3 className="dds-title"><i className="fas fa-layer-group"></i> Feed Channels</h3>
                        <div className="dds-channels-list">
                            <button 
                                className={`dds-channel-btn ${selectedChannel === 'all' ? 'active' : ''}`}
                                onClick={() => setSelectedChannel('all')}
                            >
                                <div className="dds-ch-left">
                                    <span className="dds-ch-icon all"><i className="fas fa-globe"></i></span>
                                    <span>All Updates</span>
                                </div>
                                <span className="dds-ch-count">{unifiedFeed.length}</span>
                            </button>

                            <button 
                                className={`dds-channel-btn ${selectedChannel === 'announcements' ? 'active' : ''}`}
                                onClick={() => setSelectedChannel('announcements')}
                            >
                                <div className="dds-ch-left">
                                    <span className="dds-ch-icon ann"><i className="fas fa-bullhorn"></i></span>
                                    <span>Announcements</span>
                                </div>
                                <span className="dds-ch-count">{featuredEvents.length}</span>
                            </button>

                            <button 
                                className={`dds-channel-btn ${selectedChannel === 'tikvah' ? 'active' : ''}`}
                                onClick={() => setSelectedChannel('tikvah')}
                            >
                                <div className="dds-ch-left">
                                    <span className="dds-ch-icon tg"><i className="fab fa-telegram-plane"></i></span>
                                    <span>Tikvah University</span>
                                </div>
                                <span className="dds-ch-badge">Live</span>
                            </button>
                        </div>
                    </div>

                    <div className="dds-card info-card">
                        <div className="dds-info-header">
                            <span className="dds-pulse-dot"></span>
                            <h4>Live Campus Feed</h4>
                        </div>
                        <p className="dds-desc">
                            Real-time notices syndicated from official campus channels and verified academic bulletins.
                        </p>
                        <button className="dds-refresh-btn" onClick={handleRefresh} disabled={newsLoading}>
                            <i className={`fas fa-rotate-right ${newsLoading ? 'fa-spin' : ''}`}></i>
                            <span>Check for Updates</span>
                        </button>
                    </div>

                    <div className="dds-card dispatch-card">
                        <h4>Got News or Event Tips?</h4>
                        <p>Share verified notices or department updates with the LinkUp student community.</p>
                        <a 
                            href="https://t.me/linkupregistrationbot" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="dds-dispatch-link"
                        >
                            <i className="fab fa-telegram"></i> Submit to Dispatch
                        </a>
                    </div>
                </aside>
            </div>

            {/* Embedded HTML Room Sandbox Modal */}
            {activeHtmlRoom && (
                <div className="sandbox-modal-overlay">
                    <header className="sandbox-modal-header">
                        <button className="icon-button" onClick={() => setActiveHtmlRoom(null)}>
                            <i className="fas fa-chevron-left"></i>
                        </button>
                        <span className="sandbox-modal-title">Campus Announcement</span>
                    </header>
                    <iframe
                        srcDoc={activeHtmlRoom}
                        sandbox="allow-scripts allow-forms"
                        className="sandbox-iframe"
                        title="Announcement Detail"
                    />
                </div>
            )}
        </div>
    );
};

export default Discover;