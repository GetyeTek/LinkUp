import React, { useState, useEffect, useRef } from 'react';
// We need to import ColorThief if we want that logic, but for React it's better to use a library or skip for now.
// Keeping structure identical to original.

const Discover = ({ onOpenActivity }) => {
    const [activeSubTab, setActiveSubTab] = useState('explore'); // 'explore' or 'feeds'
    const [appsCollapsed, setAppsCollapsed] = useState(false);
    
    // Ref for the indicator animation
    const navRef = useRef(null);
    const [indicatorStyle, setIndicatorStyle] = useState({});

    useEffect(() => {
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
                        <span className="notification-badge">3</span>
                    </button>
                    <img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto-format&fit=crop&w=80&q=80" alt="Profile" className="profile-avatar" />
                </div>
            </header>

            <nav className="discover-sub-nav" ref={navRef}>
                <div 
                    className={`nav-item ${activeSubTab === 'explore' ? 'active' : ''}`} 
                    onClick={() => setActiveSubTab('explore')}
                >
                    Explore
                </div>
                <div 
                    className={`nav-item ${activeSubTab === 'feeds' ? 'active' : ''}`} 
                    onClick={() => setActiveSubTab('feeds')}
                >
                    Feeds <span className="new-content-badge">New</span>
                </div>
                <div className="nav-indicator" style={indicatorStyle}></div>
            </nav>

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

            {/* Sub Tab: Feeds (Now Traditional News Feed) */}
            <div className={`discover-sub-tab ${activeSubTab === 'feeds' ? 'active' : ''}`} id="discover-feeds">
                <div className="news-feed-container">
                    
                    <div className="news-card">
                        <img src="https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=800&q=80" className="news-image" alt="Campus News" />
                        <div className="news-content">
                            <div className="news-tag">Campus Bulletin</div>
                            <h2 className="news-headline">New AI Research Lab Opens at Addis Ababa University</h2>
                            <p className="news-snippet">The new facility will provide students with state-of-the-art GPUs for machine learning research and data science.</p>
                        </div>
                    </div>

                    <div className="news-card">
                        <img src="https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=800&q=80" className="news-image" alt="Tech Trends" />
                        <div className="news-content">
                            <div className="news-tag">Global Tech Trends</div>
                            <h2 className="news-headline">Quantum Computing Breakthrough Achieved</h2>
                            <p className="news-snippet">Researchers have successfully entangled particles over a record distance, paving the way for next-generation encryption.</p>
                        </div>
                    </div>
                    
                    <div className="news-card">
                        <div className="news-content" style={{borderLeft: '4px solid var(--accent-teal)'}}>
                            <div className="news-tag">GibiNews Announcement</div>
                            <h2 className="news-headline">LinkUp Study Groups are now Live!</h2>
                            <p className="news-snippet">Welcome to the new era of academic networking. Head over to the Connect tab to join live study sessions with your peers.</p>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default Discover;