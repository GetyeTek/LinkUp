import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';
import { fetchLiveNewsFeed } from './api.js';
import TelegramCard from './components/TelegramCard.jsx';
import ExploreTab from './components/ExploreTab.jsx';
import './Discover.css';

const Discover = () => {
    const { shell, user, unreadCount } = usePlatform();
    const onOpenActivity = shell.openActivity;
    const [activeSubTab, setActiveSubTab] = useState('feeds'); // 'feeds' or 'explore'
    
    const [liveNews, setLiveNews] = useState([]);
    const [newsLoading, setNewsLoading] = useState(true);
    
    // Pagination Engine States
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [isFetchingMore, setIsFetchingMore] = useState(false);

    // Ref for the indicator animation
    const navRef = useRef(null);
    const [indicatorStyle, setIndicatorStyle] = useState({});

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

    useEffect(() => {
        const updateIndicator = () => {
            if (navRef.current) {
                const activeEl = navRef.current.querySelector('.nav-item.active');
                if (activeEl && activeEl.offsetWidth > 0) {
                    setIndicatorStyle({
                        width: `${activeEl.offsetWidth}px`,
                        transform: `translateX(${activeEl.offsetLeft}px)`
                    });
                }
            }
        };

        updateIndicator();
        window.addEventListener('resize', updateIndicator);

        // Robust layout observer for when display:none switches to flex (prefetching fix)
        const observer = new ResizeObserver(() => {
            updateIndicator();
        });
        
        if (navRef.current) {
            observer.observe(navRef.current);
        }

        return () => {
            window.removeEventListener('resize', updateIndicator);
            observer.disconnect();
        };
    }, [activeSubTab]);

    // --- SWIPE INTERCEPTOR ---
    useEffect(() => {
        const handleSubSwipe = (e) => {
            const { direction } = e.detail;
            const views = ['feeds', 'explore'];
            const currentIndex = views.indexOf(activeSubTab);
            
            // Intercept the global swipe if we can shift tabs internally
            if (direction === 'left' && currentIndex < views.length - 1) {
                e.preventDefault(); // Stop App.jsx from swiping
                setActiveSubTab(views[currentIndex + 1]);
            } else if (direction === 'right' && currentIndex > 0) {
                e.preventDefault(); // Stop App.jsx from swiping
                setActiveSubTab(views[currentIndex - 1]);
            }
        };
        
        window.addEventListener('app-swipe', handleSubSwipe);
        return () => window.removeEventListener('app-swipe', handleSubSwipe);
    }, [activeSubTab]);

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

            <nav className="discover-sub-nav" ref={navRef}>
                <div 
                    className={`nav-item ${activeSubTab === 'feeds' ? 'active' : ''}`} 
                    onClick={() => setActiveSubTab('feeds')}
                >
                    Feeds
                </div>
                <div 
                    className={`nav-item ${activeSubTab === 'explore' ? 'active' : ''}`} 
                    onClick={() => setActiveSubTab('explore')}
                >
                    Explore <span className="new-content-badge">New</span>
                </div>
                <div className="nav-indicator" style={indicatorStyle}></div>
            </nav>

            {/* Sub Tab: Feeds (Full Immersive Discovery Snap Feed) */}
            <div className={`discover-sub-tab ${activeSubTab === 'feeds' ? 'active' : ''}`} id="discover-feeds">
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
                            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#888' }}>
                                <i className="fas fa-satellite-dish" style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}></i>
                                <p>Scanning frequencies...</p>
                                <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>No live updates found. Make sure the sync worker has run.</p>
                            </div>
                        )
                    )}
                </div>
            </div>

            {/* Sub Tab: Explore */}
            <ExploreTab activeSubTab={activeSubTab} />
        </div>
    );
};

export default Discover;