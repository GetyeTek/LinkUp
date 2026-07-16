import React, { useState, useEffect, useCallback } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './MissionControlOverlay.css';

const MissionControlOverlay = ({ isActive, onClose }) => {
    const { sessionUser, user: userProfile } = usePlatform();
    const [activeMissionTab, setActiveMissionTab] = useState('missions');
    
    // Telegram Mission States: 'loading' | 'unverified' | 'unclaimed' | 'claimed'
    const [tgMissionState, setTgMissionState] = useState('loading');
    const [isClaiming, setIsClaiming] = useState(false);
    
    // Telegram Group Join Mission States: 'loading' | 'locked' | 'join' | 'verify' | 'claimed'
    const [tgGroupMissionState, setTgGroupMissionState] = useState('loading');
    const [targetGroupHandle, setTargetGroupHandle] = useState('@linkup_official_squad');
    const [isVerifyingGroup, setIsVerifyingGroup] = useState(false);

    // Referral Network States
    const [referrals, setReferrals] = useState([]);
    const [loadingReferrals, setLoadingReferrals] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

    // Streak Milestone States
    const [streakData, setStreakData] = useState(null);
    const [isClaimingStreak, setIsClaimingStreak] = useState(false);

    const invokePlatformSocial = async (payload) => {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch('https://linkup-gateway.getyeteklu2.workers.dev/functions/v1/social-core', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'apikey': 'sq_pub_2d66a1b8c9e08d9e0a2f8d73b',
                'x-linkup-client': 'linkup-secure-client-2026',
                ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
            },
            body: JSON.stringify(payload)
        });
        return response.json();
    };

    const checkTgMissionStatus = useCallback(async () => {
        if (!sessionUser?.id) return;
        
        try {
            const { data: profile } = await supabase
                .from('profiles')
                .select('registered_with_telegram')
                .eq('id', sessionUser.id)
                .single();

            // 1. Check Primary Verification Mission
            const idKeyVerify = `tg_verify_reward_${sessionUser.id}`;
            const { data: txVerify } = await supabase
                .from('linkoin_transactions')
                .select('id')
                .eq('idempotency_key', idKeyVerify)
                .maybeSingle();

            if (txVerify) setTgMissionState('claimed');
            else if (profile?.registered_with_telegram) setTgMissionState('unclaimed');
            else setTgMissionState('unverified');

            // 2. Check Group Join Mission
            const idKeyGroup = `tg_group_join_reward_${sessionUser.id}`;
            const { data: txGroup } = await supabase
                .from('linkoin_transactions')
                .select('id')
                .eq('idempotency_key', idKeyGroup)
                .maybeSingle();

            if (txGroup) {
                setTgGroupMissionState('claimed');
            } else if (!profile?.registered_with_telegram) {
                setTgGroupMissionState('locked');
            } else {
                // Fetch dynamic target group handle silently
                invokePlatformSocial({ action: 'get_target_tg_group' }).then(res => {
                    if (res.target_group) setTargetGroupHandle(res.target_group);
                    setTgGroupMissionState(prev => prev === 'verify' ? 'verify' : 'join');
                }).catch(() => {
                    setTgGroupMissionState(prev => prev === 'verify' ? 'verify' : 'join');
                });
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

    const handleJoinGroupClick = () => {
        window.open(`https://t.me/${targetGroupHandle.replace('@', '')}`, '_blank', 'noopener,noreferrer');
        setTgGroupMissionState('verify');
    };

    const handleVerifyGroupClick = async () => {
        setIsVerifyingGroup(true);
        try {
            const res = await invokePlatformSocial({ action: 'verify_tg_group_join' });
            if (res.error) throw new Error(res.error);
            
            if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
            setTgGroupMissionState('claimed');
        } catch (err) {
            alert(err.message || "Failed to verify membership.");
        } finally {
            setIsVerifyingGroup(false);
        }
    };

    const loadStreakData = useCallback(async () => {
        if (!sessionUser?.id) return;
        try {
            const { data } = await supabase.rpc('get_current_streak_mission');
            if (data && data.status !== 'maxed_out') setStreakData(data);
        } catch (e) {
            console.error("Streak load error:", e);
        }
    }, [sessionUser?.id]);

    useEffect(() => {
        if (isActive && activeMissionTab === 'milestones') {
            loadStreakData();
        }
    }, [isActive, activeMissionTab, loadStreakData]);

    const handleClaimStreak = async () => {
        if (!streakData || streakData.status !== 'claimable') return;
        setIsClaimingStreak(true);
        try {
            const { error } = await supabase.rpc('claim_streak_milestone', { p_target: streakData.target });
            if (error) throw error;
            if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
            await loadStreakData(); // Instantly pulls the NEXT milestone
        } catch (err) {
            alert(err.message || "Failed to claim streak milestone.");
        } finally {
            setIsClaimingStreak(false);
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

                                {/* The Telegram Group Join Mission */}
                                <li>
                                    <div className="task-card" style={{ opacity: tgGroupMissionState === 'locked' ? 0.6 : 1 }}>
                                        <div className="task-icon" style={{ background: 'rgba(41, 169, 234, 0.1)', color: '#29A9EA' }}>
                                            <i className="fas fa-users"></i>
                                        </div>
                                        <div className="task-details">
                                            <div className="task-title">Join the Squad</div>
                                            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '2px' }}>
                                                {tgGroupMissionState === 'locked' ? 'Requires Identity Verification' : `Join ${targetGroupHandle}`}
                                            </div>
                                        </div>
                                        <div className="task-action">
                                            <div className="reward-amount"><i className="fas fa-coins"></i> 30</div>
                                            {tgGroupMissionState === 'locked' && (
                                                <button className="claim-btn locked-action" disabled><i className="fas fa-lock"></i></button>
                                            )}
                                            {tgGroupMissionState === 'join' && (
                                                <button className="claim-btn verify-action" onClick={handleJoinGroupClick}>Join</button>
                                            )}
                                            {tgGroupMissionState === 'verify' && (
                                                <button className="claim-btn gold-pulse" onClick={handleVerifyGroupClick} disabled={isVerifyingGroup}>
                                                    {isVerifyingGroup ? <i className="fas fa-circle-notch fa-spin"></i> : 'Verify'}
                                                </button>
                                            )}
                                            {tgGroupMissionState === 'claimed' && (
                                                <button className="claim-btn claimed" disabled><i className="fas fa-check"></i></button>
                                            )}
                                        </div>
                                    </div>
                                </li>
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
                                {!streakData ? (
                                    <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}><i className="fas fa-circle-notch fa-spin"></i> Checking Logs...</div>
                                ) : (
                                    <li>
                                        <div className="task-card" style={{flexDirection: 'column', alignItems: 'stretch', gap: '0'}}>
                                            <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
                                                <div className="task-icon" style={{ background: 'rgba(255, 171, 64, 0.1)', color: '#ffab40' }}>
                                                    <i className="fas fa-fire"></i>
                                                </div>
                                                <div className="task-details">
                                                    <div className="task-title">{streakData.target}-Day Streak Quest</div>
                                                    <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '2px' }}>
                                                        {streakData.status === 'claimable' ? 'Milestone achieved! Claim your reward.' : 'Log in daily to build consistency.'}
                                                    </div>
                                                </div>
                                                <div className="task-action">
                                                    <div className="reward-amount"><i className="fas fa-coins"></i> {streakData.reward}</div>
                                                    <button 
                                                        className={`claim-btn ${streakData.status === 'claimable' ? 'gold-pulse' : 'disabled'}`}
                                                        disabled={streakData.status !== 'claimable' || isClaimingStreak}
                                                        onClick={handleClaimStreak}
                                                    >
                                                        {isClaimingStreak ? <i className="fas fa-circle-notch fa-spin"></i> : streakData.status === 'claimable' ? 'Claim' : 'In Progress'}
                                                    </button>
                                                </div>
                                            </div>
                                            
                                            <div style={{marginTop: '16px', background: 'rgba(0,0,0,0.4)', height: '6px', borderRadius: '3px', overflow: 'hidden', position: 'relative'}}>
                                                <div style={{
                                                    position: 'absolute', top: 0, left: 0, bottom: 0, 
                                                    background: streakData.status === 'claimable' ? '#42d7b8' : '#ffab40',
                                                    width: `${Math.min((streakData.current / streakData.target) * 100, 100)}%`,
                                                    transition: 'width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                                    boxShadow: streakData.status === 'claimable' ? '0 0 10px rgba(66, 215, 184, 0.5)' : '0 0 10px rgba(255, 171, 64, 0.3)'
                                                }}></div>
                                            </div>
                                            <div style={{textAlign: 'right', fontSize: '0.75rem', color: '#888', marginTop: '6px', fontWeight: 600, fontFamily: '"Roboto Mono", monospace'}}>
                                                {streakData.current} / {streakData.target} Days
                                            </div>
                                        </div>
                                    </li>
                                )}
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MissionControlOverlay;