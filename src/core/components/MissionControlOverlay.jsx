import React, { useState } from 'react';
import './MissionControlOverlay.css';

const MissionControlOverlay = ({ isActive, onClose }) => {
    const [activeMissionTab, setActiveMissionTab] = useState('daily');
    
    return (
        <div className={`fullscreen-overlay ${isActive ? 'is-active' : ''}`} id="mission-overlay">
            <div className="overlay-content">
                <header className="overlay-header">
                    <h2 className="overlay-title">Mission Control</h2>
                    <button className="close-btn" onClick={onClose}><i className="fas fa-times"></i></button>
                </header>
                <div className="overlay-inner-content">
                    <nav className="tasks-nav fade-in-up" style={{ transitionDelay: '0.1s' }}>
                        {['daily', 'weekly', 'milestones'].map(tab => (
                            <div 
                                key={tab} 
                                className={`nav-tab ${activeMissionTab === tab ? 'active' : ''}`} 
                                onClick={() => setActiveMissionTab(tab)}
                            >
                                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                            </div>
                        ))}
                        <div className="nav-indicator" style={{ 
                            width: '33.33%', 
                            transform: `translateX(${activeMissionTab === 'daily' ? '0%' : activeMissionTab === 'weekly' ? '100%' : '200%'})` 
                        }}></div>
                    </nav>
                    <div className="tasks-list-container fade-in-up" style={{ transitionDelay: '0.2s' }}>
                        {activeMissionTab === 'daily' && (
                            <ul className="tasks-list active">
                                <li><div className="task-card"><div className="task-icon"><i className="fas fa-check"></i></div><div className="task-details"><div className="task-title">First of the Day</div></div><div className="task-action"><div className="reward-amount"><i className="fas fa-coins"></i> 50</div><button className="claim-btn claimed"><i className="fas fa-check"></i></button></div></div></li>
                                <li><div className="task-card"><div className="task-icon"><i className="fas fa-lightbulb"></i></div><div className="task-details"><div className="task-title">Quick Quiz</div></div><div className="task-action"><div className="reward-amount"><i className="fas fa-coins"></i> 75</div><button className="claim-btn claimable">Claim</button></div></div></li>
                            </ul>
                        )}
                        {activeMissionTab === 'weekly' && (
                            <ul className="tasks-list active">
                                <li><div className="task-card"><div className="task-icon"><i className="fas fa-fire"></i></div><div className="task-details"><div className="task-title">Maintain a Streak</div></div><div className="task-action"><div className="reward-amount"><i className="fas fa-coins"></i> 500</div><button className="claim-btn disabled">In Progress</button></div></div></li>
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MissionControlOverlay;