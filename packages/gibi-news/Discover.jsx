import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';
import { fetchLiveNewsFeed } from './api.js';
import './Discover.css';

const TelegramCard = ({ post }) => {
    const [expanded, setExpanded] = useState(false);
    const cardRef = useRef(null);

    // Auto-collapse logic via Intersection Observer
    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => {
            // If the card is completely out of the viewport and currently expanded, reset it
            if (!entry.isIntersecting && expanded) {
                setExpanded(false);
            }
        }, { threshold: 0 }); // 0 means triggers the moment it's out of view

        if (cardRef.current) observer.observe(cardRef.current);
        return () => observer.disconnect();
    }, [expanded]);

    // Threshold check (250 chars)
    const isLong = post.full_text && post.full_text.length > 250;

    const hasImage = post.image_url || post.media_url || post.photo_url || post.image || post.thumbnail_url;
    const proxyImgUrl = hasImage 
        ? `https://linkup-gateway.getyeteklu2.workers.dev/telegram-image-proxy?channel=${encodeURIComponent(post.channel)}&id=${encodeURIComponent(post.telegram_id)}` 
        : null;
    
    return (
        <div className="telegram-card" ref={cardRef}>
            {proxyImgUrl && (
                <img 
                    src={proxyImgUrl} 
                    alt="News Media" 
                    className="tc-image" 
                    referrerPolicy="no-referrer" 
                />
            )}
            <div className="tc-content">
                <div className="tc-header">
                    <i className="fa-solid fa-satellite-dish"></i> GibiNews
                </div>
                <div className={`tc-text-wrapper ${expanded ? 'expanded' : (isLong ? 'collapsed' : '')}`}>
                    <div className="tc-text">{post.full_text}</div>
                    {!expanded && isLong && <div className="tc-fade"></div>}
                </div>
                {!expanded && isLong && (
                    <button className="tc-show-more" onClick={() => setExpanded(true)}>
                        Show more <i className="fas fa-chevron-down"></i>
                    </button>
                )}
                <div className="tc-footer">
                    <div className="tc-reference">
                        <i className="fa-solid fa-quote-left" style={{fontSize: '0.6rem'}}></i>
                        Ref: {post.channel === 'tikvahuniversity' ? 'Tikvah University' : post.channel}
                    </div>
                    <div className="tc-footer-bottom">
                        <a href={post.post_url} target="_blank" rel="noreferrer" className="tc-link">
                            <i className="fab fa-telegram"></i> Full Post
                        </a>
                        <span className="tc-time">{new Date(post.telegram_timestamp).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const Discover = () => {
    const { shell, user, unreadCount } = usePlatform();
    const onOpenActivity = shell.openActivity;
    const [activeSubTab, setActiveSubTab] = useState('feeds'); // 'feeds' or 'explore'
    const [appsCollapsed, setAppsCollapsed] = useState(false);
    
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
        console.log("%c[GN_Feed] >> Initializing Discovery Feed...", "color: #ffab40; font-family: monospace;");
        // Calculate indicator position
        if (navRef.current) {
            const activeEl = navRef.current.querySelector('.nav-item.active');
            if (activeEl) {
                setIndicatorStyle({
                    width: `${activeEl.offsetWidth}px`,
                    transform: `translateX(${activeEl.offsetLeft}px)`
                });
            }
        }
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
            <div className={`discover-sub-tab ${activeSubTab === 'explore' ? 'active' : ''}`} id="discover-explore">
                <section className="launcher-section">
                    <div className="recents-section">
                        <h3 className="section-title">RECENTS</h3>
                        <div className="launcher-row-wrapper">
                            <div className="launcher-row">
                                <a href="#" className="app-link app-link--recent" style={{ '--stagger-delay': '0.1s' }}>
                                    <div className="icon-wrapper icon-color-1"><i className="fas fa-atom"></i></div>
                                </a>
                                <a href="#" className="app-link app-link--recent" style={{ '--stagger-delay': '0.15s' }}>
                                    <div className="icon-wrapper icon-color-2"><i className="fas fa-chalkboard-user"></i></div>
                                </a>
                                <a href="#" className="app-link app-link--recent" style={{ '--stagger-delay': '0.2s' }}>
                                    <div className="icon-wrapper icon-color-3"><i className="fas fa-calendar-check"></i></div>
                                </a>
                            </div>
                        </div>
                    </div>
                    
                    <div className={`collapsible-section ${appsCollapsed ? 'is-collapsed' : ''}`} id="apps-section">
                        <div className="section-toggle-header" onClick={() => setAppsCollapsed(!appsCollapsed)}>
                            <h3 className="section-title">APPS</h3>
                            <i className="fas fa-chevron-up chevron-icon"></i>
                        </div>
                        <div className="collapsible-content-wrapper">
                            <div className="apps-grid">
                                {[ 
                                    { icon: 'fa-atom', color: 'icon-color-1', label: 'Simulations', delay: '0.25s' },
                                    { icon: 'fa-chalkboard-user', color: 'icon-color-2', label: 'Mentors', delay: '0.3s' },
                                    { icon: 'fa-calendar-check', color: 'icon-color-3', label: 'Events', delay: '0.35s' },
                                    { icon: 'fa-users-rays', color: 'icon-color-4', label: 'Clubs', delay: '0.4s' },
                                    { icon: 'fa-briefcase', color: 'icon-color-5', label: 'Careers', delay: '0.45s' },
                                    { icon: 'fa-book-sparkles', color: 'icon-color-6', label: 'GibiNews', delay: '0.5s' }
                                ].map((app, idx) => (
                                    <a key={idx} href="#" className="app-link app-link--grid" style={{ '--stagger-delay': app.delay }}>
                                        <div className={`icon-wrapper ${app.color}`}><i className={`fas ${app.icon}`}></i></div>
                                        <span className="app-label">{app.label}</span>
                                    </a>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default Discover;