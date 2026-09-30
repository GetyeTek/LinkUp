import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import { fetchLiveNewsFeed } from './api.js';
import TelegramCard from './components/TelegramCard.jsx';
import AnnouncementCard from './components/AnnouncementCard.jsx';
import './Discover.css';

const Discover = () => {
    const { shell, user, unreadCount, routePayload, clearRoutePayload } = usePlatform();
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

    // 3. Algorithmic Feed Interleaver based on Weight Metrics
    const unifiedFeed = useMemo(() => {
        if (!featuredEvents || featuredEvents.length === 0) {
            return liveNews.map(n => ({ type: 'news', data: n, id: `feed-item-${n.id}` }));
        }

        // Tiers:
        // > 80: High priority (top of the feed)
        // 50 - 80: Middle priority (middle of the feed)
        // 30 - 49: Low priority
        // 1 - 29: Lowest priority
        const tierHigh = featuredEvents.filter(e => (e.weight ?? 10) > 80);
        const tierMid = featuredEvents.filter(e => (e.weight ?? 10) >= 50 && (e.weight ?? 10) <= 80);
        const tierLow = featuredEvents.filter(e => (e.weight ?? 10) >= 30 && (e.weight ?? 10) < 50);
        const tierLowest = featuredEvents.filter(e => (e.weight ?? 10) < 30);

        const result = [];
        let newsIdx = 0;

        // 1. High priority items at the very top (index 0)
        tierHigh.forEach(e => result.push({ type: 'announcement', data: e, id: `feed-item-${e.id}` }));

        const pushNewsUntil = (count) => {
            while (newsIdx < count && newsIdx < liveNews.length) {
                result.push({ type: 'news', data: liveNews[newsIdx], id: `feed-item-${liveNews[newsIdx].id}` });
                newsIdx++;
            }
        };

        // 2. First 3 news posts
        pushNewsUntil(3);

        // 3. Middle priority items (weight 50 - 80)
        tierMid.forEach(e => result.push({ type: 'announcement', data: e, id: `feed-item-${e.id}` }));

        // 4. Next news posts up to 7
        pushNewsUntil(7);

        // 5. Low priority items (weight 30 - 49)
        tierLow.forEach(e => result.push({ type: 'announcement', data: e, id: `feed-item-${e.id}` }));

        // 6. Next news posts up to 12
        pushNewsUntil(12);

        // 7. Lowest priority items (weight 1 - 29)
        tierLowest.forEach(e => result.push({ type: 'announcement', data: e, id: `feed-item-${e.id}` }));

        // 8. Remainder of news
        while (newsIdx < liveNews.length) {
            result.push({ type: 'news', data: liveNews[newsIdx], id: `feed-item-${liveNews[newsIdx].id}` });
            newsIdx++;
        }

        return result;
    }, [liveNews, featuredEvents]);

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
                <h1 className="discover-title">Discover</h1>
                <div className="header-actions">
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

            <div className="feed-container">
                {newsLoading ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--accent-teal)' }}>
                        <i className="fas fa-circle-notch fa-spin fa-2x"></i>
                    </div>
                ) : (
                    unifiedFeed.length > 0 ? (
                        <>
                            {unifiedFeed.map((item, index) => {
                                const isLast = unifiedFeed.length === index + 1;
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
                            <h3 style={{ color: '#fff', fontSize: '1.25rem', margin: 0, fontWeight: 600 }}>You're all caught up!</h3>
                            <p style={{ fontSize: '0.85rem', color: '#888', maxWidth: '300px', lineHeight: 1.5, margin: '4px 0 1rem 0' }}>
                                No new posts right now. We'll bring you the latest campus announcements as soon as they drop.
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
                                <i className="fas fa-rotate-right"></i> Check for Updates
                            </button>
                        </div>
                    )
                )}
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