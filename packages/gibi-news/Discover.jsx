import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';
import { fetchLiveNewsFeed } from './api.js';
import TelegramCard from './components/TelegramCard.jsx';
import './Discover.css';

const Discover = () => {
    const { shell, user, unreadCount } = usePlatform();
    const onOpenActivity = shell.openActivity;
    
    const [liveNews, setLiveNews] = useState([]);
    const [newsLoading, setNewsLoading] = useState(true);
    
    // Pagination Engine States
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [isFetchingMore, setIsFetchingMore] = useState(false);

    const handleRefresh = async () => {
        setNewsLoading(true);
        setHasMore(true);
        try {
            const data = await fetchLiveNewsFeed(0, 15);
            if (data.news && data.news.length > 0) {
                setLiveNews(data.news);
                if (data.news.length < 15) setHasMore(false);
            } else {
                setLiveNews([]);
                setHasMore(false);
            }
        } catch (err) {
            console.error("Failed to refresh feed:", err);
        } finally {
            setNewsLoading(false);
            if (page !== 0) setPage(0);
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
                        // Safe deduplication to prevent React key collision on rapid scrolling
                        const existingIds = new Set(prev.map(p => p.id));
                        const newItems = data.news.filter(p => !existingIds.has(p.id));
                        return page === 0 ? data.news : [...prev, ...newItems];
                    });
                    // If we received fewer than 15 items, the database is exhausted
                    if (data.news.length < 15) setHasMore(false);
                } else {
                    setHasMore(false);
                }
            } catch (err) {
                console.error("Failed to load live feed:", err);
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
                {/* LIVE SCRAPED TELEGRAM FEED INJECTION */}
                {newsLoading ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--accent-teal)' }}>
                        <i className="fas fa-circle-notch fa-spin fa-2x"></i>
                    </div>
                ) : (
                    liveNews.length > 0 ? (
                        <>
                            {liveNews.map((post, index) => {
                                // Attach the invisible tripwire to the absolute last item in the array
                                if (liveNews.length === index + 1) {
                                    return (
                                        <div key={post.id} ref={lastElementRef}>
                                            <TelegramCard post={post} />
                                        </div>
                                    );
                                }
                                return <TelegramCard key={post.id} post={post} />;
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
        </div>
    );
};

export default Discover;