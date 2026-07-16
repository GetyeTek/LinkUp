import React, { useState, useEffect, useCallback } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './MissionControlOverlay.css';

const MissionControlOverlay = ({ isActive, onClose }) => {
    const { sessionUser } = usePlatform();
    const [activeMissionTab, setActiveMissionTab] = useState('daily');
    
    // Telegram Mission States: 'loading' | 'unverified' | 'unclaimed' | 'claimed'
    const [tgMissionState, setTgMissionState] = useState('loading');
    const [isClaiming, setIsClaiming] = useState(false);

    const checkTgMissionStatus = useCallback(async () => {
        if (!sessionUser?.id) return;
        
        try {
            // 1. Check if verified
            const { data: profile } = await supabase
                .from('profiles')
                .select('registered_with_telegram')
                .eq('id', sessionUser.id)
                .single();

            if (!profile?.registered_with_telegram) {
                setTgMissionState('unverified');
                return;
            }

            // 2. If verified, check the ledger to see if they already claimed it
            const idempotencyKey = `tg_verify_reward_${sessionUser.id}`;
            const { data: tx } = await supabase
                .from('linkoin_transactions')
                .select('id')
                .eq('idempotency_key', idempotencyKey)
                .maybeSingle();

            if (tx) {
                setTgMissionState('claimed');
            } else {
                setTgMissionState('unclaimed');
            }
        } catch (error) {
            console.error("Failed to fetch mission status", error);
        }
    }, [sessionUser?.id]);

    // Check status on mount and when overlay opens
    useEffect(() => {
        if (isActive) {
            checkTgMissionStatus();
        }
    }, [isActive, checkTgMissionStatus]);

    // The Window-Focus "Self-Healing" Hack
    // If they tab out to Telegram and come back, it instantly reflects reality
    useEffect(() => {
        const handleFocus = () => {
            if (isActive) checkTgMissionStatus();
        };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, [isActive, checkTgMissionStatus]);

    const handleTgMissionClick = async () => {
        if (tgMissionState === 'unverified') {
            // Send them to the bot
            window.open(`https://t.me/linkupregistrationbot?start=verify_${sessionUser.id}`, '_blank', 'noopener,noreferrer');
        } else if (tgMissionState === 'unclaimed') {
            // Claim the reward securely!
            setIsClaiming(true);
            try {
                const { data, error } = await supabase.rpc('claim_telegram_verification_reward');
                if (error) throw error;
                
                // Play a tactile success sound/vibration if supported
                if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
                
                setTgMissionState('claimed');
            } catch (err) {
                console.error("Claim failed:", err);
                alert(err.message || "Failed to claim reward.");
            } finally {
                setIsClaiming(false);
            }
        }
    };
    
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
                                {/* The Dynamic Telegram Identity Mission */}
                                <li>
                                    <div className="task-card">
                                        <div className="task-icon" style={{ background: 'rgba(41, 169, 234, 0.1)', color: '#29A9EA' }}>
                                            <i className="fab fa-telegram-plane"></i>
                                        </div>
                                        <div className="task-details">
                                            <div className="task-title">Secure Identity</div>
                                            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '2px' }}>Link & verify your phone</div>
                                        </div>
                                        <div className="task-action">
                                            <div className="reward-amount"><i className="fas fa-coins"></i> 50</div>
                                            <button 
                                                className={`claim-btn ${
                                                    tgMissionState === 'loading' || isClaiming ? 'disabled' : 
                                                    tgMissionState === 'unverified' ? 'verify-action' :
                                                    tgMissionState === 'unclaimed' ? 'gold-pulse' : 'claimed'
                                                }`}
                                                onClick={handleTgMissionClick}
                                                disabled={tgMissionState === 'loading' || tgMissionState === 'claimed' || isClaiming}
                                            >
                                                {tgMissionState === 'loading' || isClaiming ? <i className="fas fa-circle-notch fa-spin"></i> : 
                                                 tgMissionState === 'unverified' ? 'Verify' : 
                                                 tgMissionState === 'unclaimed' ? 'Claim' : 
                                                 <i className="fas fa-check"></i>}
                                            </button>
                                        </div>
                                    </div>
                                </li>

                                {/* Static Placeholders */}
                                <li><div className="task-card"><div className="task-icon"><i className="fas fa-lightbulb"></i></div><div className="task-details"><div className="task-title">Quick Quiz</div><div style={{ fontSize: '0.75rem', color: '#888', marginTop: '2px' }}>Test your knowledge</div></div><div className="task-action"><div className="reward-amount"><i className="fas fa-coins"></i> 15</div><button className="claim-btn disabled">In Progress</button></div></div></li>
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