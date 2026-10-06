import React from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';
import './BottomNavigation.css';

const tabIndex = {
    home: 0,
    discover: 1,
    study: 2,
    connect: 3,
    profile: 4
};

const BottomNavigation = ({ activeTab, setActiveTab, hasActiveLive = false }) => {
    const { t } = usePlatform();

    return (
        <footer className="navigation-magic">
            <nav>
                {/* Mobile Indicator - Moves based on active index (20% width per item) */}
                <div 
                    className="indicator" 
                    style={{ 
                        transform: `translateX(${tabIndex[activeTab] * 100}%)`, 
                        left: '0' 
                    }}
                ></div>

                <li 
                    className={`list ${activeTab === 'home' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('home')}
                >
                    <a>
                        <span className="icon"><i className="fas fa-home"></i></span>
                        <span className="text">{t('nav_home', 'Home')}</span>
                    </a>
                </li>
                
                <li 
                    className={`list ${activeTab === 'discover' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('discover')}
                >
                    <a>
                        <span className="icon"><i className="fas fa-compass"></i></span>
                        <span className="text">{t('nav_discover', 'Discover')}</span>
                    </a>
                </li>

                <li 
                    className={`list ${activeTab === 'study' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('study')}
                >
                    <a>
                        <span className="icon"><i className="fas fa-book-open"></i></span>
                        <span className="text">{t('nav_study', 'Study')}</span>
                    </a>
                </li>

                <li 
                    className={`list ${activeTab === 'connect' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('connect')}
                >
                    <a>
                        <span className="icon">
                            <i className="fas fa-users"></i>
                            {hasActiveLive && (
                                <span className="nav-live-indicator" title="Live Stage Active">
                                    <i className="fas fa-microphone-alt"></i>
                                </span>
                            )}
                        </span>
                        <span className="text">{t('nav_connect', 'Connect')}</span>
                    </a>
                </li>

                <li 
                    className={`list ${activeTab === 'profile' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('profile')}
                >
                    <a>
                        <span className="icon"><i className="fas fa-user"></i></span>
                        <span className="text">{t('nav_profile', 'Profile')}</span>
                    </a>
                </li>
            </nav>
        </footer>
    );
};

export default BottomNavigation;