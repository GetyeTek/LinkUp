import React from 'react';
import './BottomNavigation.css';

const tabIndex = {
    home: 0,
    discover: 1,
    study: 2,
    connect: 3,
    profile: 4
};

const BottomNavigation = ({ activeTab, setActiveTab }) => {
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
                        <span className="text">Home</span>
                    </a>
                </li>
                
                <li 
                    className={`list ${activeTab === 'discover' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('discover')}
                >
                    <a>
                        <span className="icon"><i className="fas fa-compass"></i></span>
                        <span className="text">Discover</span>
                    </a>
                </li>

                <li 
                    className={`list ${activeTab === 'study' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('study')}
                >
                    <a>
                        <span className="icon"><i className="fas fa-book-open"></i></span>
                        <span className="text">Study</span>
                    </a>
                </li>

                <li 
                    className={`list ${activeTab === 'connect' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('connect')}
                >
                    <a>
                        <span className="icon"><i className="fas fa-users"></i></span>
                        <span className="text">Connect</span>
                    </a>
                </li>

                <li 
                    className={`list ${activeTab === 'profile' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('profile')}
                >
                    <a>
                        <span className="icon"><i className="fas fa-user"></i></span>
                        <span className="text">Profile</span>
                    </a>
                </li>
            </nav>
        </footer>
    );
};

export default BottomNavigation;