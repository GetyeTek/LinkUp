import React, { useState } from 'react';
import ForYouFeed from '@linkup/squad/components/ForYouFeed.jsx';
import './ExploreTab.css';

const ExploreTab = ({ activeSubTab }) => {
    const [appsCollapsed, setAppsCollapsed] = useState(false);

    return (
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
            
            <ForYouFeed />
        </div>
    );
};

export default ExploreTab;