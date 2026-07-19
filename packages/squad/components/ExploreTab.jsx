import React, { useState } from 'react';
import ForYouFeed from './ForYouFeed.jsx';
import './ExploreTab.css';

const ExploreTab = ({ activeView, featuredEvents, handleFeaturedAction }) => {
    const [appsCollapsed, setAppsCollapsed] = useState(true);

    return (
        <div className={`hub-view ${activeView === 'explore' ? 'active' : ''}`} id="connect-explore" style={{ overflowY: 'auto', height: '100%' }}>
            
            {featuredEvents && featuredEvents.length > 0 && (
                <section className="featured-events-section" style={{ marginTop: '1.5rem', animation: 'fadeIn 0.5s ease-out' }}>
                    <div style={{ display: 'flex', overflowX: 'auto', gap: '16px', padding: '0 1.5rem 1rem', scrollbarWidth: 'none', scrollSnapType: 'x mandatory' }}>
                        {featuredEvents.map(ev => (
                            <div 
                                key={ev.id} 
                                className="card-content-wrapper" 
                                style={{ flex: '0 0 280px', height: '380px', cursor: 'pointer', scrollSnapAlign: 'start', position: 'relative' }}
                                onClick={() => handleFeaturedAction(ev)}
                            >
                                <div className={ev.image_url ? "story-card" : "mission-card"}>
                                    {ev.image_url ? (
                                        <>
                                            <div className="background-image" style={{ backgroundImage: `url(${ev.image_url})` }}></div>
                                            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.4) 40%, transparent 100%)', zIndex: 1 }}></div>
                                        </>
                                    ) : (
                                        <div className="stars-canvas" style={{ background: 'radial-gradient(ellipse at 50% 30%, #1a2c3a 0%, #0f1012 80%)' }}></div>
                                    )}
                                    <div className="content-overlay" style={{ zIndex: 2 }}>
                                        {ev.tag_text && <div className="kicker" style={{ color: ev.tag_color || 'var(--accent-teal)' }}>{ev.tag_text}</div>}
                                        <h3 className="title" style={{ color: '#fff' }}>{ev.title}</h3>
                                        {ev.body && (
                                            <p style={{ fontSize: '0.9rem', color: '#ccc', marginTop: '10px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4 }}>
                                                {ev.body}
                                            </p>
                                        )}
                                        {ev.button_text && (
                                            <button className="story-cta-btn" style={{ borderColor: ev.button_color || 'rgba(255,255,255,0.2)' }}>
                                                {ev.button_text} <i className="fas fa-arrow-right"></i>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <section className="launcher-section" style={{ paddingTop: featuredEvents && featuredEvents.length > 0 ? '0' : '1.5rem' }}>
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
            
            <ForYouFeed />
        </div>
    );
};

export default ExploreTab;