import React, { useState, useEffect, useCallback } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './MissionControlOverlay.css';

const MissionControlOverlay = ({ isActive, onClose }) => {
    const { sessionUser, user: userProfile } = usePlatform();
    const [activeMissionTab, setActiveMissionTab] = useState('daily');
    
    // Telegram Mission States: 'loading' | 'unverified' | 'unclaimed' | 'claimed'
    const [tgMissionState, setTgMissionState] = useState('loading');
    const [isClaiming, setIsClaiming] = useState(false);
    
    // Referral Network States
    const [referrals, setReferrals] = useState([]);
    const [loadingReferrals, setLoadingReferrals] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

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

    // Load Referrals when the Network tab is active
    useEffect(() => {
        if (isActive && activeMissionTab === 'network') {
            setLoadingReferrals(true);
            supabase.rpc('get_my_referrals').then(({ data }) => {
                if (data) setReferrals(data);
                setLoadingReferrals(false);
            });
        }
    }, [isActive, activeMissionTab]);

    const getBaseUrl = () => {
        const cleanBase = (window.location.origin + window.location.pathname).split('?')[0].replace(/\/$/, '');
        return cleanBase;
    };

    const referralLink = userProfile?.username ? `${getBaseUrl()}?ref=${userProfile.username}` : '';
    const shareMessage = `Yo! Join me on LinkUp for freshman prep, exam pavilion files, and study sessions with Miron AI. Use my link to get a free +100 coin welcome boost:\n`;

    const handleCopyLink = () => {
        navigator.clipboard.writeText(referralLink);
        setCopySuccess(true);
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
        setTimeout(() => setCopySuccess(false), 2000);
    };

    const handleShareTg = () => {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareMessage)}`, '_blank');
    };

    const handleShareWa = () => {
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareMessage + ' ' + referralLink)}`, '_blank');
    };

    const timeAgo = (isoString) => {
        const diff = Math.floor((new Date() - new Date(isoString)) / 60000);
        if (diff < 60) return `${diff}m ago`;
        const hrs = Math.floor(diff/60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs/24)}d ago`;
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
                        {['daily', 'network', 'milestones'].map(tab => (
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
                            transform: `translateX(${activeMissionTab === 'daily' ? '0%' : activeMissionTab === 'network' ? '100%' : '200%'})` 
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

                        {activeMissionTab === 'network' && (
                            <div className="tasks-list active" style={{ padding: '1rem 0' }}>
                                <div className="invite-card-premium">
                                    <div className="ic-header">
                                        <i className="fas fa-gem" style={{ color: 'var(--linkoin-gold)', fontSize: '1.2rem' }}></i>
                                        <h3>Invite Friends, Earn Together</h3>
                                    </div>
                                    <div className="ic-body">
                                        Earn <strong>+30 Linkoins</strong> for every classmate who joins and verifies their phone. They get a <strong>+100 welcome boost</strong> too!
                                    </div>
                                    <div className="ic-link-box">
                                        <div className="ic-link-text">{referralLink || 'Loading link...'}</div>
                                        <button className="ic-copy-btn" onClick={handleCopyLink} disabled={!referralLink}>
                                            {copySuccess ? <><i className="fas fa-check"></i> Copied</> : <><i className="fas fa-copy"></i> Copy</>}
                                        </button>
                                    </div>
                                    <div className="ic-share-actions">
                                        <button className="ic-share-btn tg" onClick={handleShareTg}><i className="fab fa-telegram-plane"></i> Telegram</button>
                                        <button className="ic-share-btn wa" onClick={handleShareWa}><i className="fab fa-whatsapp"></i> WhatsApp</button>
                                    </div>
                                </div>

                                <div className="network-tracker-header">
                                    <span>Squad Network</span>
                                    <span>{referrals.length} Invites</span>
                                </div>

                                {loadingReferrals ? (
                                    <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}><i className="fas fa-circle-notch fa-spin"></i> Syncing Ledger...</div>
                                ) : referrals.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '2rem', color: '#666', fontStyle: 'italic', fontSize: '0.85rem' }}>
                                        <i className="fas fa-users-slash" style={{ fontSize: '2rem', display: 'block', marginBottom: '10px', opacity: 0.5 }}></i>
                                        Your network is currently empty.<br/>Share your link to start earning!
                                    </div>
                                ) : (
                                    referrals.map(ref => (
                                        <div key={ref.id} className={`ref-row ${ref.status === 'completed' ? 'is-completed' : 'is-pending'}`}>
                                            <img src={ref.referee_avatar || 'https://via.placeholder.com/150'} alt="Avatar" className="ref-avatar" />
                                            <div className="ref-info">
                                                <div className="ref-name">{ref.referee_name} (@{ref.referee_username})</div>
                                                <div className="ref-time">Joined {timeAgo(ref.created_at)}</div>
                                                {ref.status === 'completed' && (
                                                    <div className="ref-ledger-id">TX_ID: ref_bonus_referrer_{ref.id.split('-')[0]}</div>
                                                )}
                                            </div>
                                            <div className={`ref-status-badge ${ref.status}`}>
                                                {ref.status === 'completed' ? <><i className="fas fa-coins"></i> +30</> : <><i className="fas fa-hourglass-half"></i> Pending</>}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                        
                        {activeMissionTab === 'milestones' && (
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