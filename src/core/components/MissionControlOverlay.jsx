import React, { useState, useEffect, useCallback } from 'react';
import { supabase, usePlatform, getAvatarFallback } from '@linkup-platform/sdk-core';
import './MissionControlOverlay.css';

const MissionControlOverlay = ({ isActive, onClose }) => {
    const { sessionUser, user: userProfile, t } = usePlatform();
    const [activeMissionTab, setActiveMissionTab] = useState('daily');
    const [noticeModal, setNoticeModal] = useState(null);
    
    // Telegram Mission States: 'loading' | 'unverified' | 'unclaimed' | 'claimed'
    const [tgMissionState, setTgMissionState] = useState('loading');
    const [isClaiming, setIsClaiming] = useState(false);
    
    // Dynamic Telegram Group Missions (Zero hardcoded fallbacks)
    const [targetGroups, setTargetGroups] = useState([]);
    const [groupsLoading, setGroupsLoading] = useState(true);
    const [groupsError, setGroupsError] = useState(false);
    const [groupMissionStates, setGroupMissionStates] = useState({});
    const [verifyingGroupId, setVerifyingGroupId] = useState(null);

    // Referral Network States
    const [referrals, setReferrals] = useState([]);
    const [loadingReferrals, setLoadingReferrals] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);
    const [milestonesData, setMilestonesData] = useState(null);
    const [claimingTier, setClaimingTier] = useState(null);

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

            // 2. Fetch Dynamic Groups & Claimed Ledger Status
            setGroupsLoading(true);
            setGroupsError(false);

            try {
                const [groupsRes, txRes] = await Promise.all([
                    invokePlatformSocial({ action: 'get_target_tg_groups' }),
                    supabase
                        .from('linkoin_transactions')
                        .select('idempotency_key')
                        .eq('user_id', sessionUser.id)
                        .like('idempotency_key', 'tg_group_join_reward_%')
                ]);

                if (!groupsRes?.success || !Array.isArray(groupsRes.groups) || groupsRes.groups.length === 0) {
                    setGroupsError(true);
                    setTargetGroups([]);
                } else {
                    setTargetGroups(groupsRes.groups);
                    const claimedKeys = new Set((txRes?.data || []).map(t => t.idempotency_key));

                    setGroupMissionStates(prev => {
                        const nextStates = { ...prev };
                        groupsRes.groups.forEach(g => {
                            const cleanHandleKey = g.handle.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
                            const groupKey = `tg_group_join_reward_${cleanHandleKey}_${sessionUser.id}`;
                            const legacyKey = `tg_group_join_reward_${sessionUser.id}`;

                            if (claimedKeys.has(groupKey) || claimedKeys.has(legacyKey)) {
                                nextStates[g.id] = 'claimed';
                            } else if (!nextStates[g.id]) {
                                nextStates[g.id] = 'join';
                            }
                        });
                        return nextStates;
                    });
                }
            } catch (err) {
                console.error("Failed to load group missions:", err);
                setGroupsError(true);
                setTargetGroups([]);
            } finally {
                setGroupsLoading(false);
            }
        } catch (error) {
            console.error("Failed to fetch mission status", error);
        }
    }, [sessionUser?.id]);

    // Check status on mount and when overlay opens (always reset to Daily)
    useEffect(() => {
        if (isActive) {
            setActiveMissionTab('daily');
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
            // Secure Handshake (Prevents ATO)
            setIsClaiming(true);
            try {
                const { data, error } = await supabase.rpc('generate_telegram_link_token');
                if (error || !data) throw new Error("Could not generate secure link.");
                window.open(`https://t.me/linkupregistrationbot?start=link_${data}`, '_blank', 'noopener,noreferrer');
            } catch (err) {
                setNoticeModal({ title: "Verification Failed", msg: err.message || "Failed to initiate verification.", isSuccess: false });
            } finally {
                setIsClaiming(false);
            }
        } else if (tgMissionState === 'unclaimed') {
            // Claim the reward securely!
            setIsClaiming(true);
            try {
                const { data, error } = await supabase.rpc('claim_telegram_verification_reward');
                if (error) throw error;
                
                if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
                setTgMissionState('claimed');
                setNoticeModal({ title: "Reward Claimed!", msg: "You have received +50 LinkUp Credits for verifying your identity.", isSuccess: true });
            } catch (err) {
                setNoticeModal({ title: "Claim Failed", msg: err.message || "Failed to claim reward.", isSuccess: false });
            } finally {
                setIsClaiming(false);
            }
        }
    };

    const handleJoinGroupClick = (group) => {
        const targetUrl = group.url || `https://t.me/${group.handle.replace('@', '')}`;
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
        setGroupMissionStates(prev => ({ ...prev, [group.id]: 'verify' }));
    };

    const handleVerifyGroupClick = async (group) => {
        setVerifyingGroupId(group.id);
        try {
            const res = await invokePlatformSocial({
                action: 'verify_tg_group_join',
                group_id: group.id,
                handle: group.handle
            });
            if (res.error) throw new Error(res.error);
            
            if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
            setGroupMissionStates(prev => ({ ...prev, [group.id]: 'claimed' }));
            setNoticeModal({ title: "Mission Completed!", msg: `Membership verified in ${group.handle}! +${group.reward || 30} Credits added to your account.`, isSuccess: true });
        } catch (err) {
            setNoticeModal({ title: "Membership Verification", msg: err.message || `Could not verify membership in ${group.handle}. Make sure you have joined the channel.`, isSuccess: false });
        } finally {
            setVerifyingGroupId(null);
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
            setNoticeModal({ title: "Milestone Claimed!", msg: `Streak quest completed! +${streakData.reward} Credits awarded.`, isSuccess: true });
        } catch (err) {
            setNoticeModal({ title: "Claim Failed", msg: err.message || "Failed to claim streak milestone.", isSuccess: false });
        } finally {
            setIsClaimingStreak(false);
        }
    };

    // Load Referrals and Milestone Quests when Network tab is active
    const loadReferralsAndMilestones = useCallback(async () => {
        if (!isActive || activeMissionTab !== 'network') return;
        setLoadingReferrals(true);
        try {
            const [refRes, mileRes] = await Promise.all([
                supabase.rpc('get_my_referrals'),
                supabase.rpc('get_referral_milestones')
            ]);
            if (refRes.data) setReferrals(refRes.data);
            if (mileRes.data) setMilestonesData(mileRes.data);
        } catch (err) {
            console.error("Referral fetch error:", err);
        } finally {
            setLoadingReferrals(false);
        }
    }, [isActive, activeMissionTab]);

    useEffect(() => {
        loadReferralsAndMilestones();
    }, [loadReferralsAndMilestones]);

    const handleClaimReferralMilestone = async (tier) => {
        setClaimingTier(tier);
        try {
            const { data, error } = await supabase.rpc('claim_referral_milestone', { p_tier: tier });
            if (error) throw error;
            if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
            await loadReferralsAndMilestones();
            setNoticeModal({
                title: "LinkUp Gold Unlocked! 👑",
                msg: `Congratulations! You unlocked ${data?.duration || ''} of LinkUp Gold for free!`,
                isSuccess: true
            });
        } catch (err) {
            setNoticeModal({
                title: "Claim Failed",
                msg: err.message || "Failed to claim milestone.",
                isSuccess: false
            });
        } finally {
            setClaimingTier(null);
        }
    };

    const getBaseUrl = () => {
        const cleanBase = (window.location.origin + window.location.pathname).split('?')[0].replace(/\/$/, '');
        return cleanBase;
    };

    const referralLink = userProfile?.username ? `${getBaseUrl()}?ref=${userProfile.username}` : '';
    const shareMessage = `Yo! Join me on LinkUp for freshman prep, university exam pavilion archives, and 24/7 AI tutoring with Miron. Use my link to get started:\n`;

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
                    <h2 className="overlay-title">{t('tasks_rewards', 'Tasks & Rewards')}</h2>
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
                                {t(`missions_tab_${tab}`, tab.charAt(0).toUpperCase() + tab.slice(1))}
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
                                            <div className="task-title">{t('mission_secure_identity', 'Secure Identity')}</div>
                                            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '2px' }}>{t('mission_link_phone', 'Link & verify your phone')}</div>
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
                                                 tgMissionState === 'unverified' ? t('missions_verify', 'Verify') : 
                                                 tgMissionState === 'unclaimed' ? t('missions_claim', 'Claim') : 
                                                 <i className="fas fa-check"></i>}
                                            </button>
                                        </div>
                                    </div>
                                </li>

                                {/* Dynamic Telegram Community Missions */}
                                {groupsLoading ? (
                                    <li>
                                        <div className="task-card" style={{ justifyContent: 'center', color: '#888', padding: '1.25rem' }}>
                                            <i className="fas fa-circle-notch fa-spin" style={{ marginRight: '8px', color: '#29A9EA' }}></i>
                                            <span>Loading community missions...</span>
                                        </div>
                                    </li>
                                ) : groupsError || targetGroups.length === 0 ? (
                                    <li>
                                        <div className="task-card" style={{ opacity: 0.7, padding: '1rem' }}>
                                            <div className="task-icon" style={{ background: 'rgba(255, 255, 255, 0.05)', color: '#888' }}>
                                                <i className="fas fa-circle-exclamation"></i>
                                            </div>
                                            <div className="task-details">
                                                <div className="task-title" style={{ color: '#aaa' }}>Community Tasks Unavailable</div>
                                                <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '2px' }}>
                                                    Group reward missions are temporarily unavailable. Check back soon.
                                                </div>
                                            </div>
                                        </div>
                                    </li>
                                ) : (
                                    targetGroups.map(group => {
                                        const isLocked = tgMissionState === 'unverified';
                                        const status = groupMissionStates[group.id] || 'join';
                                        const isClaimed = status === 'claimed';
                                        const isVerifying = verifyingGroupId === group.id;

                                        return (
                                            <li key={group.id}>
                                                <div className="task-card" style={{ opacity: isLocked ? 0.6 : 1 }}>
                                                    <div className="task-icon" style={{ background: 'rgba(41, 169, 234, 0.1)', color: '#29A9EA' }}>
                                                        <i className="fas fa-users"></i>
                                                    </div>
                                                    <div className="task-details">
                                                        <div className="task-title">Join {group.title || group.handle}</div>
                                                        <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '2px' }}>
                                                            {isLocked ? 'Requires Identity Verification' : `Join ${group.handle}`}
                                                        </div>
                                                    </div>
                                                    <div className="task-action">
                                                        <div className="reward-amount"><i className="fas fa-coins"></i> {group.reward || 30}</div>
                                                        {isLocked && (
                                                            <button className="claim-btn locked-action" disabled><i className="fas fa-lock"></i></button>
                                                        )}
                                                        {!isLocked && status === 'join' && (
                                                            <button className="claim-btn verify-action" onClick={() => handleJoinGroupClick(group)}>Join</button>
                                                        )}
                                                        {!isLocked && status === 'verify' && (
                                                            <button className="claim-btn gold-pulse" onClick={() => handleVerifyGroupClick(group)} disabled={isVerifying}>
                                                                {isVerifying ? <i className="fas fa-circle-notch fa-spin"></i> : 'Verify'}
                                                            </button>
                                                        )}
                                                        {!isLocked && isClaimed && (
                                                            <button className="claim-btn claimed" disabled><i className="fas fa-check"></i></button>
                                                        )}
                                                    </div>
                                                </div>
                                            </li>
                                        );
                                    })
                                )}
                            </ul>
                        )}

                        {activeMissionTab === 'network' && (
                            <div className="tasks-list active" style={{ padding: '1rem 0' }}>
                                {/* Hero Referral Quest Card */}
                                <div className="invite-card-premium">
                                    <div className="ic-header">
                                        <i className="fa-solid fa-crown" style={{ color: 'var(--linkoin-gold)', fontSize: '1.25rem' }}></i>
                                        <h3>{t('mission_invite_friends', 'Invite Friends, Get Free Gold')}</h3>
                                    </div>
                                    <div className="ic-body">
                                        {t('mission_invite_desc', 'Invite verified classmates to unlock up to a full year of LinkUp Gold for free!')}
                                    </div>

                                    {/* 3 / 7 / 15 Milestone Quest Badges */}
                                    <div className="ref-milestones-grid">
                                        {(milestonesData?.milestones || [
                                            { tier: 3, duration_label: '1 Month Free', is_unlocked: false, is_claimed: false },
                                            { tier: 7, duration_label: '1 Semester Free', is_unlocked: false, is_claimed: false },
                                            { tier: 15, duration_label: '1 Year Free', is_unlocked: false, is_claimed: false }
                                        ]).map(m => {
                                            const completed = milestonesData?.completed_count || 0;
                                            const pct = Math.min(100, Math.round((completed / m.tier) * 100));
                                            const isClaiming = claimingTier === m.tier;

                                            return (
                                                <div key={m.tier} className={`ref-milestone-card ${m.is_claimed ? 'claimed' : m.is_unlocked ? 'unlocked' : ''}`}>
                                                    <div className="ref-m-top">
                                                        <span className="ref-m-tag">{m.tier} {t('missions_friends_tag', 'Friends')}</span>
                                                        <span className="ref-m-reward"><i className="fa-solid fa-gift"></i> {m.duration_label}</span>
                                                    </div>
                                                    
                                                    <div className="ref-m-progress-bar">
                                                        <div className="ref-m-fill" style={{ width: `${pct}%` }}></div>
                                                    </div>

                                                    <div className="ref-m-bottom">
                                                        <span className="ref-m-count">{Math.min(completed, m.tier)} / {m.tier}</span>
                                                        {m.is_claimed ? (
                                                            <span className="ref-m-btn claimed"><i className="fa-solid fa-check"></i> {t('ref_claimed', 'Claimed')}</span>
                                                        ) : m.is_unlocked ? (
                                                            <button 
                                                                type="button"
                                                                className="ref-m-btn claimable gold-pulse" 
                                                                onClick={() => handleClaimReferralMilestone(m.tier)}
                                                                disabled={isClaiming}
                                                            >
                                                                {isClaiming ? <i className="fas fa-circle-notch fa-spin"></i> : <><i className="fa-solid fa-crown"></i> {t('ref_claim_gold', 'Claim Gold')}</>}
                                                            </button>
                                                        ) : (
                                                            <span className="ref-m-btn locked"><i className="fa-solid fa-lock"></i> {t('missions_in_progress', 'In Progress')}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="ic-link-box" style={{ marginTop: '1.25rem' }}>
                                        <div className="ic-link-text">{referralLink || t('common_loading', 'Loading link...')}</div>
                                        <button className="ic-copy-btn" onClick={handleCopyLink} disabled={!referralLink}>
                                            {copySuccess ? <><i className="fas fa-check"></i> {t('common_copied', 'Copied')}</> : <><i className="fas fa-copy"></i> {t('common_copy', 'Copy')}</>}
                                        </button>
                                    </div>
                                    <div className="ic-share-actions">
                                        <button className="ic-share-btn tg" onClick={handleShareTg}><i className="fab fa-telegram-plane"></i> Telegram</button>
                                        <button className="ic-share-btn wa" onClick={handleShareWa}><i className="fab fa-whatsapp"></i> WhatsApp</button>
                                    </div>
                                </div>

                                <div className="network-tracker-header">
                                    <span>{t('missions_squad_network', 'Squad Network')}</span>
                                    <span>{t('missions_invites_count', '{count} Invites').replace('{count}', String(referrals.length))}</span>
                                </div>

                                {loadingReferrals ? (
                                    <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}><i className="fas fa-circle-notch fa-spin"></i> Syncing Ledger...</div>
                                ) : referrals.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '2rem', color: '#666', fontStyle: 'italic', fontSize: '0.85rem' }}>
                                        <i className="fas fa-users-slash" style={{ fontSize: '2rem', display: 'block', marginBottom: '10px', opacity: 0.5 }}></i>
                                        Your network is currently empty.<br/>Share your link to start unlocking Gold!
                                    </div>
                                ) : (
                                    referrals.map(ref => (
                                        <div key={ref.id} className={`ref-row ${ref.status === 'completed' ? 'is-completed' : 'is-pending'}`}>
                                            <img src={ref.referee_avatar || getAvatarFallback(ref.referee_name)} onError={(e) => { e.target.onerror = null; e.target.src = getAvatarFallback(ref.referee_name); }} alt="Avatar" className="ref-avatar" />
                                            <div className="ref-info">
                                                <div className="ref-name">{ref.referee_name} (@{ref.referee_username})</div>
                                                <div className="ref-time">Joined {timeAgo(ref.created_at)}</div>
                                            </div>
                                            <div className={`ref-status-badge ${ref.status}`}>
                                                {ref.status === 'completed' ? <><i className="fa-solid fa-circle-check"></i> Verified</> : <><i className="fas fa-hourglass-half"></i> Pending</>}
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
                                                    <div className="task-title">{t('missions_streak_quest', '{target}-Day Streak Quest').replace('{target}', String(streakData.target))}</div>
                                                    <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '2px' }}>
                                                        {streakData.status === 'claimable' ? t('missions_streak_claimable', 'Milestone achieved! Claim your reward.') : t('missions_streak_progress', 'Log in daily to build consistency.')}
                                                    </div>
                                                </div>
                                                <div className="task-action">
                                                    <div className="reward-amount"><i className="fas fa-coins"></i> {streakData.reward}</div>
                                                    <button 
                                                        className={`claim-btn ${streakData.status === 'claimable' ? 'gold-pulse' : 'disabled'}`}
                                                        disabled={streakData.status !== 'claimable' || isClaimingStreak}
                                                        onClick={handleClaimStreak}
                                                    >
                                                        {isClaimingStreak ? <i className="fas fa-circle-notch fa-spin"></i> : streakData.status === 'claimable' ? t('missions_claim', 'Claim') : t('missions_in_progress', 'In Progress')}
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
                                                {t('missions_days_count', '{current} / {target} Days').replace('{current}', String(streakData.current)).replace('{target}', String(streakData.target))}
                                            </div>
                                        </div>
                                    </li>
                                )}
                            </ul>
                        )}
                    </div>
                </div>
            </div>

            {/* Custom High-Fidelity Notification Modal */}
            {noticeModal && (
                <div 
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 99999,
                        background: 'rgba(0, 0, 0, 0.75)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '1.5rem',
                        animation: 'fadeIn 0.2s ease-out'
                    }}
                    onClick={() => setNoticeModal(null)}
                >
                    <div 
                        style={{
                            background: 'var(--surface-dark, #181920)',
                            border: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
                            borderRadius: '24px',
                            width: '100%',
                            maxWidth: '380px',
                            padding: '1.75rem',
                            boxShadow: '0 25px 50px rgba(0, 0, 0, 0.6)',
                            animation: 'popModal 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
                            <div style={{
                                width: '42px',
                                height: '42px',
                                borderRadius: '12px',
                                background: noticeModal.isSuccess ? 'rgba(66, 215, 184, 0.15)' : 'rgba(255, 95, 95, 0.15)',
                                color: noticeModal.isSuccess ? 'var(--accent-teal, #42d7b8)' : '#ff5f5f',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '1.25rem',
                                flexShrink: 0
                            }}>
                                <i className={`fas ${noticeModal.isSuccess ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>
                            </div>
                            <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#fff', fontWeight: 700 }}>
                                {noticeModal.title}
                            </h3>
                        </div>
                        <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: '#ccc', lineHeight: 1.5 }}>
                            {noticeModal.msg}
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button 
                                style={{
                                    padding: '11px 22px',
                                    borderRadius: '12px',
                                    fontWeight: 700,
                                    fontFamily: 'Poppins, sans-serif',
                                    cursor: 'pointer',
                                    border: 'none',
                                    fontSize: '0.9rem',
                                    background: 'var(--accent-teal, #42d7b8)',
                                    color: '#0c0c0c'
                                }} 
                                onClick={() => setNoticeModal(null)}
                            >
                                Got It
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MissionControlOverlay;