import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform, GoldBadge } from '@linkup-platform/sdk-core';
import ProfileEditor from './components/ProfileEditor.jsx';
import ObservatoryOverlay from './components/ObservatoryOverlay.jsx';
import MissionControlOverlay from './components/MissionControlOverlay.jsx';
import PremiumUpgradeOverlay from './components/PremiumUpgradeOverlay.jsx';
import PrivacySecurityOverlay from './components/PrivacySecurityOverlay.jsx';
import './Profile.css';

import AppearanceOverlay from './components/AppearanceOverlay.jsx';
const Profile = () => {
    const { user: userProfile, sessionUser, theme, language, t, updateUserProfile } = usePlatform();
    const [overlays, setOverlays] = useState({ observatory: false, mission: false, privacy: false, appearance: false });
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [hasPassword, setHasPassword] = useState(true);
    const [privacyTarget, setPrivacyTarget] = useState(null);
    const [editorHighlightTarget, setEditorHighlightTarget] = useState(null);
    
    const handleLogout = async (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        await supabase.auth.signOut();
    };

    // Global Listener to open the Profile Editor externally
    useEffect(() => {
        const handleOpenEditor = () => setIsEditingProfile(true);
        window.addEventListener('open-profile-editor', handleOpenEditor);
        return () => window.removeEventListener('open-profile-editor', handleOpenEditor);
    }, []);

    // Global Listener to open Mission Control externally
    useEffect(() => {
        const handleOpenMission = () => toggleOverlay('mission', true);
        window.addEventListener('open-mission-control', handleOpenMission);
        return () => window.removeEventListener('open-mission-control', handleOpenMission);
    }, []);

    // Check ground-truth password status
    useEffect(() => {
        if (sessionUser?.id) {
            supabase.rpc('user_has_password')
                .then(({ data, error }) => {
                    if (!error && typeof data === 'boolean') {
                        const isSynthetic = sessionUser?.email?.endsWith('@linkup.invalid');
                        setHasPassword(!isSynthetic && data);
                    }
                })
                .catch(() => {});
        }
    }, [sessionUser?.id, sessionUser?.email, overlays.privacy]);

    // Helper to toggle overlays
    const toggleOverlay = (name, isOpen) => {
        setOverlays(prev => ({ ...prev, [name]: isOpen }));
        if (!isOpen && name === 'privacy') {
            setPrivacyTarget(null);
        }
    };

    const [completionData, setCompletionData] = useState({ score: 0, next_action: null });

    useEffect(() => {
        if (sessionUser?.id) {
            supabase.rpc('get_profile_completion_status')
                .then(({ data, error }) => {
                    if (!error && data) {
                        setCompletionData(data);
                    }
                })
                .catch(() => {});
        }
    }, [sessionUser?.id, userProfile, overlays.privacy, isEditingProfile]);

    const completionScore = completionData?.score || 0;
    const nextAction = completionData?.next_action || null;

    const handleExecuteNextAction = () => {
        if (!nextAction) return;
        if (nextAction.type === 'password') {
            setPrivacyTarget('password');
            toggleOverlay('privacy', true);
        } else if (nextAction.type === 'telegram') {
            setPrivacyTarget('telegram');
            toggleOverlay('privacy', true);
        } else if (nextAction.type === 'editor') {
            setEditorHighlightTarget(nextAction.target || null);
            setIsEditingProfile(true);
        }
    };

    return (
        <div className="tab-content active" id="profile-content">
            <div className="scrollable-content">
                <div className="profile-hero">
                    <div className="profile-banner"></div>
                    <div className="hero-content">
                        <div className="profile-avatar-column">
                            <div className="profile-avatar-wrapper">
                                <svg className="profile-completion-ring-svg" viewBox="0 0 140 140">
                                    <defs>
                                        <linearGradient id="profile-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                                            <stop offset="0%" stopColor="#42d7b8" />
                                            <stop offset="100%" stopColor="#f1c40f" />
                                        </linearGradient>
                                    </defs>
                                    <circle cx="70" cy="70" r="63" className="profile-ring-bg" />
                                    <circle 
                                        cx="70" cy="70" r="63" 
                                        className="profile-ring-fill"
                                        style={{
                                            strokeDasharray: '395.84',
                                            strokeDashoffset: `${395.84 - (395.84 * completionScore) / 100}`
                                        }}
                                    />
                                </svg>
                                <img src={userProfile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userProfile?.full_name || 'Scholar')}&background=1e1e1e&color=42d7b8`} alt="Profile" className="profile-avatar-large" />
                                <div className={`profile-completion-badge ${completionScore === 100 ? 'complete' : ''}`}>
                                    {completionScore === 100 ? <i className="fas fa-check"></i> : `${completionScore}%`}
                                </div>
                            </div>

                            {/* Prominent Action Trigger positioned directly beneath the avatar circle */}
                            {nextAction && completionScore < 100 ? (
                                <button 
                                    className="profile-next-action-pill"
                                    onClick={handleExecuteNextAction}
                                    title={t('profile_complete_task', userProfile?.sex, 'Complete this task')}
                                >
                                    <i className={nextAction.icon}></i>
                                    <span>{nextAction.label}</span>
                                    <span className="pna-badge">{nextAction.badge}</span>
                                </button>
                            ) : completionScore === 100 ? (
                                <div className="profile-next-action-pill verified-complete">
                                    <i className="fas fa-shield-check"></i>
                                    <span>{t('profile_completed_100', userProfile?.sex, '100% Completed')}</span>
                                </div>
                            ) : null}
                        </div>

                        <div className="user-info">
                            <h1 className="profile-name" style={{ display: 'flex', alignItems: 'center' }}>
                                {userProfile?.full_name || t('profile_student_fallback', userProfile?.sex, 'Student')}
                                {userProfile?.is_pro && <GoldBadge size="lg" />}
                            </h1>
                            {userProfile?.username && (
                                <div className="profile-handle-tag">@{userProfile.username}</div>
                            )}
                            <div className="linkoin-balance-hero" title="LinkUp Credits">
                                <i className="fas fa-coins linkoin-icon-sm"></i>
                                <span>{userProfile?.linkoin_balance ?? 0} {t('credits', userProfile?.sex, 'Credits')}</span>
                            </div>
                        </div>

                        <div className="hero-actions-desktop">
                            <button className="hero-edit-profile-btn" onClick={() => setIsEditingProfile(true)}>
                                <i className="fas fa-user-pen"></i> {t('profile_edit', userProfile?.sex, 'Edit Profile')}
                            </button>
                        </div>
                    </div>
                </div>
                
                <div className="page-content">
                    <div className="portal-cards-container">
                        <div className="portal-card" onClick={() => toggleOverlay('observatory', true)}>
                            <div className="portal-window" style={{ color: 'var(--accent-teal)' }}>
                                <svg viewBox="0 0 100 100" style={{ width: '60px', height: '60px' }}>
                                    <defs>
                                        <linearGradient id="portal-analytics-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                                            <stop offset="0%" stopColor="#42d7b8" stopOpacity="0.1" />
                                            <stop offset="100%" stopColor="#42d7b8" stopOpacity="0.8" />
                                        </linearGradient>
                                    </defs>
                                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(66, 215, 184, 0.2)" strokeWidth="1.5" strokeDasharray="3 3" />
                                    <circle cx="50" cy="50" r="28" fill="none" stroke="rgba(66, 215, 184, 0.25)" strokeWidth="1" />
                                    <path d="M 22 70 L 40 54 L 56 60 L 78 34 L 78 78 L 22 78 Z" fill="url(#portal-analytics-grad)" />
                                    <path d="M 22 70 L 40 54 L 56 60 L 78 34" fill="none" stroke="var(--accent-teal)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                                    <circle cx="78" cy="34" r="4" fill="var(--accent-teal)" />
                                    <circle cx="56" cy="60" r="3" fill="var(--accent-teal)" />
                                    <circle cx="40" cy="54" r="3" fill="var(--accent-teal)" />
                                    <circle cx="22" cy="70" r="3" fill="var(--accent-teal)" />
                                </svg>
                            </div>
                            <div className="portal-content">
                                <h2 className="portal-title">{t('study_analytics', userProfile?.sex, 'Study Analytics')}</h2>
                                <p className="portal-subtitle">{t('study_analytics_desc', userProfile?.sex, 'View your study stats and global rank')}</p>
                            </div>
                        </div>
                        <div className="portal-card" id="mission-portal-card" onClick={() => toggleOverlay('mission', true)}>
                            <div className="portal-window" style={{ color: 'var(--linkoin-gold)' }}><i className="fas fa-tasks"></i></div>
                            <div className="portal-content">
                                <h2 className="portal-title">{t('tasks_rewards', userProfile?.sex, 'Tasks & Rewards')}</h2>
                                <p className="portal-subtitle">{t('tasks_rewards_desc', userProfile?.sex, 'Complete daily tasks to earn Credits')}</p>
                            </div>
                        </div>
                        
                        <div className="portal-card premium-portal-card" onClick={() => window.dispatchEvent(new CustomEvent('open-premium-modal'))}>
                            <div className="premium-shimmer"></div>
                            <div className="portal-window" style={{ color: '#f1c40f' }}>
                                <i className="fa-solid fa-crown"></i>
                            </div>
                            <div className="portal-content">
                                <h2 className="portal-title" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f1c40f 60%, #d4ac0d 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontFamily: '"Newsreader", serif', fontWeight: 600 }}>{t('linkup_premium', userProfile?.sex, 'LinkUp Premium')}</h2>
                                <p className="portal-subtitle">{t('linkup_premium_sub', userProfile?.sex, 'Upgrade to unlimited AI & Archives')}</p>
                            </div>
                        </div>
                    </div>

                    <div className="settings-group">
                        <div className="settings-list">
                            <a href="#" className="list-item" onClick={(e) => { e.preventDefault(); setIsEditingProfile(true); }}>
                                <i className="fas fa-user-pen list-item-icon"></i><span className="list-item-text">{t('account_settings', userProfile?.sex, 'Account Settings')}</span><i className="fas fa-chevron-right list-item-chevron"></i>
                            </a>
                            <a href="#" className="list-item" onClick={(e) => { e.preventDefault(); toggleOverlay('appearance', true); }}>
                                <i className="fas fa-palette list-item-icon"></i>
                                <span className="list-item-text">{t('appearance', userProfile?.sex, 'Appearance')}</span>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary-dark)', marginRight: '8px' }}>
                                    {theme === 'dark' ? 'Dark' : 'Light'} • {language === 'am' ? 'አማርኛ' : 'EN'}
                                </span>
                                <i className="fas fa-chevron-right list-item-chevron"></i>
                            </a>
                            <a href="#" className="list-item" onClick={(e) => { e.preventDefault(); toggleOverlay('privacy', true); }}><i className="fas fa-shield-halved list-item-icon"></i><span className="list-item-text">{t('privacy_security', userProfile?.sex, 'Privacy & Security')}</span><i className="fas fa-chevron-right list-item-chevron"></i></a>
                            <a href="#" className="list-item" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('open-support-modal')); }}><i className="fas fa-info-circle list-item-icon"></i><span className="list-item-text">{t('support_about', userProfile?.sex, 'Support & About')}</span><i className="fas fa-chevron-right list-item-chevron"></i></a>
                            <a href="#" className="list-item" onClick={handleLogout} style={{ color: '#ff4757' }}><i className="fas fa-sign-out-alt list-item-icon" style={{ color: '#ff4757' }}></i><span className="list-item-text">{t('logout', userProfile?.sex, 'Log Out')}</span></a>
                        </div>
                    </div>
                </div>
            </div>

            <ObservatoryOverlay isActive={overlays.observatory} onClose={() => toggleOverlay('observatory', false)} />
            
            <ProfileEditor 
                isOpen={isEditingProfile} 
                onClose={() => {
                    setIsEditingProfile(false);
                    setEditorHighlightTarget(null);
                }} 
                userProfile={userProfile} 
                sessionUser={sessionUser} 
                onProfileUpdated={updateUserProfile}
                highlightTarget={editorHighlightTarget}
            />

            <MissionControlOverlay isActive={overlays.mission} onClose={() => toggleOverlay('mission', false)} />
            
            <PrivacySecurityOverlay 
                isActive={overlays.privacy} 
                onClose={() => toggleOverlay('privacy', false)} 
                initialTarget={privacyTarget}
            />
            <AppearanceOverlay isActive={overlays.appearance} onClose={() => toggleOverlay('appearance', false)} />
        </div>
    );
};

export default Profile;